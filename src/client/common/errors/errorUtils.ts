// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ErrorUtils {
    public static outputHasModuleNotInstalledError(moduleName: string, content?: string): boolean {
        return content &&
            (content!.indexOf(`No module named ${moduleName}`) > 0 ||
                content!.indexOf(`No module named '${moduleName}'`) > 0)
            ? true
            : false;
    }
}

/**
 * Given a python traceback, attempt to get the Python error message.
 * Generally Python error messages are at the bottom of the traceback.
 */
export function getTelemetrySafeErrorMessageFromPythonTraceback(traceback: string = '') {
    if (!traceback) {
        return;
    }
    // Look for something like `NameError: name 'XYZ' is not defined` in the last line.
    const pythonErrorMessageRegExp = /\S+Error: /g;
    // Suffix with `:`, in case we pass the value `NameError` back into this function.
    const reversedLines = `${traceback}: `
        .split('\n')
        .filter((item) => item.trim().length)
        .reverse();
    if (reversedLines.length === 0) {
        return;
    }
    const lastLine = reversedLines[0];
    const message = lastLine.match(pythonErrorMessageRegExp) ? lastLine : undefined;
    const parts = (message || '').split(':');
    // Only get the error type.
    return parts.length && parts[0].endsWith('Error') ? parts[0] : undefined;
}

export function getLastFrameFromPythonTraceback(
    traceback: string
): { fileName: string; folderName: string; packageName: string } | undefined {
    if (!traceback) {
        return;
    }
    //             File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 38, in C

    // This parameter might be either a string or a string array
    const fixedTraceback: string = Array.isArray(traceback) ? traceback[0] : traceback;
    const lastFrame = fixedTraceback
        .split('\n')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length)
        .reverse()
        .find(
            (line) =>
                line.startsWith('file ') && line.includes(', line ') && line.includes('.py') && line.includes('.py')
        );
    if (!lastFrame) {
        return;
    }
    const file = lastFrame.substring(0, lastFrame.lastIndexOf('.py')) + '.py';
    const parts = file.replace(/\\/g, '/').split('/');
    const indexOfSitePackages = parts.indexOf('site-packages');
    let packageName =
        indexOfSitePackages >= 0 && parts.length > indexOfSitePackages + 1 ? parts[indexOfSitePackages + 1] : '';
    const reversedParts = parts.reverse();
    if (reversedParts.length < 2) {
        return;
    }
    return { fileName: reversedParts[0], folderName: reversedParts[1], packageName };
}
