// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
/* eslint-disable comma-dangle, @typescript-eslint/no-explicit-any */
import { ReactWrapper } from 'enzyme';
import { interfaces } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import { SemVer } from 'semver';
import { anyString, anything, instance, mock, reset, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import {
    CancellationTokenSource,
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    FileSystemWatcher,
    Memento,
    Uri,
    WindowState,
    WorkspaceFolder,
    WorkspaceFoldersChangeEvent
} from 'vscode';
import { KernelDaemonPool } from '../../client/datascience/kernel-launcher/kernelDaemonPool';

import { IExtensionSingleActivationService } from '../../client/activation/types';
import { PythonExtensionChecker } from '../../client/api/pythonApi';
import {
    ILanguageServerProvider,
    IPythonDebuggerPathProvider,
    IPythonExtensionChecker,
    IPythonInstaller
} from '../../client/api/types';
import { ApplicationEnvironment } from '../../client/common/application/applicationEnvironment';
import { ApplicationShell } from '../../client/common/application/applicationShell';
import { VSCodeNotebook } from '../../client/common/application/notebook';
import {
    IApplicationEnvironment,
    IApplicationShell,
    ICommandManager,
    IDebugService,
    IDocumentManager,
    IEncryptedStorage,
    IVSCodeNotebook,
    IWebviewPanelOptions,
    IWebviewPanelProvider,
    IWebviewViewProvider,
    IWorkspaceService
} from '../../client/common/application/types';
import { WebviewPanelProvider } from '../../client/common/application/webviewPanels/webviewPanelProvider';
import { WorkspaceService } from '../../client/common/application/workspace';
import { AsyncDisposableRegistry } from '../../client/common/asyncDisposableRegistry';
import { JupyterSettings } from '../../client/common/configSettings';
import { EXTENSION_ROOT_DIR } from '../../client/common/constants';
import { CryptoUtils } from '../../client/common/crypto';
import { ExperimentService } from '../../client/common/experiments/service';
import { ProductInstaller } from '../../client/common/installer/productInstaller';
import { DataScienceProductPathService } from '../../client/common/installer/productPath';
import { IProductPathService } from '../../client/common/installer/types';
import { traceError, traceInfo, traceInfoIfCI } from '../../client/common/logger';
import { BrowserService } from '../../client/common/net/browser';
import { IS_WINDOWS } from '../../client/common/platform/constants';
import { PathUtils } from '../../client/common/platform/pathUtils';
import { PlatformService } from '../../client/common/platform/platformService';
import { IFileSystem, IPlatformService } from '../../client/common/platform/types';
import { BufferDecoder } from '../../client/common/process/decoder';
import { ProcessLogger } from '../../client/common/process/logger';
import { ProcessServiceFactory } from '../../client/common/process/processFactory';
import { PythonExecutionFactory } from '../../client/common/process/pythonExecutionFactory';
import {
    IBufferDecoder,
    IProcessLogger,
    IProcessServiceFactory,
    IPythonExecutionFactory
} from '../../client/common/process/types';
import {
    GLOBAL_MEMENTO,
    IAsyncDisposableRegistry,
    IBrowserService,
    IConfigurationService,
    ICryptoUtils,
    IDisposable,
    IExperimentService,
    IExtensionContext,
    IExtensions,
    IInstaller,
    IJupyterSettings,
    IMemento,
    IOutputChannel,
    IPathUtils,
    IPersistentStateFactory,
    IsCodeSpace,
    IsWindows,
    IWatchableJupyterSettings,
    ProductInstallStatus,
    Resource,
    WORKSPACE_MEMENTO
} from '../../client/common/types';
import { sleep } from '../../client/common/utils/async';
import { noop } from '../../client/common/utils/misc';
import { IMultiStepInputFactory, MultiStepInputFactory } from '../../client/common/utils/multiStepInput';
import { EnvironmentVariablesService } from '../../client/common/variables/environment';
import { EnvironmentVariablesProvider } from '../../client/common/variables/environmentVariablesProvider';
import { IEnvironmentVariablesProvider, IEnvironmentVariablesService } from '../../client/common/variables/types';
import { CodeCssGenerator } from '../../client/datascience/codeCssGenerator';
import { JupyterCommandLineSelectorCommand } from '../../client/datascience/commands/commandLineSelector';
import { CommandRegistry } from '../../client/datascience/commands/commandRegistry';
import { ExportCommands } from '../../client/datascience/commands/exportCommands';
import { NotebookCommands } from '../../client/datascience/commands/notebookCommands';
import { JupyterServerSelectorCommand } from '../../client/datascience/commands/serverSelector';
import { DataScienceStartupTime, Identifiers, JUPYTER_OUTPUT_CHANNEL } from '../../client/datascience/constants';
import { ActiveEditorContextService } from '../../client/datascience/commands/activeEditorContext';
import { DataViewer } from '../../client/datascience/data-viewing/dataViewer';
import { DataViewerDependencyService } from '../../client/datascience/data-viewing/dataViewerDependencyService';
import { DataViewerFactory } from '../../client/datascience/data-viewing/dataViewerFactory';
import { JupyterVariableDataProvider } from '../../client/datascience/data-viewing/jupyterVariableDataProvider';
import { JupyterVariableDataProviderFactory } from '../../client/datascience/data-viewing/jupyterVariableDataProviderFactory';
import { IDataViewer, IDataViewerFactory } from '../../client/datascience/data-viewing/types';
import { DebugLocationTrackerFactory } from '../../client/datascience/debugLocationTrackerFactory';
import { CodeLensFactory } from '../../client/datascience/editor-integration/codeLensFactory';
import { DataScienceCodeLensProvider } from '../../client/datascience/editor-integration/codelensprovider';
import { CodeWatcher } from '../../client/datascience/editor-integration/codewatcher';
import { HoverProvider } from '../../client/datascience/editor-integration/hoverProvider';
import { DataScienceErrorHandler } from '../../client/datascience/errorHandler/errorHandler';
import { ExportBase } from '../../client/datascience/export/exportBase';
import { ExportFileOpener } from '../../client/datascience/export/exportFileOpener';
import { ExportInterpreterFinder } from '../../client/datascience/export/exportInterpreterFinder';
import { ExportManager } from '../../client/datascience/export/exportManager';
import { ExportDialog } from '../../client/datascience/export/exportDialog';
import { ExportToHTML } from '../../client/datascience/export/exportToHTML';
import { ExportToPDF } from '../../client/datascience/export/exportToPDF';
import { ExportToPython } from '../../client/datascience/export/exportToPython';
import { ExportUtil } from '../../client/datascience/export/exportUtil';
import { ExportFormat, IExport, IExportManager, IExportDialog } from '../../client/datascience/export/types';
import { NotebookProvider } from '../../client/datascience/interactive-common/notebookProvider';
import { NotebookServerProvider } from '../../client/datascience/interactive-common/notebookServerProvider';
import { NativeEditorCommandListener } from '../../client/datascience/interactive-ipynb/nativeEditorCommandListener';
import { IPyWidgetMessageDispatcherFactory } from '../../client/datascience/ipywidgets/ipyWidgetMessageDispatcherFactory';
import { JupyterCommandLineSelector } from '../../client/datascience/jupyter/commandLineSelector';
import { DebuggerVariableRegistration } from '../../client/datascience/jupyter/debuggerVariableRegistration';
import { DebuggerVariables } from '../../client/datascience/jupyter/debuggerVariables';
import { JupyterCommandFactory } from '../../client/datascience/jupyter/interpreter/jupyterCommand';
import { JupyterInterpreterDependencyService } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService';
import { JupyterInterpreterOldCacheStateStore } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterOldCacheStateStore';
import { JupyterInterpreterSelectionCommand } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterSelectionCommand';
import { JupyterInterpreterSelector } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterSelector';
import { JupyterInterpreterService } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterService';
import { JupyterInterpreterStateStore } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterStateStore';
import { JupyterInterpreterSubCommandExecutionService } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService';
import { NbConvertExportToPythonService } from '../../client/datascience/jupyter/interpreter/nbconvertExportToPythonService';
import { NbConvertInterpreterDependencyChecker } from '../../client/datascience/jupyter/interpreter/nbconvertInterpreterDependencyChecker';
import { JupyterDebugger } from '../../client/datascience/jupyter/jupyterDebugger';
import { JupyterExporter } from '../../client/datascience/jupyter/jupyterExporter';
import { JupyterImporter } from '../../client/datascience/jupyter/jupyterImporter';
import { JupyterNotebookProvider } from '../../client/datascience/jupyter/jupyterNotebookProvider';
import { JupyterPasswordConnect } from '../../client/datascience/jupyter/jupyterPasswordConnect';
import { JupyterSessionManagerFactory } from '../../client/datascience/jupyter/jupyterSessionManagerFactory';
import { JupyterVariables } from '../../client/datascience/jupyter/jupyterVariables';
import { KernelDependencyService } from '../../client/datascience/jupyter/kernels/kernelDependencyService';
import { KernelSelector } from '../../client/datascience/jupyter/kernels/kernelSelector';
import { JupyterKernelService } from '../../client/datascience/jupyter/kernels/jupyterKernelService';
import { KernelVariables } from '../../client/datascience/jupyter/kernelVariables';
import { NotebookStarter } from '../../client/datascience/jupyter/notebookStarter';
import { JupyterServerSelector } from '../../client/datascience/jupyter/serverSelector';
import { JupyterDebugService } from '../../client/datascience/jupyterDebugService';
import { JupyterUriProviderRegistration } from '../../client/datascience/jupyterUriProviderRegistration';
import { KernelDaemonPreWarmer } from '../../client/datascience/kernel-launcher/kernelDaemonPreWarmer';
import { LocalKernelFinder } from '../../client/datascience/kernel-launcher/localKernelFinder';
import { KernelLauncher } from '../../client/datascience/kernel-launcher/kernelLauncher';
import {
    ILocalKernelFinder,
    IKernelLauncher,
    IRemoteKernelFinder
} from '../../client/datascience/kernel-launcher/types';
import { NotebookCellLanguageService } from '../../client/datascience/notebook/cellLanguageService';
import { NotebookCreationTracker } from '../../client/datascience/notebookAndInteractiveTracker';
import { PlotViewer } from '../../client/datascience/plotting/plotViewer';
import { PlotViewerProvider } from '../../client/datascience/plotting/plotViewerProvider';
import { ProgressReporter } from '../../client/datascience/progress/progressReporter';
import { RawNotebookSupportedService } from '../../client/datascience/raw-kernel/rawNotebookSupportedService';
import { StatusProvider } from '../../client/datascience/statusProvider';
import { ThemeFinder } from '../../client/datascience/themeFinder';
import {
    ICellHashListener,
    ICodeCssGenerator,
    ICodeLensFactory,
    ICodeWatcher,
    IDataScience,
    IDataScienceCodeLensProvider,
    IDataScienceCommandListener,
    IDataScienceErrorHandler,
    IDebugLocationTracker,
    IJupyterCommandFactory,
    IJupyterDebugger,
    IJupyterDebugService,
    IJupyterExecution,
    IJupyterInterpreterDependencyManager,
    IJupyterNotebookProvider,
    IJupyterPasswordConnect,
    IJupyterServerProvider,
    IJupyterServerUriStorage,
    IJupyterSessionManagerFactory,
    IJupyterSubCommandExecutionService,
    IJupyterUriProviderRegistration,
    IJupyterVariableDataProvider,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    IKernelDependencyService,
    IKernelVariableRequester,
    INbConvertExportToPythonService,
    INbConvertInterpreterDependencyChecker,
    INotebookCreationTracker,
    INotebookExporter,
    INotebookImporter,
    INotebookProvider,
    INotebookServer,
    IPlotViewer,
    IPlotViewerProvider,
    IRawNotebookProvider,
    IRawNotebookSupportedService,
    IStatusProvider,
    IThemeFinder
} from '../../client/datascience/types';
import { INotebookWatcher, IVariableViewProvider } from '../../client/datascience/variablesView/types';
import { VariableViewActivationService } from '../../client/datascience/variablesView/variableViewActivationService';
import { VariableViewProvider } from '../../client/datascience/variablesView/variableViewProvider';
import { ProtocolParser } from '../../client/debugger/extension/helpers/protocolParser';
import { IProtocolParser } from '../../client/debugger/extension/types';
import { IEnvironmentActivationService } from '../../client/interpreter/activation/types';
import { IInterpreterSelector } from '../../client/interpreter/configuration/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IWindowsStoreInterpreter } from '../../client/interpreter/locators/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { CodeExecutionHelper } from '../../client/terminals/codeExecution/helper';
import { ICodeExecutionHelper } from '../../client/terminals/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants';
import { EnvironmentActivationService } from '../interpreters/envActivation';
import { InterpreterService } from '../interpreters/interpreterService';
import { InterpreterSelector } from '../interpreters/selector';
import { WindowsStoreInterpreter } from '../interpreters/winStoreInterpreter';
import { MockOutputChannel } from '../mockClasses';
import { MockMemento } from '../mocks/mementos';
import { UnitTestIocContainer } from '../testing/serviceRegistry';
import { MockCommandManager } from './mockCommandManager';
import { MockDebuggerService } from './mockDebugService';
import { MockDocumentManager } from './mockDocumentManager';
import { MockFileSystem } from './mockFileSystem';
import { MockJupyterManager, SupportedCommands } from './mockJupyterManager';
import { MockJupyterManagerFactory } from './mockJupyterManagerFactory';
import { MockJupyterSettings } from './mockJupyterSettings';
import { MockLanguageServerProvider } from './mockLanguageServerProvider';
import { MockWorkspaceConfiguration } from './mockWorkspaceConfig';
import { MockWorkspaceFolder } from './mockWorkspaceFolder';
import { IMountedWebView } from './mountedWebView';
import { IMountedWebViewFactory, MountedWebViewFactory } from './mountedWebViewFactory';
import { TestPersistentStateFactory } from './testPersistentStateFactory';
import { JupyterServerUriStorage } from '../../client/datascience/jupyter/serverUriStorage';
import { MockEncryptedStorage } from './mockEncryptedStorage';
import { WebviewViewProvider } from '../../client/common/application/webviewViews/webviewViewProvider';
import { KernelEnvironmentVariablesService } from '../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { PreferredRemoteKernelIdProvider } from '../../client/datascience/notebookStorage/preferredRemoteKernelIdProvider';
import { NotebookWatcher } from '../../client/datascience/variablesView/notebookWatcher';
import { InterpreterPackages } from '../../client/datascience/telemetry/interpreterPackages';
import { RemoteKernelFinder } from '../../client/datascience/kernel-launcher/remoteKernelFinder';
import { Extensions } from '../../client/common/application/extensions';
import { NotebookCreator } from '../../client/datascience/notebook/creation/notebookCreator';
import { CreationOptionService } from '../../client/datascience/notebook/creation/creationOptionsService';
import { PythonVariablesRequester } from '../../client/datascience/jupyter/pythonVariableRequester';
import { LocalKnownPathKernelSpecFinder } from '../../client/datascience/kernel-launcher/localKnownPathKernelSpecFinder';
import { JupyterPaths } from '../../client/datascience/kernel-launcher/jupyterPaths';
import { LocalPythonAndRelatedNonPythonKernelSpecFinder } from '../../client/datascience/kernel-launcher/localPythonAndRelatedNonPythonKernelSpecFinder';
import { HostJupyterExecution } from '../../client/datascience/jupyter/liveshare/hostJupyterExecution';
import { HostJupyterServer } from '../../client/datascience/jupyter/liveshare/hostJupyterServer';
import { HostRawNotebookProvider } from '../../client/datascience/raw-kernel/liveshare/hostRawNotebookProvider';
import { CellHashProviderFactory } from '../../client/datascience/editor-integration/cellHashProviderFactory';

export class DataScienceIocContainer extends UnitTestIocContainer {
    public get workingInterpreter() {
        return this.workingPython;
    }

    public get workingInterpreter2() {
        return this.workingPython2;
    }

    public get onContextSet(): Event<{ name: string; value: boolean }> {
        return this.contextSetEvent.event;
    }

    public get mockJupyter(): MockJupyterManager | undefined {
        return this.jupyterMock ? this.jupyterMock.getManager() : undefined;
    }

    public get isRawKernel(): boolean {
        return !this.mockJupyter && !this.getSettings().disableZMQSupport;
    }

    public get kernelService() {
        return this.kernelServiceMock;
    }
    public get kernelFinder() {
        return this.kernelFinderMock;
    }
    private static jupyterInterpreters: PythonEnvironment[] = [];
    public applicationShell!: ApplicationShell;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public datascience!: TypeMoq.IMock<IDataScience>;
    public shouldMockJupyter: boolean;
    public attemptedPythonExtension: boolean = false;
    private commandManager: MockCommandManager = new MockCommandManager();
    private setContexts: Record<string, boolean> = {};
    private contextSetEvent: EventEmitter<{ name: string; value: boolean }> = new EventEmitter<{
        name: string;
        value: boolean;
    }>();
    private jupyterMock: MockJupyterManagerFactory | undefined;
    private asyncRegistry: AsyncDisposableRegistry;
    private configChangeEvent = new EventEmitter<ConfigurationChangeEvent>();
    private worksaceFoldersChangedEvent = new EventEmitter<WorkspaceFoldersChangeEvent>();
    private documentManager = new MockDocumentManager();
    private workingPython: PythonEnvironment = {
        path: '/foo/bar/python.exe',
        version: new SemVer('3.6.6-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        displayName: 'Python'
    };
    private workingPython2: PythonEnvironment = {
        path: '/foo/baz/python.exe',
        version: new SemVer('3.6.7-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        displayName: 'Python'
    };

    private webPanelProvider = mock(WebviewPanelProvider);
    private settingsMap = new Map<string, any>();
    private configMap = new Map<string, MockWorkspaceConfiguration>();
    private emptyConfig = new MockWorkspaceConfiguration();
    private workspaceFolders: MockWorkspaceFolder[] = [];
    private kernelServiceMock = mock(JupyterKernelService);
    private kernelFinderMock = mock(LocalKernelFinder);
    private disposed = false;
    private experimentState = new Map<string, boolean>();
    private extensionRootPath: string | undefined;
    private pendingWebPanel: IMountedWebView | undefined;
    private pythonExtensionState: boolean = true;

    constructor() {
        super();
        this.useVSCodeAPI = false;
        const isRollingBuild = process.env ? process.env.VSC_FORCE_REAL_JUPYTER !== undefined : false;
        this.shouldMockJupyter = !isRollingBuild;
        this.asyncRegistry = new AsyncDisposableRegistry();
    }

    public async dispose(): Promise<void> {
        // Make sure to disable all command handling during dispose. Don't want
        // anything to startup again.
        this.commandManager.dispose();
        await this.asyncRegistry.dispose();
        await super.dispose();
        this.disposed = true;

        // Blur window focus so we don't have editors polling
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const reactHelpers = require('./reactHelpers') as typeof import('./reactHelpers');
        reactHelpers.blurWindow();

        // Bounce this so that our editor has time to shutdown
        await sleep(150);

        // Because there are outstanding promises holding onto this object, clear out everything we can
        this.workspaceFolders = [];
        this.settingsMap.clear();
        this.configMap.clear();
        this.setContexts = {};
        reset(this.webPanelProvider);
    }

    /* eslint-disable  */
    public registerDataScienceTypes() {
        this.serviceManager.addSingletonInstance<number>(DataScienceStartupTime, Date.now());
        this.serviceManager.addSingletonInstance<DataScienceIocContainer>(DataScienceIocContainer, this);

        // Create the workspace service first as it's used to set config values.
        this.createWorkspaceService();

        this.serviceManager.addSingleton<IPlatformService>(IPlatformService, PlatformService);

        // Setup our webpanel provider to create our dummy web panel
        when(this.webPanelProvider.create(anything())).thenCall(this.onCreateWebPanel.bind(this));
        this.serviceManager.addSingletonInstance<IWebviewPanelProvider>(
            IWebviewPanelProvider,
            instance(this.webPanelProvider)
        );
        this.serviceManager.addSingleton<IWebviewViewProvider>(IWebviewViewProvider, WebviewViewProvider);
        this.serviceManager.addSingleton<IExportManager>(IExportManager, ExportManager);
        this.serviceManager.addSingleton<ExportInterpreterFinder>(ExportInterpreterFinder, ExportInterpreterFinder);
        this.serviceManager.addSingleton<ExportFileOpener>(ExportFileOpener, ExportFileOpener);
        this.serviceManager.addSingleton<IExport>(IExport, ExportToPDF, ExportFormat.pdf);
        this.serviceManager.addSingleton<IExport>(IExport, ExportToHTML, ExportFormat.html);
        this.serviceManager.addSingleton<IExport>(IExport, ExportToPython, ExportFormat.python);
        this.serviceManager.addSingleton<IExport>(IExport, ExportBase, 'Export Base');
        this.serviceManager.addSingleton<ExportUtil>(ExportUtil, ExportUtil);
        this.serviceManager.addSingleton<ExportCommands>(ExportCommands, ExportCommands);
        this.serviceManager.addSingleton<IExportDialog>(IExportDialog, ExportDialog);
        this.serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(
            PreferredRemoteKernelIdProvider,
            PreferredRemoteKernelIdProvider
        );
        this.serviceManager.addSingleton<INbConvertInterpreterDependencyChecker>(
            INbConvertInterpreterDependencyChecker,
            NbConvertInterpreterDependencyChecker
        );
        this.serviceManager.addSingleton<INbConvertExportToPythonService>(
            INbConvertExportToPythonService,
            NbConvertExportToPythonService
        );
        const mockInstaller = mock<IPythonInstaller>();
        when(mockInstaller.isProductVersionCompatible(anything(), anything(), anything())).thenResolve(
            ProductInstallStatus.NeedsUpgrade
        );
        this.serviceManager.addSingletonInstance<IPythonInstaller>(IPythonInstaller, instance(mockInstaller));
        this.serviceManager.addSingletonInstance<InterpreterPackages>(
            InterpreterPackages,
            instance(mock(InterpreterPackages))
        );
        this.serviceManager.addSingleton<IMountedWebViewFactory>(IMountedWebViewFactory, MountedWebViewFactory);
        this.serviceManager.addSingletonInstance<IFileSystem>(IFileSystem, new MockFileSystem());
        this.serviceManager.addSingleton<IJupyterExecution>(IJupyterExecution, HostJupyterExecution);
        this.serviceManager.addSingletonInstance(IsCodeSpace, false);
        this.serviceManager.addSingleton<IDataViewerFactory>(IDataViewerFactory, DataViewerFactory);
        this.serviceManager.add<IJupyterVariableDataProvider>(
            IJupyterVariableDataProvider,
            JupyterVariableDataProvider
        );
        this.serviceManager.addSingleton<IJupyterVariableDataProviderFactory>(
            IJupyterVariableDataProviderFactory,
            JupyterVariableDataProviderFactory
        );
        this.serviceManager.addSingleton<IPlotViewerProvider>(IPlotViewerProvider, PlotViewerProvider);
        this.serviceManager.add<IDataViewer>(IDataViewer, DataViewer);
        this.serviceManager.add<IPlotViewer>(IPlotViewer, PlotViewer);

        const experimentService = mock(ExperimentService);
        this.serviceManager.addSingletonInstance<IExperimentService>(IExperimentService, instance(experimentService));
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenCall(this.isPythonExtensionInstalled.bind(this));
        when(extensionChecker.isPythonExtensionActive).thenCall(this.isPythonExtensionInstalled.bind(this));
        when(extensionChecker.showPythonExtensionInstallRequiredPrompt()).thenCall(
            this.installPythonExtension.bind(this)
        );
        this.serviceManager.addSingletonInstance<IPythonExtensionChecker>(
            IPythonExtensionChecker,
            instance(extensionChecker)
        );

        // Adjust all experiments to be on by default
        when(experimentService.inExperiment(anything())).thenCall((exp) => {
            // VariableViewActivationService has an issue with the mock ExtensionContext in the functional tests
            // Turn off the experiment until we add the testing (which will probably be in .vscode tests)
            if (exp === 'NativeVariableView') {
                return Promise.resolve(false);
            }
            const setState = this.experimentState.get(exp);
            if (setState === undefined) {
                // All experiments on by default
                return Promise.resolve(true);
            }
            return Promise.resolve(setState);
        });

        this.serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
        this.serviceManager.add<INotebookImporter>(INotebookImporter, JupyterImporter);
        this.serviceManager.add<INotebookExporter>(INotebookExporter, JupyterExporter);
        const mockExtension = mock(Extensions);
        when(mockExtension.all).thenReturn([]);
        when(mockExtension.getExtension(anything())).thenReturn();
        when(mockExtension.onDidChange).thenReturn(new EventEmitter<void>().event);
        this.serviceManager.addSingletonInstance<IExtensions>(IExtensions, instance(mockExtension));
        this.serviceManager.add<INotebookServer>(INotebookServer, HostJupyterServer);
        this.serviceManager.add<IJupyterCommandFactory>(IJupyterCommandFactory, JupyterCommandFactory);
        this.serviceManager.addSingleton<IRawNotebookProvider>(IRawNotebookProvider, HostRawNotebookProvider);
        this.serviceManager.addSingleton<IRawNotebookSupportedService>(
            IRawNotebookSupportedService,
            RawNotebookSupportedService
        );
        this.serviceManager.addSingleton<IThemeFinder>(IThemeFinder, ThemeFinder);
        this.serviceManager.addSingleton<ICodeCssGenerator>(ICodeCssGenerator, CodeCssGenerator);
        this.serviceManager.addSingleton<IStatusProvider>(IStatusProvider, StatusProvider);
        this.serviceManager.addSingleton<IBrowserService>(IBrowserService, BrowserService);
        this.serviceManager.addSingleton<NotebookCellLanguageService>(
            NotebookCellLanguageService,
            NotebookCellLanguageService
        );
        this.serviceManager.addSingletonInstance<IAsyncDisposableRegistry>(
            IAsyncDisposableRegistry,
            this.asyncRegistry
        );
        this.serviceManager.add<ICodeWatcher>(ICodeWatcher, CodeWatcher);
        this.serviceManager.add<IDataScienceCodeLensProvider>(
            IDataScienceCodeLensProvider,
            DataScienceCodeLensProvider
        );
        this.serviceManager.add<IVariableViewProvider>(IVariableViewProvider, VariableViewProvider);
        this.serviceManager.add<ICodeExecutionHelper>(ICodeExecutionHelper, CodeExecutionHelper);
        this.serviceManager.addSingleton<IDataScienceErrorHandler>(IDataScienceErrorHandler, DataScienceErrorHandler);
        this.serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            DebuggerVariableRegistration
        );
        this.serviceManager.addSingleton<IJupyterVariables>(
            IJupyterVariables,
            JupyterVariables,
            Identifiers.ALL_VARIABLES
        );
        this.serviceManager.addSingleton<IJupyterVariables>(
            IJupyterVariables,
            KernelVariables,
            Identifiers.KERNEL_VARIABLES
        );
        this.serviceManager.addSingleton<IJupyterVariables>(
            IJupyterVariables,
            DebuggerVariables,
            Identifiers.DEBUGGER_VARIABLES
        );
        this.serviceManager.addSingleton<IKernelVariableRequester>(
            IKernelVariableRequester,
            PythonVariablesRequester,
            Identifiers.PYTHON_VARIABLES_REQUESTER
        );
        this.serviceManager.addSingleton<IJupyterDebugger>(IJupyterDebugger, JupyterDebugger, undefined, [
            ICellHashListener
        ]);
        this.serviceManager.addSingleton<IDebugLocationTracker>(IDebugLocationTracker, DebugLocationTrackerFactory);
        this.serviceManager.addSingleton<DataViewerDependencyService>(
            DataViewerDependencyService,
            DataViewerDependencyService
        );

        this.serviceManager.addSingleton<IDataScienceCommandListener>(
            IDataScienceCommandListener,
            NativeEditorCommandListener
        );
        this.serviceManager.addSingletonInstance<IOutputChannel>(
            IOutputChannel,
            instance(mock(MockOutputChannel)),
            JUPYTER_OUTPUT_CHANNEL
        );
        this.serviceManager.addSingleton<ICryptoUtils>(ICryptoUtils, CryptoUtils);
        this.serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            VariableViewActivationService
        );
        const mockExtensionContext = TypeMoq.Mock.ofType<IExtensionContext>();
        mockExtensionContext.setup((m) => m.globalStorageUri).returns(() => Uri.file(os.tmpdir()));
        const globalState = new MockMemento();
        mockExtensionContext.setup((m) => m.globalState).returns(() => globalState);
        mockExtensionContext.setup((m) => m.extensionPath).returns(() => this.extensionRootPath || os.tmpdir());
        mockExtensionContext.setup((m) => m.subscriptions).returns(() => []);
        this.serviceManager.addSingletonInstance<IExtensionContext>(IExtensionContext, mockExtensionContext.object);

        const mockServerSelector = mock(JupyterServerSelector);
        this.serviceManager.addSingletonInstance<JupyterServerSelector>(
            JupyterServerSelector,
            instance(mockServerSelector)
        );

        this.serviceManager.addSingletonInstance<NotebookCreator>(NotebookCreator, instance(mock(NotebookCreator)));
        const creationService = mock<CreationOptionService>();
        when(creationService.registrations).thenReturn([]);
        this.serviceManager.addSingletonInstance<CreationOptionService>(
            CreationOptionService,
            instance(creationService)
        );

        this.serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
        this.serviceManager.addSingleton<IJupyterNotebookProvider>(IJupyterNotebookProvider, JupyterNotebookProvider);
        this.serviceManager.addSingleton<IJupyterServerProvider>(IJupyterServerProvider, NotebookServerProvider);

        this.serviceManager.addSingleton<IPyWidgetMessageDispatcherFactory>(
            IPyWidgetMessageDispatcherFactory,
            IPyWidgetMessageDispatcherFactory
        );
        this.serviceManager.add<IProtocolParser>(IProtocolParser, ProtocolParser);
        this.serviceManager.addSingleton<IJupyterDebugService>(
            IJupyterDebugService,
            JupyterDebugService,
            Identifiers.RUN_BY_LINE_DEBUGSERVICE
        );
        const mockDebugService = new MockDebuggerService(
            this.serviceManager.get<IJupyterDebugService>(IJupyterDebugService, Identifiers.RUN_BY_LINE_DEBUGSERVICE)
        );
        this.serviceManager.addSingletonInstance<IDebugService>(IDebugService, mockDebugService);
        this.serviceManager.addSingletonInstance<IJupyterDebugService>(
            IJupyterDebugService,
            mockDebugService,
            Identifiers.MULTIPLEXING_DEBUGSERVICE
        );
        this.serviceManager.addSingleton<CellHashProviderFactory>(CellHashProviderFactory, CellHashProviderFactory);
        this.serviceManager.addSingleton<HoverProvider>(HoverProvider, HoverProvider);
        this.serviceManager.addSingleton<ICodeLensFactory>(ICodeLensFactory, CodeLensFactory);
        this.serviceManager.addSingleton<NotebookStarter>(NotebookStarter, NotebookStarter);
        this.serviceManager.addSingleton<KernelSelector>(KernelSelector, KernelSelector);
        this.serviceManager.addSingleton<IKernelDependencyService>(IKernelDependencyService, KernelDependencyService);
        this.serviceManager.addSingleton<INotebookCreationTracker>(INotebookCreationTracker, NotebookCreationTracker);
        this.serviceManager.addSingleton<KernelDaemonPool>(KernelDaemonPool, KernelDaemonPool);
        this.serviceManager.addSingleton<KernelDaemonPreWarmer>(KernelDaemonPreWarmer, KernelDaemonPreWarmer);
        this.serviceManager.addSingleton<IVSCodeNotebook>(IVSCodeNotebook, VSCodeNotebook);
        this.serviceManager.addSingleton<IProductPathService>(IProductPathService, DataScienceProductPathService);
        this.serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);

        // No need of reporting progress.
        const progressReporter = mock(ProgressReporter);
        when(progressReporter.createProgressIndicator(anything())).thenReturn({
            dispose: noop,
            token: new CancellationTokenSource().token
        });
        this.serviceManager.addSingletonInstance<ProgressReporter>(ProgressReporter, instance(progressReporter));

        // Setup our command list
        this.commandManager.registerCommand('setContext', (name: string, value: boolean) => {
            this.setContexts[name] = value;
            this.contextSetEvent.fire({ name: name, value: value });
        });
        this.serviceManager.addSingletonInstance<ICommandManager>(ICommandManager, this.commandManager);

        // Mock the app shell
        this.applicationShell = mock(ApplicationShell);
        const configurationService = TypeMoq.Mock.ofType<IConfigurationService>();

        configurationService.setup((c) => c.getSettings(TypeMoq.It.isAny())).returns(this.getSettings.bind(this));

        this.serviceManager.addSingleton<IEnvironmentVariablesProvider>(
            IEnvironmentVariablesProvider,
            EnvironmentVariablesProvider
        );

        this.serviceManager.addSingletonInstance<IApplicationShell>(IApplicationShell, instance(this.applicationShell));
        this.serviceManager.addSingletonInstance<IDocumentManager>(IDocumentManager, this.documentManager);
        this.serviceManager.addSingletonInstance<IConfigurationService>(
            IConfigurationService,
            configurationService.object
        );

        this.datascience = TypeMoq.Mock.ofType<IDataScience>();
        this.serviceManager.addSingletonInstance<IDataScience>(IDataScience, this.datascience.object);
        this.serviceManager.addSingleton<JupyterCommandLineSelector>(
            JupyterCommandLineSelector,
            JupyterCommandLineSelector
        );
        this.serviceManager.addSingleton<JupyterCommandLineSelectorCommand>(
            JupyterCommandLineSelectorCommand,
            JupyterCommandLineSelectorCommand
        );

        this.serviceManager.addSingleton<JupyterServerSelectorCommand>(
            JupyterServerSelectorCommand,
            JupyterServerSelectorCommand
        );
        this.serviceManager.addSingleton<NotebookCommands>(NotebookCommands, NotebookCommands);

        this.serviceManager.addSingleton<CommandRegistry>(CommandRegistry, CommandRegistry);
        this.serviceManager.addSingleton<IBufferDecoder>(IBufferDecoder, BufferDecoder);
        this.serviceManager.addSingleton<IEnvironmentVariablesService>(
            IEnvironmentVariablesService,
            EnvironmentVariablesService
        );
        this.serviceManager.addSingleton<IPathUtils>(IPathUtils, PathUtils);
        this.serviceManager.addSingletonInstance<boolean>(IsWindows, IS_WINDOWS);

        const globalStorage = this.serviceManager.get<Memento>(IMemento, GLOBAL_MEMENTO);
        const localStorage = this.serviceManager.get<Memento>(IMemento, WORKSPACE_MEMENTO);

        // Create a custom persistent state factory that remembers specific things between tests
        this.serviceManager.addSingletonInstance<IPersistentStateFactory>(
            IPersistentStateFactory,
            new TestPersistentStateFactory(globalStorage, localStorage)
        );

        this.serviceManager.addSingleton<JupyterInterpreterStateStore>(
            JupyterInterpreterStateStore,
            JupyterInterpreterStateStore
        );
        this.serviceManager.addSingleton<IExtensionSingleActivationService>(
            IExtensionSingleActivationService,
            JupyterInterpreterSelectionCommand
        );
        this.serviceManager.addSingleton<JupyterInterpreterSelector>(
            JupyterInterpreterSelector,
            JupyterInterpreterSelector
        );
        this.serviceManager.addSingleton<JupyterInterpreterDependencyService>(
            JupyterInterpreterDependencyService,
            JupyterInterpreterDependencyService
        );
        this.serviceManager.addSingleton<JupyterInterpreterService>(
            JupyterInterpreterService,
            JupyterInterpreterService
        );
        this.serviceManager.addSingleton<JupyterInterpreterOldCacheStateStore>(
            JupyterInterpreterOldCacheStateStore,
            JupyterInterpreterOldCacheStateStore
        );
        this.serviceManager.addSingleton<ActiveEditorContextService>(
            ActiveEditorContextService,
            ActiveEditorContextService
        );
        this.serviceManager.addSingleton<IKernelLauncher>(IKernelLauncher, KernelLauncher);
        this.serviceManager.addSingleton<KernelEnvironmentVariablesService>(
            KernelEnvironmentVariablesService,
            KernelEnvironmentVariablesService
        );

        this.serviceManager.addSingleton<IJupyterSubCommandExecutionService>(
            IJupyterSubCommandExecutionService,
            JupyterInterpreterSubCommandExecutionService
        );
        this.serviceManager.addSingleton<IJupyterInterpreterDependencyManager>(
            IJupyterInterpreterDependencyManager,
            JupyterInterpreterSubCommandExecutionService
        );

        this.serviceManager.addSingletonInstance<IPythonDebuggerPathProvider>(IPythonDebuggerPathProvider, {
            getDebuggerPath: async () => path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'pythonFiles', 'lib', 'python')
        });

        // Create our jupyter mock if necessary
        if (this.shouldMockJupyter) {
            this.jupyterMock = new MockJupyterManagerFactory(this.serviceManager);
            // When using mocked Jupyter, default to using default kernel.
            when(this.kernelFinderMock.findKernel(anything(), anything(), anything())).thenResolve(undefined);

            this.serviceManager.addSingletonInstance<JupyterKernelService>(
                JupyterKernelService,
                instance(this.kernelServiceMock)
            );
            this.serviceManager.addSingletonInstance<ILocalKernelFinder>(
                ILocalKernelFinder,
                instance(this.kernelFinderMock)
            );
            const remoteKernelFinderMock = mock(RemoteKernelFinder);
            this.serviceManager.addSingletonInstance<IRemoteKernelFinder>(
                IRemoteKernelFinder,
                instance(remoteKernelFinderMock)
            );

            this.serviceManager.addSingletonInstance<IInterpreterSelector>(
                IInterpreterSelector,
                instance(mock(InterpreterSelector))
            );
            this.serviceManager.addSingletonInstance<IWindowsStoreInterpreter>(
                IWindowsStoreInterpreter,
                instance(mock(WindowsStoreInterpreter))
            );
            this.serviceManager.addSingletonInstance<IEnvironmentActivationService>(
                IEnvironmentActivationService,
                instance(mock(EnvironmentActivationService))
            );

            // Raw Kernel doesn't have a mock layer, so disable ZMQ for mocked jupyter tests
            traceInfoIfCI('forceDataScienceSettingsChanged invoked');
            this.forceDataScienceSettingsChanged({ disableZMQSupport: true }, false);
        } else {
            this.serviceManager.addSingleton<IInstaller>(IInstaller, ProductInstaller);
            this.serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
            this.serviceManager.addSingleton<IInterpreterSelector>(IInterpreterSelector, InterpreterSelector);
            this.serviceManager.addSingleton<IWindowsStoreInterpreter>(
                IWindowsStoreInterpreter,
                WindowsStoreInterpreter
            );
            this.serviceManager.addSingleton<IEnvironmentActivationService>(
                IEnvironmentActivationService,
                EnvironmentActivationService
            );
            this.serviceManager.addSingleton<JupyterKernelService>(JupyterKernelService, JupyterKernelService);
            this.serviceManager.addSingleton<ILocalKernelFinder>(ILocalKernelFinder, LocalKernelFinder);
            this.serviceManager.addSingleton<JupyterPaths>(JupyterPaths, JupyterPaths);
            this.serviceManager.addSingleton<LocalKnownPathKernelSpecFinder>(
                LocalKnownPathKernelSpecFinder,
                LocalKnownPathKernelSpecFinder
            );
            this.serviceManager.addSingleton<LocalPythonAndRelatedNonPythonKernelSpecFinder>(
                LocalPythonAndRelatedNonPythonKernelSpecFinder,
                LocalPythonAndRelatedNonPythonKernelSpecFinder
            );
            this.serviceManager.addSingleton<IRemoteKernelFinder>(IRemoteKernelFinder, RemoteKernelFinder);
            this.serviceManager.addSingleton<IProcessServiceFactory>(IProcessServiceFactory, ProcessServiceFactory);
            this.serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory);

            this.serviceManager.addSingleton<IJupyterSessionManagerFactory>(
                IJupyterSessionManagerFactory,
                JupyterSessionManagerFactory
            );
            this.serviceManager.addSingleton<IJupyterPasswordConnect>(IJupyterPasswordConnect, JupyterPasswordConnect);
            this.serviceManager.addSingleton<IProcessLogger>(IProcessLogger, ProcessLogger);
        }
        const dummyDisposable = {
            dispose: () => {
                return;
            }
        };
        this.serviceManager.addSingleton<ILanguageServerProvider>(ILanguageServerProvider, MockLanguageServerProvider);
        this.serviceManager.addSingleton<IEncryptedStorage>(IEncryptedStorage, MockEncryptedStorage);
        this.serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
        this.serviceManager.addSingleton<INotebookWatcher>(INotebookWatcher, NotebookWatcher);

        when(this.applicationShell.showErrorMessage(anyString())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showErrorMessage(anyString(), anything())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showErrorMessage(anyString(), anything(), anything())).thenReturn(
            Promise.resolve('')
        );
        when(this.applicationShell.showInformationMessage(anyString())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showInformationMessage(anyString(), anything())).thenReturn(Promise.resolve(''));
        when(
            this.applicationShell.showInformationMessage(anyString(), anything(), anything())
        ).thenCall((_a1, a2, _a3) => Promise.resolve(a2));
        when(this.applicationShell.showInformationMessage(anyString(), anything(), anything(), anything())).thenCall(
            (_a1, a2, _a3, a4) => {
                if (typeof a2 === 'string') {
                    return Promise.resolve(a2);
                } else {
                    return Promise.resolve(a4);
                }
            }
        );
        when(this.applicationShell.showWarningMessage(anyString())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showWarningMessage(anyString(), anything())).thenReturn(Promise.resolve(''));
        when(this.applicationShell.showWarningMessage(anyString(), anything(), anything())).thenCall((_a1, a2, _a3) =>
            Promise.resolve(a2)
        );
        when(this.applicationShell.showWarningMessage(anyString(), anything(), anything(), anything())).thenCall(
            (_a1, a2, _a3, a4) => {
                if (typeof a2 === 'string') {
                    return Promise.resolve(a2);
                } else {
                    return Promise.resolve(a4);
                }
            }
        );
        when(this.applicationShell.showSaveDialog(anything())).thenReturn(Promise.resolve(Uri.file('test.ipynb')));
        when(this.applicationShell.setStatusBarMessage(anything())).thenReturn(dummyDisposable);
        when(this.applicationShell.showInputBox(anything())).thenReturn(Promise.resolve('Python'));
        const eventCallback = (
            _listener: (e: WindowState) => any,
            _thisArgs?: any,
            _disposables?: IDisposable[] | Disposable
        ) => {
            return {
                dispose: noop
            };
        };
        when(this.applicationShell.onDidChangeWindowState).thenReturn(eventCallback);
        when(this.applicationShell.withProgress(anything(), anything())).thenCall((_o, c) => c());

        if (this.mockJupyter) {
            this.addInterpreter(this.workingPython2, SupportedCommands.all);
            this.addInterpreter(this.workingPython, SupportedCommands.all);
        }
        this.serviceManager.addSingleton<IJupyterUriProviderRegistration>(
            IJupyterUriProviderRegistration,
            JupyterUriProviderRegistration
        );
    }
    public setFileContents(uri: Uri, contents: string) {
        const fileSystem = this.serviceManager.get<IFileSystem>(IFileSystem) as MockFileSystem;
        fileSystem.addFileContents(uri.fsPath, contents);
    }

    public async activate(): Promise<void> {
        // Activate all of the extension activation services
        const activationServices = this.serviceManager.getAll<IExtensionSingleActivationService>(
            IExtensionSingleActivationService
        );

        await Promise.all(activationServices.map((a) => a.activate()));

        // Make sure the command registry registers all commands
        this.get<CommandRegistry>(CommandRegistry).register();

        // Then force our interpreter to be one that supports jupyter (unless in a mock state when we don't have to)
        if (!this.mockJupyter) {
            const interpreterService = this.serviceManager.get<IInterpreterService>(IInterpreterService);
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            if (!activeInterpreter || !(await this.hasFunctionalDependencies(activeInterpreter))) {
                const list = await this.getFunctionalTestInterpreters();
                if (list.length) {
                    this.forceSettingsChanged(undefined, list[0].path, {});

                    // Log this all the time. Useful in determining why a test may not pass.
                    const message = `Setting interpreter to ${list[0].displayName || list[0].path} -> ${list[0].path}`;
                    traceInfo(message);
                    // eslint-disable-next-line no-console
                    console.log(message);

                    // Also set this as the interpreter to use for jupyter
                    await this.serviceManager
                        .get<JupyterInterpreterService>(JupyterInterpreterService)
                        .setAsSelectedInterpreter(list[0]);
                } else {
                    throw new Error(
                        'No jupyter capable interpreter found. Make sure you install all of the functional requirements before running a test'
                    );
                }
            }
        }
    }

    /* eslint-disable */
    public createWebView(mount: () => ReactWrapper<any, Readonly<{}>, React.Component>, id: string) {
        // We need to mount the react control before we even create an interactive window object. Otherwise the mount will miss rendering some parts
        this.pendingWebPanel = this.get<IMountedWebViewFactory>(IMountedWebViewFactory).create(id, mount);
        return this.pendingWebPanel;
    }
    public getContext(name: string): boolean {
        if (this.setContexts.hasOwnProperty(name)) {
            return this.setContexts[name];
        }

        return false;
    }

    public getSettings(resource?: Uri): IWatchableJupyterSettings {
        const key = this.getResourceKey(resource);
        let setting = this.settingsMap.get(key);
        if (!setting && !this.disposed) {
            // Make sure we have the default config for this resource first.
            this.getWorkspaceConfig('jupyter', resource);
            setting = new MockJupyterSettings(resource, this.serviceManager.get<IWorkspaceService>(IWorkspaceService));
            this.settingsMap.set(key, setting);
        } else if (this.disposed) {
            setting = this.generateJupyterSettings();
        }
        return setting;
    }

    public forceDataScienceSettingsChanged(
        dataScienceSettings: Partial<IJupyterSettings>,
        notifyEvent: boolean = true
    ) {
        this.forceSettingsChanged(undefined, '', dataScienceSettings, notifyEvent);
    }

    public setServerUri(uri: string): Promise<void> {
        return this.get<IJupyterServerUriStorage>(IJupyterServerUriStorage).setUri(uri);
    }

    public setExtensionRootPath(newRoot: string) {
        this.extensionRootPath = newRoot;
    }

    public async getJupyterCapableInterpreter(): Promise<PythonEnvironment | undefined> {
        const list = await this.getFunctionalTestInterpreters();
        return list ? list[0] : undefined;
    }

    public async getFunctionalTestInterpreters(): Promise<PythonEnvironment[]> {
        // This should be cacheable as we don't install new interpreters during tests
        if (DataScienceIocContainer.jupyterInterpreters.length > 0) {
            return DataScienceIocContainer.jupyterInterpreters;
        }
        const list = await this.get<IInterpreterService>(IInterpreterService).getInterpreters(undefined);
        const promises = list.map((f) => this.hasFunctionalDependencies(f).then((b) => (b ? f : undefined)));
        const resolved = await Promise.all(promises);
        DataScienceIocContainer.jupyterInterpreters = resolved.filter((r) => r) as PythonEnvironment[];
        return DataScienceIocContainer.jupyterInterpreters;
    }

    public addWorkspaceFolder(folderPath: string) {
        const workspaceFolder = new MockWorkspaceFolder(folderPath, this.workspaceFolders.length);
        this.workspaceFolders.push(workspaceFolder);
        return workspaceFolder;
    }

    public addResourceToFolder(resource: Uri, folderPath: string) {
        let folder = this.workspaceFolders.find((f) => f.uri.fsPath === folderPath);
        if (!folder) {
            folder = this.addWorkspaceFolder(folderPath);
        }
        folder.ownedResources.add(resource.toString());
    }

    public get<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T {
        return this.serviceManager.get<T>(serviceIdentifier, name);
    }

    public getAll<T>(serviceIdentifier: interfaces.ServiceIdentifier<T>, name?: string | number | symbol): T[] {
        return this.serviceManager.getAll<T>(serviceIdentifier, name);
    }

    public addDocument(code: string, file: string) {
        return this.documentManager.addDocument(code, file);
    }

    public addInterpreter(newInterpreter: PythonEnvironment, commands: SupportedCommands) {
        if (this.mockJupyter) {
            this.mockJupyter.addInterpreter(newInterpreter, commands);
        }
    }

    public getWorkspaceConfig(section: string | undefined, resource?: Resource): MockWorkspaceConfiguration {
        if (!section || section !== 'jupyter') {
            return this.emptyConfig;
        }
        const key = this.getResourceKey(resource);
        let result = this.configMap.get(key);
        if (!result) {
            result = this.generateWorkspaceConfig();
            this.configMap.set(key, result);
        }
        return result;
    }

    public setExperimentState(experimentName: string, enabled: boolean) {
        this.experimentState.set(experimentName, enabled);
    }

    public setPythonExtensionState(installed: boolean) {
        this.pythonExtensionState = installed;
    }

    private async onCreateWebPanel(options: IWebviewPanelOptions) {
        if (!this.pendingWebPanel) {
            throw new Error('Creating web panel without a mount');
        }
        const panel = this.pendingWebPanel;
        panel.attach(options);
        return panel;
    }

    private isPythonExtensionInstalled() {
        return this.pythonExtensionState;
    }
    private installPythonExtension() {
        this.attemptedPythonExtension = true;
    }

    private forceSettingsChanged(
        resource: Resource,
        newPath: string,
        partial: Partial<IJupyterSettings>,
        notifyEvent: boolean = true
    ) {
        // eslint-disable-next-line
        // TODO: Python path will not be updated by this code so tests are unlikely to pass
        const settings = this.getSettings(resource) as MockJupyterSettings;
        if (partial) {
            settings.assign(partial);
        }

        if (notifyEvent) {
            // The workspace config must be updated too as a config change event will cause the data to be reread from
            // the config.
            const config = this.getWorkspaceConfig('jupyter', resource);
            // Turn into the JSON only version
            const jsonVersion = JSON.parse(JSON.stringify(settings));
            // Update each key
            const keys = Object.keys(jsonVersion);
            keys.forEach((k) => config.update(k, jsonVersion[k]).ignoreErrors());
            settings.fireChangeEvent();
            this.configChangeEvent.fire({
                affectsConfiguration(_s: string, _r?: Uri): boolean {
                    return true;
                }
            });
            this.get<InterpreterService>(IInterpreterService).updateInterpreter(resource, newPath);
        }
    }

    private generateJupyterSettings() {
        // Create a dummy settings just to setup the workspace config
        const settings = new MockJupyterSettings(undefined);

        // Then setup the default values.
        settings.assign({
            allowImportFromNotebook: true,
            jupyterLaunchTimeout: 120000,
            jupyterLaunchRetries: 3,
            jupyterServerType: 'local',
            // eslint-disable-next-line no-template-curly-in-string
            notebookFileRoot: '${fileDirname}',
            changeDirOnImportExport: false,
            useDefaultConfigForJupyter: true,
            jupyterInterruptTimeout: 10000,
            searchForJupyter: true,
            showCellInputCode: true,
            collapseCellInputCodeByDefault: true,
            allowInput: true,
            maxOutputSize: 400,
            enableScrollingForCellOutputs: true,
            errorBackgroundColor: '#FFFFFF',
            sendSelectionToInteractiveWindow: false,
            codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
            markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
            variableExplorerExclude: 'module;function;builtin_function_or_method',
            liveShareConnectionTimeout: 100,
            generateSVGPlots: false,
            stopOnFirstLineWhileDebugging: true,
            stopOnError: true,
            addGotoCodeLenses: true,
            enableCellCodeLens: true,
            runStartupCommands: '',
            debugJustMyCode: true,
            variableQueries: [],
            jupyterCommandLineArguments: [],
            disableJupyterAutoStart: false,
            widgetScriptSources: ['jsdelivr.com', 'unpkg.com'],
            interactiveWindowMode: 'single'
        });
        return settings;
    }

    private generateWorkspaceConfig(): MockWorkspaceConfiguration {
        const settings = this.generateJupyterSettings();

        // Use these settings to default all of the settings in a python configuration
        return new MockWorkspaceConfiguration(settings);
    }

    private createWorkspaceService() {
        class MockFileSystemWatcher implements FileSystemWatcher {
            public ignoreCreateEvents: boolean = false;
            public ignoreChangeEvents: boolean = false;
            public ignoreDeleteEvents: boolean = false;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            public onDidChange(_listener: (e: Uri) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
                return { dispose: noop };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            public onDidDelete(_listener: (e: Uri) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
                return { dispose: noop };
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            public onDidCreate(_listener: (e: Uri) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
                return { dispose: noop };
            }
            public dispose() {
                noop();
            }
        }

        const workspaceService = mock(WorkspaceService);
        when(workspaceService.isTrusted).thenReturn(true);
        when(workspaceService.onDidGrantWorkspaceTrust).thenReturn(new EventEmitter<void>().event);
        this.serviceManager.addSingletonInstance<IWorkspaceService>(IWorkspaceService, instance(workspaceService));
        when(workspaceService.onDidChangeConfiguration).thenReturn(this.configChangeEvent.event);
        when(workspaceService.onDidChangeWorkspaceFolders).thenReturn(this.worksaceFoldersChangedEvent.event);

        // Create another config for other parts of the workspace config.
        when(workspaceService.getConfiguration(anything())).thenCall(this.getWorkspaceConfig.bind(this));
        when(workspaceService.getConfiguration(anything(), anything())).thenCall(this.getWorkspaceConfig.bind(this));
        const testWorkspaceFolder = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');

        when(workspaceService.createFileSystemWatcher(anything(), anything(), anything(), anything())).thenReturn(
            new MockFileSystemWatcher()
        );
        when(workspaceService.createFileSystemWatcher(anything())).thenReturn(new MockFileSystemWatcher());
        when(workspaceService.hasWorkspaceFolders).thenReturn(true);
        when(workspaceService.workspaceFolders).thenReturn(this.workspaceFolders);
        when(workspaceService.rootPath).thenReturn(testWorkspaceFolder);
        when(workspaceService.getWorkspaceFolder(anything())).thenCall(this.getWorkspaceFolder.bind(this));
        when(workspaceService.getWorkspaceFolderIdentifier(anything(), anything())).thenCall(
            this.getWorkspaceFolderIdentifier.bind(this)
        );
        this.addWorkspaceFolder(testWorkspaceFolder);
        return workspaceService;
    }

    private getWorkspaceFolder(uri: Resource): WorkspaceFolder | undefined {
        if (uri) {
            return this.workspaceFolders.find((w) => w.ownedResources.has(uri.toString()));
        }
        return undefined;
    }
    private getWorkspaceFolderIdentifier(uri: Resource, defaultValue: string | undefined): string | undefined {
        if (uri) {
            const folder = this.workspaceFolders.find((w) => w.ownedResources.has(uri.toString()));
            if (folder) {
                return folder.uri.fsPath;
            }
        }
        return defaultValue;
    }

    private getResourceKey(resource: Resource): string {
        if (!this.disposed) {
            try {
                const workspace = this.serviceManager.get<IWorkspaceService>(IWorkspaceService);
                const workspaceFolderUri = JupyterSettings.getSettingsUriAndTarget(resource, workspace).uri;
                return workspaceFolderUri ? workspaceFolderUri.fsPath : '';
            } catch {
                // May as well be disposed
            }
        }
        return '';
    }

    private async hasFunctionalDependencies(interpreter: PythonEnvironment): Promise<boolean | undefined> {
        try {
            traceInfo(`Checking ${interpreter.path} for functional dependencies ...`);
            const dependencyChecker = this.serviceManager.get<JupyterInterpreterDependencyService>(
                JupyterInterpreterDependencyService
            );
            if (await dependencyChecker.areDependenciesInstalled(interpreter)) {
                // Functional tests require livelossplot too. Make sure this interpreter has that value as well
                const pythonProcess = await this.serviceContainer
                    .get<IPythonExecutionFactory>(IPythonExecutionFactory)
                    .createActivatedEnvironment({
                        resource: undefined,
                        interpreter,
                        allowEnvironmentFetchExceptions: true
                    });
                const result = await pythonProcess.isModuleInstalled('livelossplot'); // Should we check all dependencies?
                traceInfo(`${interpreter.path} has jupyter with livelossplot indicating : ${result}`);
                return result;
            } else {
                traceInfo(`${JSON.stringify(interpreter)} is missing jupyter.`);
            }
        } catch (ex) {
            traceError(`Exception attempting dependency list for ${interpreter.path}: `, ex);
            return false;
        }
    }
}
