// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { injectable } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken, CancellationTokenSource } from 'vscode';

import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { Cancellation } from '../../common/cancellation';
import { WrappedError } from '../../common/errors/types';
import { traceError, traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposableRegistry, IOutputChannel } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { JupyterSessionStartError } from '../baseJupyterSession';
import { Identifiers, Telemetry } from '../constants';
import { ILocalKernelFinder, IRemoteKernelFinder } from '../kernel-launcher/types';
import { trackKernelResourceInformation } from '../telemetry/telemetry';
import {
    IJupyterConnection,
    IJupyterExecution,
    IJupyterServerUri,
    IJupyterSubCommandExecutionService,
    IJupyterUriProviderRegistration,
    INotebookServer,
    INotebookServerLaunchInfo,
    INotebookServerOptions,
    JupyterServerUriHandle
} from '../types';
import { JupyterSelfCertsError } from './jupyterSelfCertsError';
import { createRemoteConnectionInfo, expandWorkingDir } from './jupyterUtils';
import { JupyterWaitForIdleError } from './jupyterWaitForIdleError';
import { kernelConnectionMetadataHasKernelSpec } from './kernels/helpers';
import { KernelSelector } from './kernels/kernelSelector';
import { KernelConnectionMetadata } from './kernels/types';
import { NotebookStarter } from './notebookStarter';

const LocalHosts = ['localhost', '127.0.0.1', '::1'];

@injectable()
export class JupyterExecutionBase implements IJupyterExecution {
    private usablePythonInterpreter: PythonEnvironment | undefined;
    private disposed: boolean = false;
    private readonly jupyterInterpreterService: IJupyterSubCommandExecutionService;
    private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration;
    private uriToJupyterServerUri = new Map<string, IJupyterServerUri>();
    private pendingTimeouts: (NodeJS.Timeout | number)[] = [];
    constructor(
        private readonly interpreterService: IInterpreterService,
        private readonly disposableRegistry: IDisposableRegistry,
        private readonly workspace: IWorkspaceService,
        private readonly configuration: IConfigurationService,
        private readonly kernelSelector: KernelSelector,
        private readonly notebookStarter: NotebookStarter,
        private readonly appShell: IApplicationShell,
        private readonly jupyterOutputChannel: IOutputChannel,
        private readonly serviceContainer: IServiceContainer
    ) {
        this.jupyterInterpreterService = serviceContainer.get<IJupyterSubCommandExecutionService>(
            IJupyterSubCommandExecutionService
        );
        this.jupyterPickerRegistration = serviceContainer.get<IJupyterUriProviderRegistration>(
            IJupyterUriProviderRegistration
        );
        this.disposableRegistry.push(this.interpreterService.onDidChangeInterpreter(() => this.onSettingsChanged()));
        this.disposableRegistry.push(this);

        if (workspace) {
            const disposable = workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('python.dataScience', undefined)) {
                    // When config changes happen, recreate our commands.
                    this.onSettingsChanged();
                }
                if (e.affectsConfiguration('jupyter.jupyterServerType', undefined)) {
                    // When server URI changes, clear our pending URI timeouts
                    this.clearTimeouts();
                }
            });
            this.disposableRegistry.push(disposable);
        }
    }

    public dispose(): Promise<void> {
        this.disposed = true;
        this.clearTimeouts();
        return Promise.resolve();
    }

    public async refreshCommands(): Promise<void> {
        await this.jupyterInterpreterService.refreshCommands();
    }

    public isNotebookSupported(cancelToken?: CancellationToken): Promise<boolean> {
        // See if we can find the command notebook
        return this.jupyterInterpreterService.isNotebookSupported(cancelToken);
    }

    public async getNotebookError(): Promise<string> {
        return this.jupyterInterpreterService.getReasonForJupyterNotebookNotBeingSupported();
    }

    public async getUsableJupyterPython(cancelToken?: CancellationToken): Promise<PythonEnvironment | undefined> {
        // Only try to compute this once.
        if (!this.usablePythonInterpreter && !this.disposed) {
            this.usablePythonInterpreter = await Cancellation.race(
                () => this.jupyterInterpreterService.getSelectedInterpreter(cancelToken),
                cancelToken
            );
        }
        return this.usablePythonInterpreter;
    }

    /* eslint-disable complexity,  */
    public connectToNotebookServer(
        options: INotebookServerOptions,
        cancelToken?: CancellationToken
    ): Promise<INotebookServer | undefined> {
        // Return nothing if we cancel
        // eslint-disable-next-line
        return Cancellation.race(async () => {
            let result: INotebookServer | undefined;
            let connection: IJupyterConnection | undefined;
            let kernelConnectionMetadata = options.kernelConnection;
            let kernelConnectionMetadataPromise: Promise<KernelConnectionMetadata | undefined> = Promise.resolve<
                KernelConnectionMetadata | undefined
            >(kernelConnectionMetadata);
            traceInfo(`Connecting to ${options ? options.purpose : 'unknown type of'} server`);
            const allowUI = !options || options.allowUI();
            const kernelSpecCancelSource = new CancellationTokenSource();
            if (cancelToken) {
                cancelToken.onCancellationRequested(() => {
                    kernelSpecCancelSource.cancel();
                });
            }
            const isLocalConnection = !options || !options.uri;

            if (isLocalConnection && !options.kernelConnection) {
                const kernelFinder = this.serviceContainer.get<ILocalKernelFinder>(ILocalKernelFinder);
                // Get hold of the kernelspec and corresponding (matching) interpreter that'll be used as the spec.
                // We can do this in parallel, while starting the server (faster).
                traceInfo(`Getting kernel specs for ${options ? options.purpose : 'unknown type of'} server`);
                kernelConnectionMetadataPromise = kernelFinder.findKernel(
                    undefined,
                    options.metadata,
                    kernelSpecCancelSource.token
                );
            }

            // Try to connect to our jupyter process. Check our setting for the number of tries
            let tryCount = 1;
            const maxTries = this.configuration.getSettings(undefined).jupyterLaunchRetries;
            const stopWatch = new StopWatch();
            while (tryCount <= maxTries && !this.disposed) {
                try {
                    // Start or connect to the process
                    [connection, kernelConnectionMetadata] = await Promise.all([
                        this.startOrConnect(options, cancelToken),
                        kernelConnectionMetadataPromise
                    ]);

                    if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                        sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
                    }
                    // Create a server tha  t we will then attempt to connect to.
                    result = this.serviceContainer.get<INotebookServer>(INotebookServer);

                    // In a remote non guest situation, figure out a kernel spec too.
                    if (
                        (!kernelConnectionMetadata ||
                            !kernelConnectionMetadataHasKernelSpec(kernelConnectionMetadata)) &&
                        connection &&
                        !options.skipSearchingForKernel
                    ) {
                        const kernelFinder = this.serviceContainer.get<IRemoteKernelFinder>(IRemoteKernelFinder);
                        kernelConnectionMetadata = await kernelFinder.findKernel(
                            options.resource,
                            connection,
                            options.metadata,
                            cancelToken
                        );
                    }

                    // Populate the launch info that we are starting our server with
                    const launchInfo: INotebookServerLaunchInfo = {
                        connectionInfo: connection!,
                        kernelConnectionMetadata,
                        workingDir: options ? options.workingDir : undefined,
                        uri: options ? options.uri : undefined,
                        purpose: options ? options.purpose : uuid(),
                        disableUI: !allowUI
                    };
                    // If we were not provided a kernel connection, this means we changed the connection here.
                    if (!options.kernelConnection) {
                        trackKernelResourceInformation(options.resource, {
                            kernelConnection: launchInfo.kernelConnectionMetadata
                        });
                    }
                    // eslint-disable-next-line no-constant-condition
                    while (true) {
                        try {
                            traceInfo(
                                `Connecting to process for ${options ? options.purpose : 'unknown type of'} server`
                            );
                            await result.connect(launchInfo, cancelToken);
                            traceInfo(
                                `Connection complete for ${options ? options.purpose : 'unknown type of'} server`
                            );
                            break;
                        } catch (ex) {
                            traceError('Failed to connect to server', ex);
                            if (ex instanceof JupyterSessionStartError && isLocalConnection && allowUI) {
                                sendTelemetryEvent(Telemetry.AskUserForNewJupyterKernel);
                                void this.kernelSelector.askForLocalKernel(options?.resource);
                            }
                            throw ex;
                        }
                    }

                    sendTelemetryEvent(
                        isLocalConnection ? Telemetry.ConnectLocalJupyter : Telemetry.ConnectRemoteJupyter
                    );
                    return result;
                } catch (err) {
                    // Cleanup after ourselves. server may be running partially.
                    if (result) {
                        traceInfo(`Killing server because of error ${err}`);
                        await result.dispose();
                    }
                    if (err instanceof JupyterWaitForIdleError && tryCount < maxTries) {
                        // Special case. This sometimes happens where jupyter doesn't ever connect. Cleanup after
                        // ourselves and propagate the failure outwards.
                        traceInfo('Retry because of wait for idle problem.');

                        // Close existing connection.
                        connection?.dispose();
                        tryCount += 1;
                    } else if (connection) {
                        kernelSpecCancelSource.cancel();

                        // If this is occurring during shutdown, don't worry about it.
                        if (this.disposed) {
                            return undefined;
                        }

                        // Something else went wrong
                        if (!isLocalConnection) {
                            sendTelemetryEvent(Telemetry.ConnectRemoteFailedJupyter, undefined, undefined, err, true);

                            // Check for the self signed certs error specifically
                            if (err.message.indexOf('reason: self signed certificate') >= 0) {
                                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                                throw new JupyterSelfCertsError(connection.baseUrl);
                            } else {
                                throw WrappedError.from(
                                    localize.DataScience.jupyterNotebookRemoteConnectFailed().format(
                                        connection.baseUrl,
                                        err
                                    ),
                                    err
                                );
                            }
                        } else {
                            sendTelemetryEvent(Telemetry.ConnectFailedJupyter, undefined, undefined, err, true);
                            throw WrappedError.from(
                                localize.DataScience.jupyterNotebookConnectFailed().format(connection.baseUrl, err),
                                err
                            );
                        }
                    } else {
                        kernelSpecCancelSource.cancel();
                        throw err;
                    }
                }
            }

            // Note: This is unlikely, so far only 1 telemetry captured for this.
            // If we're here, then starting jupyter timeout.
            // Kill any existing connections.
            connection?.dispose();
            sendTelemetryEvent(Telemetry.JupyterStartTimeout, stopWatch.elapsedTime, {
                timeout: stopWatch.elapsedTime
            });
            if (allowUI) {
                this.appShell
                    .showErrorMessage(localize.DataScience.jupyterStartTimedout(), localize.Common.openOutputPanel())
                    .then((selection) => {
                        if (selection === localize.Common.openOutputPanel()) {
                            this.jupyterOutputChannel.show();
                        }
                    }, noop);
            }
        }, cancelToken);
    }

    public getServer(_options: INotebookServerOptions): Promise<INotebookServer | undefined> {
        // This is cached at the host or guest level
        return Promise.resolve(undefined);
    }

    private async startOrConnect(
        options: INotebookServerOptions,
        cancelToken?: CancellationToken
    ): Promise<IJupyterConnection> {
        // If our uri is undefined or if it's set to local launch we need to launch a server locally
        if (!options || !options.uri) {
            // If that works, then attempt to start the server
            traceInfo(`Launching ${options.purpose} server`);
            const useDefaultConfig = !options || options.skipUsingDefaultConfig ? false : true;

            // Expand the working directory. Create a dummy launching file in the root path (so we expand correctly)
            const workingDirectory = expandWorkingDir(
                options.workingDir,
                this.workspace.rootPath ? path.join(this.workspace.rootPath, `${uuid()}.txt`) : undefined,
                this.workspace
            );

            const connection = await this.startNotebookServer(
                useDefaultConfig,
                this.configuration.getSettings(undefined).jupyterCommandLineArguments,
                workingDirectory,
                cancelToken
            );
            if (connection) {
                return connection;
            } else {
                // Throw a cancellation error if we were canceled.
                Cancellation.throwIfCanceled(cancelToken);

                // Otherwise we can't connect
                throw new Error(localize.DataScience.jupyterNotebookFailure().format(''));
            }
        } else {
            // Prepare our map of server URIs
            await this.updateServerUri(options.uri);

            // If we have a URI spec up a connection info for it
            return createRemoteConnectionInfo(options.uri, this.getServerUri.bind(this));
        }
    }

    // eslint-disable-next-line
    @captureTelemetry(Telemetry.StartJupyter)
    private async startNotebookServer(
        useDefaultConfig: boolean,
        customCommandLine: string[],
        workingDirectory: string,
        cancelToken?: CancellationToken
    ): Promise<IJupyterConnection> {
        return this.notebookStarter.start(useDefaultConfig, customCommandLine, workingDirectory, cancelToken);
    }
    private onSettingsChanged() {
        // Clear our usableJupyterInterpreter so that we recompute our values
        this.usablePythonInterpreter = undefined;
    }

    private extractJupyterServerHandleAndId(uri: string): { handle: JupyterServerUriHandle; id: string } | undefined {
        const url: URL = new URL(uri);

        // Id has to be there too.
        const id = url.searchParams.get(Identifiers.REMOTE_URI_ID_PARAM);
        const uriHandle = url.searchParams.get(Identifiers.REMOTE_URI_HANDLE_PARAM);
        return id && uriHandle ? { handle: uriHandle, id } : undefined;
    }

    private clearTimeouts() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.pendingTimeouts.forEach((t) => clearTimeout(t as any));
        this.pendingTimeouts = [];
    }

    private getServerUri(uri: string): IJupyterServerUri | undefined {
        const idAndHandle = this.extractJupyterServerHandleAndId(uri);
        if (idAndHandle) {
            return this.uriToJupyterServerUri.get(uri);
        }
    }

    private async updateServerUri(uri: string): Promise<void> {
        const idAndHandle = this.extractJupyterServerHandleAndId(uri);
        if (idAndHandle) {
            const serverUri = await this.jupyterPickerRegistration.getJupyterServerUri(
                idAndHandle.id,
                idAndHandle.handle
            );
            this.uriToJupyterServerUri.set(uri, serverUri);
            // See if there's an expiration date
            if (serverUri.expiration) {
                const timeoutInMS = serverUri.expiration.getTime() - Date.now();
                // Week seems long enough (in case the expiration is ridiculous)
                if (timeoutInMS > 0 && timeoutInMS < 604800000) {
                    this.pendingTimeouts.push(setTimeout(() => this.updateServerUri(uri).ignoreErrors(), timeoutInMS));
                }
            }
        }
    }
}
