// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { injectable } from 'inversify';
import * as uuid from 'uuid/v4';
import { Disposable, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import '../../common/extensions';
import { traceError, traceInfo } from '../../common/logger';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IOutputChannel,
    Resource
} from '../../common/types';
import { createDeferred, Deferred, sleep } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { Telemetry } from '../constants';
import { sendKernelTelemetryEvent } from '../telemetry/telemetry';
import {
    IJupyterConnection,
    IJupyterSession,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    INotebook,
    INotebookServer,
    INotebookServerLaunchInfo
} from '../types';
import { getDisplayNameOrNameOfKernelConnection } from './kernels/helpers';
import { KernelConnectionMetadata } from './kernels/types';

// This code is based on the examples here:
// https://www.npmjs.com/package/@jupyterlab/services

@injectable()
export class JupyterServerBase implements INotebookServer {
    private launchInfo: INotebookServerLaunchInfo | undefined;
    private _id = uuid();
    private connectPromise: Deferred<INotebookServerLaunchInfo> = createDeferred<INotebookServerLaunchInfo>();
    private connectionInfoDisconnectHandler: Disposable | undefined;
    private serverExitCode: number | undefined;
    private notebooks = new Map<string, Promise<INotebook>>();
    private sessionManager: IJupyterSessionManager | undefined;
    private savedSession: IJupyterSession | undefined;

    constructor(
        private asyncRegistry: IAsyncDisposableRegistry,
        private disposableRegistry: IDisposableRegistry,
        protected readonly configService: IConfigurationService,
        private sessionManagerFactory: IJupyterSessionManagerFactory,
        private jupyterOutputChannel: IOutputChannel
    ) {
        this.asyncRegistry.push(this);
        traceInfo(`Creating jupyter server: ${this._id}`);
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void> {
        traceInfo(
            `Connecting server ${this.id} kernelSpec ${getDisplayNameOrNameOfKernelConnection(
                launchInfo.kernelConnectionMetadata,
                'unknown'
            )}`
        );

        // Save our launch info
        this.launchInfo = launchInfo;

        // Indicate connect started
        this.connectPromise.resolve(launchInfo);

        // Listen to the process going down
        if (this.launchInfo && this.launchInfo.connectionInfo) {
            this.connectionInfoDisconnectHandler = this.launchInfo.connectionInfo.disconnected((c) => {
                try {
                    this.serverExitCode = c;
                    traceError(localize.DataScience.jupyterServerCrashed().format(c.toString()));
                    this.shutdown().ignoreErrors();
                } catch {
                    noop();
                }
            });
        }

        // Indicate we have a new session on the output channel
        this.logRemoteOutput(localize.DataScience.connectingToJupyterUri().format(launchInfo.connectionInfo.baseUrl));

        // Create our session manager
        this.sessionManager = await this.sessionManagerFactory.create(launchInfo.connectionInfo);

        // Try creating a session just to ensure we're connected. Callers of this function check to make sure jupyter
        // is running and connectable.
        let session: IJupyterSession | undefined;
        session = await this.sessionManager.startNew(
            undefined,
            launchInfo.kernelConnectionMetadata,
            launchInfo.connectionInfo.rootDirectory,
            cancelToken,
            launchInfo.disableUI
        );
        const idleTimeout = this.configService.getSettings().jupyterLaunchTimeout;
        // The wait for idle should throw if we can't connect.
        await session.waitForIdle(idleTimeout);

        // For local we want to save this for the next notebook to use.
        if (this.launchInfo.connectionInfo.localLaunch) {
            this.savedSession = session;
        } else {
            // Otherwise for remote, just get rid of it.
            await session.shutdown();
        }
    }

    public async createNotebook(
        resource: Resource,
        identity: Uri,
        notebookMetadata?: nbformat.INotebookMetadata,
        kernelConnection?: KernelConnectionMetadata,
        cancelToken?: CancellationToken
    ): Promise<INotebook> {
        if (!this.sessionManager || this.isDisposed) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        // If we have a saved session send this into the notebook so we don't create a new one
        const savedSession = this.savedSession;
        this.savedSession = undefined;
        const stopWatch = new StopWatch();
        // Create a notebook and return it.
        try {
            const notebook = await this.createNotebookInstance(
                resource,
                identity,
                this.sessionManager,
                savedSession,
                this.disposableRegistry,
                this.configService,
                notebookMetadata,
                kernelConnection,
                cancelToken
            );
            const baseUrl = this.launchInfo?.connectionInfo.baseUrl || '';
            this.logRemoteOutput(localize.DataScience.createdNewNotebook().format(baseUrl));
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime);
            return notebook;
        } catch (ex) {
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime, undefined, ex);
            throw ex;
        }
    }

    public async shutdown(): Promise<void> {
        try {
            // Order should be
            // 1) connectionInfoDisconnectHandler - listens to process close
            // 2) sessions (owned by the notebooks)
            // 3) session manager (owned by this object)
            // 4) connInfo (owned by this object) - kills the jupyter process

            if (this.connectionInfoDisconnectHandler) {
                this.connectionInfoDisconnectHandler.dispose();
                this.connectionInfoDisconnectHandler = undefined;
            }

            // Destroy the kernel spec
            await this.destroyKernelSpec();

            // Remove the saved session if we haven't passed it onto a notebook
            if (this.savedSession) {
                await this.savedSession.dispose();
                this.savedSession = undefined;
            }

            traceInfo(`Shutting down notebooks for ${this.id}`);
            const notebooks = await Promise.all([...this.notebooks.values()]);
            await Promise.all(notebooks.map((n) => n?.dispose()));
            traceInfo(`Shut down session manager : ${this.sessionManager ? 'existing' : 'undefined'}`);
            if (this.sessionManager) {
                // Session manager in remote case may take too long to shutdown. Don't wait that
                // long.
                const result = await Promise.race([sleep(10_000), this.sessionManager.dispose()]);
                if (result === 10_000) {
                    traceError(`Session shutdown timed out.`);
                }
                this.sessionManager = undefined;
            }

            // After shutting down notebooks and session manager, kill the main process.
            if (this.launchInfo && this.launchInfo.connectionInfo) {
                traceInfo('Shutdown server - dispose conn info');
                this.launchInfo.connectionInfo.dispose(); // This should kill the process that's running
                this.launchInfo = undefined;
            }
        } catch (e) {
            traceError(`Error during shutdown: `, e);
        }
    }

    public dispose(): Promise<void> {
        return this.shutdown();
    }

    public get id(): string {
        return this._id;
    }

    public waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        return this.connectPromise.promise;
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IJupyterConnection | undefined {
        if (!this.launchInfo) {
            return undefined;
        }

        // Return a copy with a no-op for dispose
        return {
            ...this.launchInfo.connectionInfo,
            dispose: noop
        };
    }

    public getDisposedError(): Error {
        // We may have been disposed because of a crash. See if our connection info is indicating shutdown
        if (this.serverExitCode) {
            return new Error(localize.DataScience.jupyterServerCrashed().format(this.serverExitCode.toString()));
        }

        // Default is just say session was disposed
        return new Error(localize.DataScience.sessionDisposed());
    }

    public async getNotebook(identity: Uri): Promise<INotebook | undefined> {
        return this.notebooks.get(identity.toString());
    }

    protected getNotebooks(): Promise<INotebook>[] {
        return [...this.notebooks.values()];
    }

    protected setNotebook(identity: Uri, notebook: Promise<INotebook>) {
        const removeNotebook = () => {
            if (this.notebooks.get(identity.toString()) === notebook) {
                this.notebooks.delete(identity.toString());
            }
        };

        notebook
            .then((nb) => {
                const oldDispose = nb.dispose.bind(nb);
                nb.dispose = () => {
                    this.notebooks.delete(identity.toString());
                    return oldDispose();
                };
            })
            .catch(removeNotebook);

        // Save the notebook
        this.notebooks.set(identity.toString(), notebook);
    }

    protected createNotebookInstance(
        _resource: Resource,
        _identity: Uri,
        _sessionManager: IJupyterSessionManager,
        _savedSession: IJupyterSession | undefined,
        _disposableRegistry: IDisposableRegistry,
        _configService: IConfigurationService,
        _notebookMetadata?: nbformat.INotebookMetadata,
        _kernelConnection?: KernelConnectionMetadata,
        _cancelToken?: CancellationToken
    ): Promise<INotebook> {
        throw new Error('You forgot to override createNotebookInstance');
    }

    protected get isDisposed(): boolean {
        throw new Error('You forgot to override isDisposed');
    }

    private async destroyKernelSpec() {
        if (this.launchInfo) {
            this.launchInfo.kernelConnectionMetadata = undefined;
        }
    }

    private logRemoteOutput(output: string) {
        if (this.launchInfo && !this.launchInfo.connectionInfo.localLaunch) {
            this.jupyterOutputChannel.appendLine(output);
        }
    }
}
