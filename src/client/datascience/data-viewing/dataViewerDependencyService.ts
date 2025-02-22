// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { SemVer } from 'semver';
import { CancellationToken } from 'vscode';
import { IApplicationShell } from '../../common/application/types';
import { Cancellation, createPromiseFromCancellation, wrapCancellationTokens } from '../../common/cancellation';
import { ProductNames } from '../../common/installer/productNames';
import { traceWarning } from '../../common/logger';
import { IPythonExecutionFactory } from '../../common/process/types';
import { IInstaller, InstallerResponse, IsCodeSpace, Product } from '../../common/types';
import { Common, DataScience } from '../../common/utils/localize';
import { IInterpreterService } from '../../interpreter/contracts';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { parseSemVer } from '../common';
import { Telemetry } from '../constants';

const minimumSupportedPandaVersion = '0.20.0';

function isVersionOfPandasSupported(version: SemVer) {
    return version.compare(minimumSupportedPandaVersion) > 0;
}

/**
 * Responsible for managing dependencies of a Data Viewer.
 */
@injectable()
export class DataViewerDependencyService {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IPythonExecutionFactory) private pythonFactory: IPythonExecutionFactory,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IsCodeSpace) private isCodeSpace: boolean
    ) {}

    public async checkAndInstallMissingDependencies(
        interpreter?: PythonEnvironment,
        token?: CancellationToken
    ): Promise<void> {
        const pandasVersion = await this.getVersionOfPandas(interpreter, token);
        if (Cancellation.isCanceled(token)) {
            return;
        }

        if (pandasVersion) {
            if (isVersionOfPandasSupported(pandasVersion)) {
                return;
            }
            sendTelemetryEvent(Telemetry.PandasTooOld);
            // Warn user that we cannot start because pandas is too old.
            const versionStr = `${pandasVersion.major}.${pandasVersion.minor}.${pandasVersion.build}`;
            throw new Error(DataScience.pandasTooOldForViewingFormat().format(versionStr));
        }

        sendTelemetryEvent(Telemetry.PandasNotInstalled);
        await this.installMissingDependencies(interpreter, token);
    }

    private async installMissingDependencies(
        interpreter?: PythonEnvironment,
        token?: CancellationToken
    ): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });
        const selection = this.isCodeSpace
            ? Common.install()
            : await this.applicationShell.showErrorMessage(
                  DataScience.pandasRequiredForViewing(),
                  { modal: true },
                  Common.install()
              );

        // All data science dependencies require an interpreter to be passed in
        // Default to the active interpreter if no interpreter is available
        const interpreterToInstallDependenciesInto =
            interpreter || (await this.interpreterService.getActiveInterpreter());

        if (Cancellation.isCanceled(token)) {
            return;
        }

        if (selection === Common.install()) {
            const cancellatonPromise = createPromiseFromCancellation({
                cancelAction: 'resolve',
                defaultValue: InstallerResponse.Ignore,
                token
            });
            // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
            const response = await Promise.race([
                this.installer.install(
                    Product.pandas,
                    interpreterToInstallDependenciesInto,
                    wrapCancellationTokens(token)
                ),
                cancellatonPromise
            ]);
            if (response === InstallerResponse.Installed) {
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(DataScience.pandasRequiredForViewing());
        }
    }

    private async getVersionOfPandas(
        interpreter?: PythonEnvironment,
        token?: CancellationToken
    ): Promise<SemVer | undefined> {
        const launcher = await this.pythonFactory.createActivatedEnvironment({
            resource: undefined,
            interpreter,
            allowEnvironmentFetchExceptions: true,
            bypassCondaExecution: true
        });
        try {
            const result = await launcher.exec(['-c', 'import pandas;print(pandas.__version__)'], {
                throwOnStdErr: true,
                token
            });

            return parseSemVer(result.stdout);
        } catch (ex) {
            traceWarning('Failed to get version of Pandas to use Data Viewer', ex);
            return;
        }
    }
}
