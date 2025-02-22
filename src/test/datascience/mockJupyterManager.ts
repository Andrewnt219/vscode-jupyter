// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { ChildProcess } from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Observable } from 'rxjs/Observable';
import * as tmp from 'tmp';
import * as TypeMoq from 'typemoq';
import * as uuid from 'uuid/v4';
import { EventEmitter, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';

import type { Kernel, Session } from '@jupyterlab/services';
import { anything, instance, mock, when } from 'ts-mockito';
import { Cancellation } from '../../client/common/cancellation';
import { ProductInstaller } from '../../client/common/installer/productInstaller';
import {
    ExecutionResult,
    IProcessServiceFactory,
    IPythonDaemonExecutionService,
    IPythonExecutionFactory,
    Output
} from '../../client/common/process/types';
import { IInstaller, Product, Resource } from '../../client/common/types';
import { EXTENSION_ROOT_DIR } from '../../client/constants';
import { generateCells } from '../../client/datascience/cellFactory';
import { CodeSnippets, Identifiers } from '../../client/datascience/constants';
import { KernelConnectionMetadata } from '../../client/datascience/jupyter/kernels/types';
import {
    ICell,
    IJupyterKernel,
    IJupyterKernelSpec,
    IJupyterSession,
    IJupyterSessionManager
} from '../../client/datascience/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceManager } from '../../client/ioc/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { concatMultilineString } from '../../datascience-ui/common';
import { noop, sleep } from '../core';
import { InterpreterService } from '../interpreters/interpreterService';
import { MockJupyterSession } from './mockJupyterSession';
import { MockProcessService } from './mockProcessService';
import { MockPythonService } from './mockPythonService';
import { createCodeCell } from '../../datascience-ui/common/cellFactory';
import { areInterpreterPathsSame } from '../../client/pythonEnvironments/info/interpreter';

/* eslint-disable @typescript-eslint/no-explicit-any, , no-multi-str,  */

const MockJupyterTimeDelay = 10;
const LineFeedRegEx = /(\r\n|\n)/g;

export enum SupportedCommands {
    none = 0,
    ipykernel = 1,
    nbconvert = 2,
    notebook = 4,
    kernelspec = 8,
    all = 0xffff
}

function createKernelSpecs(specs: { name: string; resourceDir: string }[]): Record<string, any> {
    const models: Record<string, any> = {};
    specs.forEach((spec) => {
        models[spec.name] = {
            resource_dir: spec.resourceDir,
            spec: {
                name: spec.name,
                display_name: spec.name,
                language: 'python'
            }
        };
    });
    return models;
}

// This class is used to mock talking to jupyter. It mocks
// the process services, the interpreter services, the python services, and the jupyter session
export class MockJupyterManager implements IJupyterSessionManager {
    public readonly productInstaller: IInstaller;
    private restartSessionCreatedEvent = new EventEmitter<Kernel.IKernelConnection>();
    private restartSessionUsedEvent = new EventEmitter<Kernel.IKernelConnection>();
    private pythonExecutionFactory = this.createTypeMoq<IPythonExecutionFactory>('Python Exec Factory');
    private processServiceFactory = this.createTypeMoq<IProcessServiceFactory>('Process Exec Factory');
    private processService: MockProcessService = new MockProcessService();
    private interpreterService = this.createTypeMoq<InterpreterService>('Interpreter Service');
    private changedInterpreterEvent: EventEmitter<void> = new EventEmitter<void>();
    private installedInterpreters: PythonEnvironment[] = [];
    private pythonServices: MockPythonService[] = [];
    private activeInterpreter: PythonEnvironment | undefined;
    private sessionTimeout: number | undefined;
    private cellDictionary: Record<string, nbformat.IBaseCell> = {};
    private kernelSpecs: { name: string; dir: string }[] = [];
    private currentSession: MockJupyterSession | undefined;
    private cleanTemp: (() => void) | undefined;
    private pendingSessionFailure = false;
    private pendingKernelChangeFailure = false;

    constructor(serviceManager: IServiceManager) {
        // Make our process service factory always return this item
        this.processServiceFactory.setup((p) => p.create()).returns(() => Promise.resolve(this.processService));
        this.productInstaller = mock(ProductInstaller);
        // Setup our interpreter service
        this.interpreterService
            .setup((i) => i.onDidChangeInterpreter)
            .returns(() => this.changedInterpreterEvent.event);
        this.interpreterService
            .setup((i) => i.getActiveInterpreter(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(this.activeInterpreter));
        this.interpreterService
            .setup((i) => i.getInterpreters(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(this.installedInterpreters));
        this.interpreterService
            .setup((i) => i.getInterpreterDetails(TypeMoq.It.isAnyString()))
            .returns((p) => {
                const found = this.installedInterpreters.find((i) => areInterpreterPathsSame(i.path, p));
                if (found) {
                    return Promise.resolve(found);
                }
                return Promise.reject('Unknown interpreter');
            });
        this.interpreterService
            .setup((i) => i.updateInterpreter(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((_r, p) => {
                const found = this.installedInterpreters.find((i) => areInterpreterPathsSame(i.path, p));
                if (found) {
                    this.activeInterpreter = found;
                }
            });

        // Stick our services into the service manager
        serviceManager.addSingletonInstance<IInterpreterService>(IInterpreterService, this.interpreterService.object);
        serviceManager.addSingletonInstance<IPythonExecutionFactory>(
            IPythonExecutionFactory,
            this.pythonExecutionFactory.object
        );
        serviceManager.addSingletonInstance<IProcessServiceFactory>(
            IProcessServiceFactory,
            this.processServiceFactory.object
        );
        serviceManager.addSingletonInstance<IInstaller>(IInstaller, instance(this.productInstaller));

        // Setup our default kernel spec (this is just a dummy value)
        // eslint-disable-next-line no-octal, no-octal-escape
        this.kernelSpecs.push({
            name: '0e8519db-0895-416c-96df-fa80131ecea0',
            dir: 'C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0'
        });

        // Setup our default cells that happen for everything
        this.addCell(CodeSnippets.MatplotLibInitSvg);
        this.addCell(CodeSnippets.MatplotLibInitPng);
        this.addCell(CodeSnippets.ConfigSvg);
        this.addCell(CodeSnippets.ConfigPng);
        this.addCell(CodeSnippets.UpdateCWDAndPath.format(path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience')));
        this.addCell(
            CodeSnippets.UpdateCWDAndPath.format(
                Uri.file(path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience')).fsPath
            )
        );
        tmp.file((_e, p, _fd, cleanup) => {
            this.addCell(CodeSnippets.UpdateCWDAndPath.format(path.dirname(p)));
            this.cleanTemp = cleanup;
        });
        this.addCell(`import sys\r\nsys.path.append('undefined')\r\nsys.path`);
        this.addCell(`import debugpy;debugpy.listen(('localhost', 0))`);
        this.addCell("matplotlib.style.use('dark_background')");
        this.addCell(`matplotlib.rcParams.update(${Identifiers.MatplotLibDefaultParams})`);
        this.addCell(`%cd "${path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience')}"`);
        // When we have windows file names, we replace `\` with `\\`.
        // Code is as follows `await this.notebook.execute(`__file__ = '${file.replace(/\\/g, '\\\\')}'`, file, line, uuid(), undefined, true);
        // Found in src\client\datascience\interactive-common\interactiveBase.ts.
        this.addCell(`%cd "${Uri.file(path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience')).fsPath}`);
        // New root dir should be in the temp folder.
        tmp.file((_e, p, _fd, cleanup) => {
            this.addCell(`%cd "${path.dirname(p).toLowerCase()}"`);
            this.cleanTemp = cleanup;
        });
        this.addCell('import sys\r\nsys.version', '1.1.1.1');
        this.addCell('import sys\r\nsys.executable', 'python');
        this.addCell('import notebook\r\nnotebook.version_info', '1.1.1.1');

        this.addCell(`__file__ = '${Uri.file('foo.py').fsPath}'`);
        this.addCell(`__file__ = '${Uri.file('bar.py').fsPath}'`);
        this.addCell(`__file__ = '${Uri.file('foo').fsPath}'`);
        this.addCell(`__file__ = '${Uri.file('test.py').fsPath}'`);

        // When we have windows file names, we replace `\` with `\\`.
        // Code is as follows `await this.notebook.execute(`__file__ = '${file.replace(/\\/g, '\\\\')}'`, file, line, uuid(), undefined, true);
        // Found in src\client\datascience\interactive-common\interactiveBase.ts.
        this.addCell(`__file__ = '${Uri.file('foo.py').fsPath.replace(/\\/g, '\\\\')}'`);
        this.addCell(`__file__ = '${Uri.file('bar.py').fsPath.replace(/\\/g, '\\\\')}'`);
        this.addCell(`__file__ = '${Uri.file('foo').fsPath.replace(/\\/g, '\\\\')}'`);
        this.addCell(`__file__ = '${Uri.file('test.py').fsPath.replace(/\\/g, '\\\\')}'`);
        this.addCell('import os\nos.getcwd()', `'${path.join(EXTENSION_ROOT_DIR)}'`);
        this.addCell('import sys\nsys.path[0]', `'${path.join(EXTENSION_ROOT_DIR)}'`);

        // Default cell used for a lot of tests.
        this.addCell('a=1\na', 1);

        // Default used for variables
        this.addCell('_rwho_ls = %who_ls\nprint(_rwho_ls)', '');
    }

    public get onRestartSessionCreated() {
        return this.restartSessionCreatedEvent.event;
    }

    public get onRestartSessionUsed() {
        return this.restartSessionUsedEvent.event;
    }

    public makeActive(interpreter: PythonEnvironment) {
        this.activeInterpreter = interpreter;
    }

    public getCurrentSession(): MockJupyterSession | undefined {
        return this.currentSession;
    }

    public forcePendingIdleFailure() {
        this.pendingSessionFailure = true;
    }

    public forcePendingKernelChangeFailure() {
        this.pendingKernelChangeFailure = true;
    }

    public getRunningKernels(): Promise<IJupyterKernel[]> {
        return Promise.resolve([]);
    }

    public getRunningSessions(): Promise<Session.IModel[]> {
        return Promise.resolve([]);
    }

    public setProcessDelay(timeout: number | undefined) {
        this.processService.setDelay(timeout);
        this.pythonServices.forEach((p) => p.setDelay(timeout));
    }

    public addInterpreter(
        interpreter: PythonEnvironment,
        supportedCommands: SupportedCommands,
        notebookStdErr?: string[],
        notebookProc?: ChildProcess
    ) {
        this.installedInterpreters.push(interpreter);

        // Add the python calls first.
        const pythonService = new MockPythonService(interpreter);
        this.pythonServices.push(pythonService);
        this.pythonExecutionFactory
            .setup((f) =>
                f.create(
                    TypeMoq.It.is((o) => {
                        return o && o.pythonPath ? o.pythonPath === interpreter.path : false;
                    })
                )
            )
            .returns(() => Promise.resolve(pythonService));
        this.pythonExecutionFactory
            .setup((f) =>
                f.createDaemon(
                    TypeMoq.It.is((o) => {
                        return o && o.pythonPath ? o.pythonPath === interpreter.path : false;
                    })
                )
            )
            .returns(() => Promise.resolve((pythonService as unknown) as IPythonDaemonExecutionService));
        this.pythonExecutionFactory
            .setup((f) =>
                f.createActivatedEnvironment(
                    TypeMoq.It.is((o) => {
                        return !o || JSON.stringify(o.interpreter) === JSON.stringify(interpreter);
                    })
                )
            )
            .returns(() => Promise.resolve(pythonService));
        this.setupSupportedPythonService(pythonService, interpreter, supportedCommands, notebookStdErr, notebookProc);

        // Then the process calls
        this.setupSupportedProcessService(interpreter, supportedCommands, notebookStdErr);

        // Default to being the new active
        this.makeActive(interpreter);
    }

    public addError(code: string, message: string, traceback?: string[]) {
        // Turn the message into an nbformat.IError
        const result: nbformat.IError = {
            output_type: 'error',
            ename: message,
            evalue: message,
            traceback: traceback ? traceback : [message]
        };
        const cell = createCodeCell(code);
        cell.outputs = [result];
        this.addCell(cell);
    }

    public addContinuousOutputCell(
        code: string,
        resultGenerator: (cancelToken: CancellationToken) => Promise<{ result: string; haveMore: boolean }>,
        doNotUseICell?: boolean
    ) {
        const cells = doNotUseICell
            ? [createCodeCell(code)]
            : generateCells(undefined, code, Uri.file('foo.py').fsPath, 1, true, uuid());
        cells.forEach((c) => {
            const source = doNotUseICell ? (c as nbformat.ICodeCell).source : (c as ICell).data.source;
            const key = concatMultilineString(source).replace(LineFeedRegEx, '').toLowerCase();
            if (doNotUseICell) {
                const cell = c as nbformat.ICodeCell;
                if (cell.cell_type === 'code') {
                    const taggedResult = {
                        output_type: 'generator'
                    };
                    cell.outputs = [...cell.outputs, taggedResult];

                    // Tag on our extra data
                    (taggedResult as any).resultGenerator = async (t: CancellationToken) => {
                        const result = await resultGenerator(t);
                        return {
                            result: this.createStreamResult(result.result),
                            haveMore: result.haveMore
                        };
                    };
                }
            } else {
                const cell = c as ICell;
                if (cell.data.cell_type === 'code') {
                    const taggedResult = {
                        output_type: 'generator'
                    };
                    const data: nbformat.ICodeCell = cell.data as nbformat.ICodeCell;
                    data.outputs = [...data.outputs, taggedResult];

                    // Tag on our extra data
                    (taggedResult as any).resultGenerator = async (t: CancellationToken) => {
                        const result = await resultGenerator(t);
                        return {
                            result: this.createStreamResult(result.result),
                            haveMore: result.haveMore
                        };
                    };

                    // Save in the cell.
                    cell.data = data;
                }
            }

            // Save each in our dictionary for future use.
            // Note: Our entire setup is recreated each test so this dictionary
            // should be unique per test
            this.cellDictionary[key] = c as any;
        });
    }

    // public addInputICell(
    //     code: string,
    //     result?:
    //         | undefined
    //         | string
    //         | number
    //         | nbformat.IUnrecognizedOutput
    //         | nbformat.IExecuteResult
    //         | nbformat.IDisplayData
    //         | nbformat.IStream
    //         | nbformat.IError,
    //     mimeType?: string
    // ) {
    //     const cells = generateCells(undefined, code, Uri.file('foo.py').fsPath, 1, true, uuid());
    //     cells.forEach((c) => {
    //         const key = concatMultilineString(c.data.source).replace(LineFeedRegEx, '').toLowerCase();
    //         if (c.data.cell_type === 'code') {
    //             const taggedResult = {
    //                 output_type: 'input'
    //             };
    //             const massagedResult = this.massageCellResult(result, mimeType);
    //             const data: nbformat.ICodeCell = c.data as nbformat.ICodeCell;
    //             if (result) {
    //                 data.outputs = [...data.outputs, taggedResult, massagedResult];
    //             } else {
    //                 data.outputs = [...data.outputs, taggedResult];
    //             }
    //             // Save in the cell.
    //             c.data = data;
    //         }

    //         // Save each in our dictionary for future use.
    //         // Note: Our entire setup is recreated each test so this dictionary
    //         // should be unique per test
    //         this.cellDictionary[key] = c as any;
    //     });
    // }

    public addCell(cell: nbformat.IBaseCell | string, output?: string | number | any, mimeType?: any) {
        if (typeof cell === 'string') {
            cell = createCodeCell(cell);
        }
        if (typeof output !== 'undefined') {
            const outputItem = this.massageCellResult(output, mimeType);
            (cell as nbformat.ICodeCell).outputs = [outputItem];
        }
        const key = concatMultilineString(cell.source).replace(LineFeedRegEx, '').toLowerCase();
        this.cellDictionary[key] = cell as any;
    }
    public setWaitTime(timeout: number | undefined) {
        this.sessionTimeout = timeout;
    }

    public async dispose(): Promise<void> {
        if (this.cleanTemp) {
            this.cleanTemp();
        }
    }

    public startNew(
        _resource: Resource,
        _kernelConnection: KernelConnectionMetadata | undefined,
        _workingDirectory: string,
        cancelToken?: CancellationToken
    ): Promise<IJupyterSession> {
        if (this.sessionTimeout && cancelToken) {
            const localTimeout = this.sessionTimeout;
            return Cancellation.race(async () => {
                await sleep(localTimeout);
                return this.createNewSession();
            }, cancelToken);
        } else {
            return Promise.resolve(this.createNewSession());
        }
    }

    public getKernelSpecs(): Promise<IJupyterKernelSpec[]> {
        return Promise.resolve([]);
    }

    public changeWorkingDirectory(workingDir: string) {
        this.addCell(CodeSnippets.UpdateCWDAndPath.format(workingDir));
        this.addCell('import os\nos.getcwd()', path.join(workingDir));
        this.addCell('import sys\nsys.path[0]', path.join(workingDir));
    }

    private createNewSession(): MockJupyterSession {
        const sessionFailure = this.pendingSessionFailure;
        const kernelChangeFailure = this.pendingKernelChangeFailure;
        this.pendingSessionFailure = false;
        this.pendingKernelChangeFailure = false;
        this.currentSession = new MockJupyterSession(
            this.cellDictionary,
            MockJupyterTimeDelay,
            sessionFailure,
            kernelChangeFailure
        );
        return this.currentSession;
    }

    private createStreamResult(str: string): nbformat.IStream {
        return {
            output_type: 'stream',
            name: 'stdout',
            text: str
        };
    }

    private massageCellResult(
        result:
            | undefined
            | string
            | number
            | nbformat.IUnrecognizedOutput
            | nbformat.IExecuteResult
            | nbformat.IDisplayData
            | nbformat.IStream
            | nbformat.IError,
        mimeType?: string
    ):
        | nbformat.IUnrecognizedOutput
        | nbformat.IExecuteResult
        | nbformat.IDisplayData
        | nbformat.IStream
        | nbformat.IError {
        // See if undefined or string or number
        if (!result) {
            // This is an empty execute result
            return {
                output_type: 'execute_result',
                execution_count: 1,
                data: {},
                metadata: {}
            };
        } else if (mimeType && mimeType === 'clear_true') {
            return {
                output_type: 'clear_true'
            };
        } else if (mimeType && mimeType === 'stream') {
            return {
                output_type: 'stream',
                text: result,
                name: 'stdout'
            };
        } else if (typeof result === 'string') {
            const data = {};
            (data as any)[mimeType ? mimeType : 'text/plain'] = result;
            return {
                output_type: 'execute_result',
                execution_count: 1,
                data: data,
                metadata: {}
            };
        } else if (typeof result === 'number') {
            return {
                output_type: 'execute_result',
                execution_count: 1,
                data: { 'text/plain': result.toString() },
                metadata: {}
            };
        } else {
            return result;
        }
    }

    private createTempSpec(pythonPath: string): string {
        const tempDir = os.tmpdir();
        const subDir = uuid();
        const filePath = path.join(tempDir, subDir, 'kernel.json');
        fs.ensureDirSync(path.dirname(filePath));
        fs.writeJSONSync(filePath, {
            display_name: 'Python 3',
            language: 'python',
            argv: [pythonPath, '-m', 'ipykernel_launcher', '-f', '{connection_file}']
        });
        return filePath;
    }

    private createTypeMoq<T>(tag: string): TypeMoq.IMock<T> {
        // Use typemoqs for those things that are resolved as promises. mockito doesn't allow nesting of mocks. ES6 Proxy class
        // is the problem. We still need to make it thenable though. See this issue: https://github.com/florinn/typemoq/issues/67
        const result = TypeMoq.Mock.ofType<T>();
        (result as any).tag = tag;
        result.setup((x: any) => x.then).returns(() => undefined);
        return result;
    }

    private setupPythonServiceExec(
        service: MockPythonService,
        module: string,
        args: (string | RegExp)[],
        result: () => Promise<ExecutionResult<string>>
    ) {
        service.addExecResult(['-m', module, ...args], result);
        service.addExecModuleResult(module, args, result);
    }

    private setupPythonServiceExecObservable(
        service: MockPythonService,
        module: string,
        args: (string | RegExp)[],
        stderr: string[],
        stdout: string[],
        proc?: ChildProcess
    ) {
        const result = {
            proc,
            out: new Observable<Output<string>>((subscriber) => {
                stderr.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
                stdout.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
            }),
            dispose: () => {
                noop();
            }
        };

        service.addExecObservableResult(['-m', module, ...args], () => result);
        service.addExecModuleObservableResult(module, args, () => result);
    }

    private setupProcessServiceExec(
        service: MockProcessService,
        file: string,
        args: (string | RegExp)[],
        result: () => Promise<ExecutionResult<string>>
    ) {
        service.addExecResult(file, args, result);
    }

    private setupProcessServiceExecObservable(
        service: MockProcessService,
        file: string,
        args: (string | RegExp)[],
        stderr: string[],
        stdout: string[]
    ) {
        service.addExecObservableResult(file, args, () => {
            return {
                proc: undefined,
                out: new Observable<Output<string>>((subscriber) => {
                    stderr.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
                    stdout.forEach((s) => subscriber.next({ source: 'stderr', out: s }));
                }),
                dispose: () => {
                    noop();
                }
            };
        });
    }

    private setupSupportedPythonService(
        service: MockPythonService,
        workingPython: PythonEnvironment,
        supportedCommands: SupportedCommands,
        notebookStdErr?: string[],
        notebookProc?: ChildProcess
    ) {
        when(this.productInstaller.isInstalled(anything(), anything())).thenResolve(true);
        if ((supportedCommands & SupportedCommands.ipykernel) === SupportedCommands.ipykernel) {
            this.setupPythonServiceExec(service, 'ipykernel', ['--version'], () =>
                Promise.resolve({ stdout: '1.1.1.1' })
            );
            this.setupPythonServiceExec(
                service,
                'ipykernel',
                ['install', '--user', '--name', /\w+-\w+-\w+-\w+-\w+/, '--display-name', `'Interactive'`],
                () => {
                    const spec = this.addKernelSpec(workingPython.path);
                    return Promise.resolve({ stdout: `somename ${path.dirname(spec)}` });
                }
            );
        } else {
            when(this.productInstaller.isInstalled(Product.ipykernel, anything())).thenResolve(false);
        }
        if ((supportedCommands & SupportedCommands.nbconvert) === SupportedCommands.nbconvert) {
            this.setupPythonServiceExec(service, 'jupyter', ['nbconvert', '--version'], () =>
                Promise.resolve({ stdout: '1.1.1.1' })
            );
            this.setupPythonServiceExec(
                service,
                'jupyter',
                ['nbconvert', /.*/, '--to', 'python', '--stdout', '--template', /.*/],
                () => {
                    return Promise.resolve({
                        stdout: '#%%\r\nimport os\r\nos.chdir()\r\n#%%\r\na=1'
                    });
                }
            );
        } else {
            when(this.productInstaller.isInstalled(Product.nbconvert, anything())).thenResolve(false);
        }
        if ((supportedCommands & SupportedCommands.notebook) === SupportedCommands.notebook) {
            this.setupPythonServiceExec(service, 'jupyter', ['notebook', '--version'], () =>
                Promise.resolve({ stdout: '1.1.1.1' })
            );
            this.setupPythonServiceExecObservable(
                service,
                'jupyter',
                [
                    'notebook',
                    '--no-browser',
                    /--notebook-dir=.*/,
                    /.*/,
                    '--NotebookApp.iopub_data_rate_limit=10000000000.0'
                ],
                [],
                notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198'],
                notebookProc
            );
            this.setupPythonServiceExecObservable(
                service,
                'jupyter',
                ['notebook', '--no-browser', /--notebook-dir=.*/, '--NotebookApp.iopub_data_rate_limit=10000000000.0'],
                [],
                notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198'],
                notebookProc
            );
        } else {
            when(this.productInstaller.isInstalled(Product.notebook, anything())).thenResolve(false);
        }
        if ((supportedCommands & SupportedCommands.kernelspec) === SupportedCommands.kernelspec) {
            this.setupPythonServiceExec(service, 'jupyter', ['kernelspec', '--version'], () =>
                Promise.resolve({ stdout: '1.1.1.1' })
            );
            this.setupPythonServiceExec(service, 'jupyter', ['kernelspec', 'list', '--json'], () => {
                const kernels = this.kernelSpecs.map((k) => ({ name: k.name, resourceDir: k.dir }));
                return Promise.resolve({ stdout: JSON.stringify(createKernelSpecs(kernels)) });
            });
        } else {
            when(this.productInstaller.isInstalled(Product.kernelspec, anything())).thenResolve(false);
        }
    }

    private addKernelSpec(pythonPath: string): string {
        const spec = this.createTempSpec(pythonPath);
        this.kernelSpecs.push({ name: `${this.kernelSpecs.length}Spec`, dir: `${path.dirname(spec)}` });
        return spec;
    }

    private setupSupportedProcessService(
        workingPython: PythonEnvironment,
        supportedCommands: SupportedCommands,
        notebookStdErr?: string[]
    ) {
        if ((supportedCommands & SupportedCommands.ipykernel) === SupportedCommands.ipykernel) {
            // Don't mind the goofy path here. It's supposed to not find the item on your box. It's just testing the internal regex works
            this.setupProcessServiceExec(
                this.processService,
                workingPython.path,
                ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
                () => {
                    const kernels = this.kernelSpecs.map((k) => ({ name: k.name, resourceDir: k.dir }));
                    return Promise.resolve({ stdout: JSON.stringify(createKernelSpecs(kernels)) });
                }
            );
            this.setupProcessServiceExec(
                this.processService,
                workingPython.path,
                [
                    '-m',
                    'ipykernel',
                    'install',
                    '--user',
                    '--name',
                    /\w+-\w+-\w+-\w+-\w+/,
                    '--display-name',
                    `'Interactive'`
                ],
                () => {
                    const spec = this.addKernelSpec(workingPython.path);
                    return Promise.resolve({
                        stdout: JSON.stringify(
                            createKernelSpecs([{ name: 'somename', resourceDir: path.dirname(spec) }])
                        )
                    });
                }
            );
            const getServerInfoPath = path.join(
                EXTENSION_ROOT_DIR,
                'pythonFiles',
                'vscode_datascience_helpers',
                'getServerInfo.py'
            );
            this.setupProcessServiceExec(this.processService, workingPython.path, [getServerInfoPath], () =>
                Promise.resolve({ stdout: 'failure to get server infos' })
            );
            this.setupProcessServiceExecObservable(
                this.processService,
                workingPython.path,
                ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
                [],
                []
            );
            this.setupProcessServiceExecObservable(
                this.processService,
                workingPython.path,
                [
                    '-m',
                    'jupyter',
                    'notebook',
                    '--no-browser',
                    /--notebook-dir=.*/,
                    /.*/,
                    '--NotebookApp.iopub_data_rate_limit=10000000000.0'
                ],
                [],
                notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
            );
            this.setupProcessServiceExecObservable(
                this.processService,
                workingPython.path,
                [
                    '-m',
                    'jupyter',
                    'notebook',
                    '--no-browser',
                    /--notebook-dir=.*/,
                    '--NotebookApp.iopub_data_rate_limit=10000000000.0'
                ],
                [],
                notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
            );
        } else if ((supportedCommands & SupportedCommands.notebook) === SupportedCommands.notebook) {
            this.setupProcessServiceExec(
                this.processService,
                workingPython.path,
                ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
                () => {
                    const kernels = this.kernelSpecs.map((k) => ({ name: k.name, resourceDir: k.dir }));
                    return Promise.resolve({ stdout: JSON.stringify(createKernelSpecs(kernels)) });
                }
            );
            const getServerInfoPath = path.join(
                EXTENSION_ROOT_DIR,
                'pythonFiles',
                'vscode_datascience_helpers',
                'getServerInfo.py'
            );
            this.setupProcessServiceExec(this.processService, workingPython.path, [getServerInfoPath], () =>
                Promise.resolve({ stdout: 'failure to get server infos' })
            );
            this.setupProcessServiceExecObservable(
                this.processService,
                workingPython.path,
                ['-m', 'jupyter', 'kernelspec', 'list', '--json'],
                [],
                []
            );
            this.setupProcessServiceExecObservable(
                this.processService,
                workingPython.path,
                [
                    '-m',
                    'jupyter',
                    'notebook',
                    '--no-browser',
                    /--notebook-dir=.*/,
                    /.*/,
                    '--NotebookApp.iopub_data_rate_limit=10000000000.0'
                ],
                [],
                notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
            );
            this.setupProcessServiceExecObservable(
                this.processService,
                workingPython.path,
                [
                    '-m',
                    'jupyter',
                    'notebook',
                    '--no-browser',
                    /--notebook-dir=.*/,
                    '--NotebookApp.iopub_data_rate_limit=10000000000.0'
                ],
                [],
                notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']
            );
        }
        if ((supportedCommands & SupportedCommands.nbconvert) === SupportedCommands.nbconvert) {
            this.setupProcessServiceExec(
                this.processService,
                workingPython.path,
                ['-m', 'jupyter', 'nbconvert', /.*/, '--to', 'python', '--stdout', '--template', /.*/],
                () => {
                    return Promise.resolve({
                        stdout: '#%%\r\nimport os\r\nos.chdir()'
                    });
                }
            );
        }
    }
}
