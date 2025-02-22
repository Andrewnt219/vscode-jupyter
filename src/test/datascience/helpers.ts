// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { noop } from 'lodash';
import { Uri, window, workspace } from 'vscode';
import { traceInfo } from '../../client/common/logger';
import { IJupyterSettings } from '../../client/common/types';

// The default base set of data science settings to use
export function defaultDataScienceSettings(): IJupyterSettings {
    return {
        logging: {
            level: 'off'
        },
        experiments: {
            enabled: false,
            optOutFrom: [],
            optInto: []
        },
        allowImportFromNotebook: true,
        jupyterLaunchTimeout: 10,
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
        variableExplorerExclude: 'module;function;builtin_function_or_method',
        codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
        markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
        generateSVGPlots: false,
        runStartupCommands: '',
        debugJustMyCode: true,
        variableQueries: [],
        jupyterCommandLineArguments: [],
        widgetScriptSources: [],
        interactiveWindowMode: 'single'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

export function takeSnapshot() {
    // If you're investigating memory leaks in the tests, using the node-memwatch
    // code below can be helpful. It will at least write out what objects are taking up the most
    // memory.
    // Alternatively, using the test:functional:memleak task and sticking breakpoints here and in
    // writeDiffSnapshot can be used as convenient locations to create heap snapshots and diff them.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    //const memwatch = require('@raghb1/node-memwatch');
    return {}; //new memwatch.HeapDiff();
}

//let snapshotCounter = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeDiffSnapshot(_snapshot: any, _prefix: string) {
    noop(); // Stick breakpoint here when generating heap snapshots
    // const diff = snapshot.end();
    // const file = path.join(EXTENSION_ROOT_DIR, 'tmp', `SD-${snapshotCounter}-${prefix}.json`);
    // snapshotCounter += 1;
    // fs.writeFile(file, JSON.stringify(diff), { encoding: 'utf-8' }).ignoreErrors();
}

export async function openNotebook(ipynbFile: string) {
    traceInfo(`Opening notebook ${ipynbFile}`);
    const uri = Uri.file(ipynbFile);
    const nb = await workspace.openNotebookDocument(uri);
    await window.showNotebookDocument(nb);
    traceInfo(`Opened notebook ${ipynbFile}`);
}
