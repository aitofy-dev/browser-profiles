// ============================================================================
// @aitofy/browser-profiles - Reuse a browser that is already running
// ============================================================================

import type { LaunchResult, StoredProfile } from '../types';
import { createLogger } from '../log';
import { deleteLockFile, isProcessAlive, probeDevToolsPort, sameBrowser } from '../storage';
import type { BrowserLockInfo } from '../storage';
import { closeProxyRelay } from './proxy';
import { untrackBrowser } from './running';

const log = createLogger('chrome-launcher');

/** Injectable so the stale-lock paths are testable without a browser. */
export type PortProbe = (port: number) => Promise<string | null>;

/** Reuse a browser another process left running for this profile, if it answers. */
export async function reuseExisting(
    profile: StoredProfile,
    userDataDir: string,
    lock: BrowserLockInfo,
    probe: PortProbe = probeDevToolsPort
): Promise<LaunchResult | null> {
    // A claim has no browser behind it yet; only its owner may resolve it.
    if (lock.claiming) return null;

    // Never trust the PID alone: the OS reuses PIDs. The DevTools port is the proof.
    const wsEndpoint = await probe(lock.port);
    if (!wsEndpoint) {
        log.debug(`Cleaning up stale lock file for profile "${profile.name}"`);
        deleteLockFile(userDataDir);
        return null;
    }

    if (!sameBrowser(lock.wsEndpoint, wsEndpoint)) {
        // Same port, different browser: the lock belongs to a run that is gone.
        log.debug(`Port ${lock.port} answers for another browser; dropping the lock of "${profile.name}"`);
        deleteLockFile(userDataDir);
        return null;
    }

    log.info(`Reusing browser for profile "${profile.name}" (pid ${lock.pid}, port ${lock.port})`);
    const engine = lock.engine ?? 'inject';
    if ((engine === 'real') !== (profile.fingerprint?.mode === 'real')) {
        log.warn(`Profile "${profile.name}" changed mode since its browser opened (${engine}). Close and reopen it.`);
    }

    const close = async (): Promise<void> => {
        try {
            if (isProcessAlive(lock.pid)) process.kill(lock.pid, 'SIGTERM');
            deleteLockFile(userDataDir);
            untrackBrowser(profile.id);
            await closeProxyRelay(lock.proxyUrl);
        } catch (error) {
            log.error('Error closing browser', error);
        }
    };

    return {
        wsEndpoint,
        pid: lock.pid,
        port: lock.port,
        profileId: profile.id,
        close,
        reused: true,
        detached: lock.detached,
        engine,
    };
}
