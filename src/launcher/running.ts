// ============================================================================
// @aitofy/browser-profiles - Browsers this process launched
// ============================================================================

import { createLogger } from '../log';
import type { LaunchedChrome } from './deps';
import { closeProxyRelay } from './proxy';

const log = createLogger('launcher-running');

export interface RunningBrowserEntry {
    process: LaunchedChrome;
    /** Local relay URL, torn down with the browser. */
    proxyUrl?: string;
    /** Releases the persistent CDP connection that protects new tabs. */
    releaseSession?: () => Promise<void>;
}

const runningBrowsers = new Map<string, RunningBrowserEntry>();

export function trackBrowser(profileId: string, entry: RunningBrowserEntry): void {
    runningBrowsers.set(profileId, entry);
}

export function untrackBrowser(profileId: string): void {
    runningBrowsers.delete(profileId);
}

async function release(entry: RunningBrowserEntry): Promise<void> {
    if (entry.releaseSession) await entry.releaseSession().catch(() => undefined);
    await entry.process.kill();
    await closeProxyRelay(entry.proxyUrl);
}

/** Close a browser this process launched. False when it does not own one. */
export async function closeBrowser(profileId: string): Promise<boolean> {
    const entry = runningBrowsers.get(profileId);
    if (!entry) return false;

    try {
        await release(entry);
        runningBrowsers.delete(profileId);
        return true;
    } catch (error) {
        log.debug(`Could not close browser for ${profileId}`, error);
        return false;
    }
}

/** Close every browser this process launched. Used on process exit. */
export async function closeAllBrowsers(): Promise<void> {
    const closing = Array.from(runningBrowsers.values()).map((entry) =>
        release(entry).catch((error) => log.debug('Could not close browser', error))
    );

    await Promise.allSettled(closing);
    runningBrowsers.clear();
}

/** Profile ids of browsers this process launched. */
export function getRunningBrowsers(): string[] {
    return Array.from(runningBrowsers.keys());
}
