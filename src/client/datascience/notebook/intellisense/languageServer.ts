// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import {
    Disposable,
    extensions,
    NotebookDocument,
    workspace,
    window,
    NotebookConcatTextDocument,
    notebooks,
    Event,
    Uri
} from 'vscode';
import {
    ClientCapabilities,
    DocumentSelector,
    DynamicFeature,
    ExecuteCommandRegistrationOptions,
    ExecuteCommandRequest,
    LanguageClient,
    LanguageClientOptions,
    RegistrationData,
    RegistrationType,
    RevealOutputChannelOn,
    ServerCapabilities,
    ServerOptions,
    StaticFeature,
    TransportKind
} from 'vscode-languageclient/node';
import * as path from 'path';
import * as fs from 'fs-extra';
import { FileBasedCancellationStrategy } from './fileBasedCancellationStrategy';
import { NOTEBOOK_SELECTOR, PYTHON_LANGUAGE } from '../../../common/constants';
import { createNotebookMiddleware } from '@vscode/jupyter-lsp-middleware';
import { traceInfo } from '../../../common/logger';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { sleep } from '../../../common/utils/async';
import * as uuid from 'uuid/v4';
import { noop } from '../../../common/utils/misc';
import { getInterpreterId } from '../../../pythonEnvironments/info/interpreter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensure(target: any, key: string) {
    if (target[key] === undefined) {
        target[key] = {};
    }
    return target[key];
}

class NerfedExecuteCommandFeature implements DynamicFeature<ExecuteCommandRegistrationOptions> {
    private _commands: Map<string, Disposable[]> = new Map<string, Disposable[]>();

    public get registrationType(): RegistrationType<ExecuteCommandRegistrationOptions> {
        return ExecuteCommandRequest.type;
    }

    public fillClientCapabilities(capabilities: ClientCapabilities): void {
        ensure(ensure(capabilities, 'workspace'), 'executeCommand').dynamicRegistration = true;
    }

    public initialize(capabilities: ServerCapabilities): void {
        if (!capabilities.executeCommandProvider) {
            return;
        }
        this.register({
            id: uuid(),
            registerOptions: Object.assign({}, capabilities.executeCommandProvider)
        });
    }

    public register(_data: RegistrationData<ExecuteCommandRegistrationOptions>): void {
        // Do nothing. Otherwise we end up with double registration
        traceInfo('Registering dummy command feature');
    }

    public unregister(id: string): void {
        let disposables = this._commands.get(id);
        if (disposables) {
            disposables.forEach((disposable) => disposable.dispose());
        }
    }

    public dispose(): void {
        this._commands.forEach((value) => {
            value.forEach((disposable) => disposable.dispose());
        });
        this._commands.clear();
    }
}

// TODO: Export this api from the lsp middleware instead of just having the type match
const notebookApi = new (class {
    public get onDidOpenNotebookDocument(): Event<NotebookDocument> {
        return workspace.onDidOpenNotebookDocument;
    }
    public get onDidCloseNotebookDocument(): Event<NotebookDocument> {
        return workspace.onDidCloseNotebookDocument;
    }
    public get notebookDocuments(): ReadonlyArray<NotebookDocument> {
        return workspace.notebookDocuments;
    }
    public createConcatTextDocument(doc: NotebookDocument, selector?: DocumentSelector): NotebookConcatTextDocument {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return notebooks.createConcatTextDocument(doc, selector) as any;
    }
})();

export class LanguageServer implements Disposable {
    private _interpreterId: String;
    private constructor(
        public client: LanguageClient,
        public interpreter: PythonEnvironment,
        private disposables: Disposable[]
    ) {
        this._interpreterId = getInterpreterId(interpreter);
    }

    public async dispose() {
        this.disposables.forEach((d) => d.dispose());
        await this.client.stop();
    }

    public get interpreterId() {
        return this._interpreterId;
    }

    public static async createLanguageServer(
        interpreter: PythonEnvironment,
        shouldAllowIntellisense: (uri: Uri, interpreterId: string) => boolean
    ): Promise<LanguageServer | undefined> {
        const cancellationStrategy = new FileBasedCancellationStrategy();
        const serverOptions = await LanguageServer.createServerOptions(interpreter, cancellationStrategy);
        if (serverOptions) {
            let languageClient: LanguageClient | undefined;
            const outputChannel = window.createOutputChannel(`${interpreter.displayName || 'notebook'}-languageserver`);
            const interpreterId = getInterpreterId(interpreter);

            // Client options should be the same for all servers we support.
            const clientOptions: LanguageClientOptions = {
                documentSelector: NOTEBOOK_SELECTOR,
                workspaceFolder: undefined,
                synchronize: {
                    configurationSection: PYTHON_LANGUAGE
                },
                outputChannel,
                revealOutputChannelOn: RevealOutputChannelOn.Never,
                middleware: createNotebookMiddleware(
                    notebookApi,
                    () => languageClient,
                    () => noop, // Don't trace output. Slows things down too much
                    NOTEBOOK_SELECTOR,
                    /.*\.(ipynb|interactive)/m,
                    interpreter.path,
                    (uri) => shouldAllowIntellisense(uri, interpreterId)
                ),
                connectionOptions: {
                    cancellationStrategy
                }
            };

            languageClient = new LanguageClient('notebook-intellisense', serverOptions, clientOptions);

            // Before starting do a little hack to prevent the pylance double command registration (working with Jake to have an option to skip commands)
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const features: (StaticFeature | DynamicFeature<any>)[] = ((languageClient as unknown) as any)._features;
            const minusCommands = features.filter(
                (f) => (f as any).registrationType?.method != 'workspace/executeCommand'
            );
            minusCommands.push(new NerfedExecuteCommandFeature());
            (languageClient as any)._features = minusCommands;

            // Then start (which will cause the initialize request to be sent to pylance)
            const languageClientDisposable = languageClient.start();

            // After starting, wait for it to be ready
            while (languageClient && !languageClient.initializeResult) {
                await sleep(100);
            }
            if (languageClient) {
                await languageClient.onReady();
            }

            return new LanguageServer(languageClient, interpreter, [
                languageClientDisposable,
                cancellationStrategy,
                outputChannel
            ]);
        } else {
            // Not creating a server, so dispose of the cancellation strategy
            cancellationStrategy.dispose();
        }
    }

    private static async createServerOptions(
        interpreter: PythonEnvironment,
        cancellationStrategy: FileBasedCancellationStrategy
    ): Promise<ServerOptions | undefined> {
        const pythonConfig = workspace.getConfiguration('python');
        if (pythonConfig && pythonConfig.get<string>('languageServer') === 'JediLSP') {
            // Use jedi to start our language server.
            return LanguageServer.createJediLSPServerOptions(interpreter);
        }

        // Default is use pylance
        return LanguageServer.createPylanceServerOptions(cancellationStrategy);
    }

    private static async createJediLSPServerOptions(
        interpreter: PythonEnvironment
    ): Promise<ServerOptions | undefined> {
        // Jedi ships with python. Use that to find it.
        const python = extensions.getExtension('ms-python.python');
        if (python) {
            const runJediPath = path.join(python.extensionPath, 'pythonFiles', 'run-jedi-language-server.py');
            if (await fs.pathExists(runJediPath)) {
                const serverOptions: ServerOptions = {
                    command: interpreter.path || 'python',
                    args: [runJediPath]
                };
                return serverOptions;
            }
        }
    }

    private static async createPylanceServerOptions(
        cancellationStrategy: FileBasedCancellationStrategy
    ): Promise<ServerOptions | undefined> {
        const pylance = extensions.getExtension('ms-python.vscode-pylance');
        if (pylance) {
            const distPath = path.join(pylance.extensionPath, 'dist');
            const bundlePath = path.join(distPath, 'server.bundle.js');
            const nonBundlePath = path.join(distPath, 'server.js');
            const modulePath = (await fs.pathExists(nonBundlePath)) ? nonBundlePath : bundlePath;
            const debugOptions = { execArgv: ['--nolazy', '--inspect=6600'] };

            // If the extension is launched in debug mode, then the debug server options are used.
            const serverOptions: ServerOptions = {
                run: {
                    module: bundlePath,
                    transport: TransportKind.ipc,
                    args: cancellationStrategy.getCommandLineArguments()
                },
                // In debug mode, use the non-bundled code if it's present. The production
                // build includes only the bundled package, so we don't want to crash if
                // someone starts the production extension in debug mode.
                debug: {
                    module: modulePath,
                    transport: TransportKind.ipc,
                    options: debugOptions,
                    args: cancellationStrategy.getCommandLineArguments()
                }
            };
            return serverOptions;
        }
    }
}
