// ============================================================================
// @aitofy/browser-profiles - Chrome executable discovery
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';

const MAC_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const WINDOWS_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const LINUX_PATHS = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
];

function platformCandidates(): string[] {
    switch (os.platform()) {
        case 'darwin':
            return [
                ...MAC_PATHS,
                path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
            ];
        case 'win32':
            return [
                ...WINDOWS_PATHS,
                path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
            ];
        case 'linux':
            return LINUX_PATHS;
        default:
            return [];
    }
}

/**
 * Resolve the Chrome/Chromium executable.
 * Precedence: explicit path > CHROMIUM_PATH/CHROME_PATH > platform defaults.
 */
export function getChromePath(customPath?: string): string {
    if (customPath && fs.existsSync(customPath)) return customPath;

    const envPath = process.env.CHROMIUM_PATH || process.env.CHROME_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;

    for (const candidate of platformCandidates()) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error(
        'Chrome/Chromium not found. Please install Chrome or set CHROME_PATH environment variable.'
    );
}
