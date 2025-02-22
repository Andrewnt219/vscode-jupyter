/* eslint-disable max-classes-per-file */

import { inject, injectable, named } from 'inversify';
import { CancellationToken, Memento, OutputChannel, Uri } from 'vscode';
import { IPythonInstaller } from '../../api/types';
import '../../common/extensions';
import { InterpreterPackages } from '../../datascience/telemetry/interpreterPackages';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { getInterpreterHash } from '../../pythonEnvironments/info/interpreter';
import { IApplicationShell } from '../application/types';
import { STANDARD_OUTPUT_CHANNEL } from '../constants';
import { traceError } from '../logger';
import { IProcessServiceFactory, IPythonExecutionFactory } from '../process/types';
import {
    IConfigurationService,
    IInstaller,
    InstallerResponse,
    IOutputChannel,
    ModuleNamePurpose,
    Product
} from '../types';
import { sleep } from '../utils/async';
import { isResource } from '../utils/misc';
import { ProductNames } from './productNames';
import { InterpreterUri, IProductPathService } from './types';

export { Product } from '../types';

/**
 * Keep track of the fact that we attempted to install a package into an interpreter.
 * (don't care whether it was successful or not).
 */
export async function trackPackageInstalledIntoInterpreter(
    memento: Memento,
    product: Product,
    interpreter: InterpreterUri
) {
    if (isResource(interpreter)) {
        return;
    }
    const key = `${getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    await memento.update(key, true);
}
export async function clearInstalledIntoInterpreterMemento(
    memento: Memento,
    product: Product,
    interpreterPath: string
) {
    const key = `${getInterpreterHash({ path: interpreterPath })}#${ProductNames.get(product)}`;
    await memento.update(key, undefined);
}
export async function isModulePresentInEnvironment(memento: Memento, product: Product, interpreter?: InterpreterUri) {
    if (isResource(interpreter)) {
        return;
    }
    const key = `${getInterpreterHash(interpreter)}#${ProductNames.get(product)}`;
    if (memento.get(key, false)) {
        return true;
    }
    const packageName = translateProductToModule(product);
    const packageVersionPromise = InterpreterPackages.getPackageVersion(interpreter, packageName)
        .then((version) => (typeof version === 'string' ? 'found' : 'notfound'))
        .catch((ex) => traceError('Failed to get interpreter package version', ex));
    try {
        // Dont wait for too long we don't want to delay installation prompt.
        const version = await Promise.race([sleep(500), packageVersionPromise]);
        if (typeof version === 'string') {
            return version === 'found';
        }
    } catch (ex) {
        traceError(`Failed to check if package exists ${ProductNames.get(product)}`);
    }
}

export abstract class BaseInstaller {
    protected readonly appShell: IApplicationShell;
    protected readonly configService: IConfigurationService;

    constructor(protected serviceContainer: IServiceContainer, protected outputChannel: OutputChannel) {
        this.appShell = serviceContainer.get<IApplicationShell>(IApplicationShell);
        this.configService = serviceContainer.get<IConfigurationService>(IConfigurationService);
    }

    public async install(
        product: Product,
        resource?: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean
    ): Promise<InstallerResponse> {
        return this.serviceContainer
            .get<IPythonInstaller>(IPythonInstaller)
            .install(product, resource, cancel, reInstallAndUpdate);
    }

    public async isInstalled(product: Product, resource?: InterpreterUri): Promise<boolean | undefined> {
        // User may have customized the module name or provided the fully qualified path.
        const interpreter = isResource(resource) ? undefined : resource;
        const uri = isResource(resource) ? resource : undefined;
        const executableName = this.getExecutableNameFromSettings(product, uri);

        const isModule = this.isExecutableAModule(product, uri);
        if (isModule) {
            const pythonProcess = await this.serviceContainer
                .get<IPythonExecutionFactory>(IPythonExecutionFactory)
                .createActivatedEnvironment({ resource: uri, interpreter, allowEnvironmentFetchExceptions: true });
            return pythonProcess.isModuleInstalled(executableName);
        } else {
            const process = await this.serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory).create(uri);
            return process
                .exec(executableName, ['--version'], { mergeStdOutErr: true })
                .then(() => true)
                .catch(() => false);
        }
    }

    protected getExecutableNameFromSettings(product: Product, resource?: Uri): string {
        const productPathService = this.serviceContainer.get<IProductPathService>(IProductPathService);
        return productPathService.getExecutableNameFromSettings(product, resource);
    }
    protected isExecutableAModule(product: Product, resource?: Uri): Boolean {
        const productPathService = this.serviceContainer.get<IProductPathService>(IProductPathService);
        return productPathService.isExecutableAModule(product, resource);
    }
}

export class DataScienceInstaller extends BaseInstaller {
    // Override base installer to support a more DS-friendly streamlined installation.
    public async install(
        product: Product,
        interpreterUri?: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean
    ): Promise<InstallerResponse> {
        // Precondition
        if (isResource(interpreterUri)) {
            throw new Error('All data science packages require an interpreter be passed in');
        }
        const installer = this.serviceContainer.get<IPythonInstaller>(IPythonInstaller);

        // At this point we know that `interpreterUri` is of type PythonInterpreter
        const interpreter = interpreterUri as PythonEnvironment;
        const result = await installer.install(product, interpreter, cancel, reInstallAndUpdate);

        if (result === InstallerResponse.Disabled || result === InstallerResponse.Ignore) {
            return result;
        }

        return this.isInstalled(product, interpreter).then((isInstalled) =>
            isInstalled ? InstallerResponse.Installed : InstallerResponse.Ignore
        );
    }
}

@injectable()
export class ProductInstaller implements IInstaller {
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private outputChannel: OutputChannel
    ) {}

    // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
    public dispose() {}
    public async install(
        product: Product,
        resource: InterpreterUri,
        cancel?: CancellationToken,
        reInstallAndUpdate?: boolean
    ): Promise<InstallerResponse> {
        return this.createInstaller().install(product, resource, cancel, reInstallAndUpdate);
    }
    public async isInstalled(product: Product, resource?: InterpreterUri): Promise<boolean | undefined> {
        return this.createInstaller().isInstalled(product, resource);
    }
    public translateProductToModuleName(product: Product, _purpose: ModuleNamePurpose): string {
        return translateProductToModule(product);
    }
    private createInstaller(): BaseInstaller {
        return new DataScienceInstaller(this.serviceContainer, this.outputChannel);
    }
}

// eslint-disable-next-line complexity
function translateProductToModule(product: Product): string {
    switch (product) {
        case Product.jupyter:
            return 'jupyter';
        case Product.notebook:
            return 'notebook';
        case Product.pandas:
            return 'pandas';
        case Product.ipykernel:
            return 'ipykernel';
        case Product.nbconvert:
            return 'nbconvert';
        case Product.kernelspec:
            return 'kernelspec';
        default: {
            throw new Error(`Product ${product} cannot be installed as a Python Module.`);
        }
    }
}
