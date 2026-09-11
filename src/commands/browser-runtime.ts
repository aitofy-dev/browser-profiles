// ============================================================================
// @aitofy/browser-profiles - Cross-process browser lifecycle (lock files)
// ============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Logger } from '../log';
import {
    deleteLockFile,
    isProcessAlive,
    probeDevToolsPort,
    profileDataDir,
    profilesDir,
    readLockFile,
    sameBrowser,
    tempSessionsDir,
} from '../storage';
import type { BrowserLockInfo } from '../storage';

/** A browser that answered on its DevTools port. */
export interface RunningBrowser {
    profileId: string;
    pid: number;
    port: number;
    wsEndpoint: string;
    startedAt: number;
    /** True for `browser.launch` sessions that have no saved profile. */
    temporary: boolean;
}

interface LockedDir {
    profileId: string;
    userDataDir: string;
    temporary: boolean;
    lock: BrowserLockInfo;
}

/** Synthetic id for a temporary session directory under `<storage>/tmp`. */
export function newTempProfileId(): string {
    return `tmp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

export function tempSessionDir(storagePath: string, profileId: string): string {
    return path.join(tempSessionsDir(storagePath), profileId);
}

/** User-data dir of a saved profile or of a `tmp-*` session. */
export function userDataDirFor(storagePath: string, profileId: string): string {
    return profileId.startsWith('tmp-')
        ? tempSessionDir(storagePath, profileId)
        : profileDataDir(storagePath, profileId);
}

function listDirs(dir: string): string[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    } catch {
        return [];
    }
}

/** A claim is a launch in progress: nothing answers behind it and it is not ours to clean. */
function launchedLock(userDataDir: string): BrowserLockInfo | null {
    const lock = readLockFile(userDataDir);
    return lock && !lock.claiming ? lock : null;
}

function collectLockedDirs(storagePath: string): LockedDir[] {
    const found: LockedDir[] = [];

    for (const profileId of listDirs(profilesDir(storagePath))) {
        const userDataDir = profileDataDir(storagePath, profileId);
        const lock = launchedLock(userDataDir);
        if (lock) found.push({ profileId, userDataDir, temporary: false, lock });
    }

    for (const profileId of listDirs(tempSessionsDir(storagePath))) {
        const userDataDir = tempSessionDir(storagePath, profileId);
        const lock = launchedLock(userDataDir);
        if (lock) found.push({ profileId, userDataDir, temporary: true, lock });
    }

    return found;
}

function removeTempDir(userDataDir: string): void {
    try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
        // A leftover temp dir is harmless; it carries no lock any more.
    }
}

/** Drop a stale lock, and the whole temp dir when the session was temporary. */
function forgetStale(entry: LockedDir, log: Logger): void {
    log.debug(`Removing stale lock for "${entry.profileId}" (port ${entry.lock.port} not answering)`);
    deleteLockFile(entry.userDataDir);
    if (entry.temporary) removeTempDir(entry.userDataDir);
}

/** List responsive browsers. Stale lock files are removed as a side effect. */
export async function scanRunning(storagePath: string, log: Logger): Promise<RunningBrowser[]> {
    const entries = collectLockedDirs(storagePath);
    const running: RunningBrowser[] = [];

    for (const entry of entries) {
        const wsEndpoint = await probeDevToolsPort(entry.lock.port);
        if (!wsEndpoint || !sameBrowser(entry.lock.wsEndpoint, wsEndpoint)) {
            forgetStale(entry, log);
            continue;
        }
        running.push({
            profileId: entry.profileId,
            pid: entry.lock.pid,
            port: entry.lock.port,
            wsEndpoint,
            startedAt: entry.lock.startedAt,
            temporary: entry.temporary,
        });
    }

    return running;
}

async function closeAnonymizedProxy(proxyUrl: string | undefined, log: Logger): Promise<void> {
    if (!proxyUrl) return;
    try {
        const proxyChain = await import('proxy-chain');
        await proxyChain.closeAnonymizedProxy(proxyUrl, true);
    } catch (error) {
        // The proxy dies with the process that created it; failing here is expected.
        log.debug('Could not close anonymized proxy', error);
    }
}

const SIGTERM_GRACE_MS = 5000;
const POLL_INTERVAL_MS = 200;

async function waitForExit(pid: number, port: number, deadlineMs: number): Promise<boolean> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) return true;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    // A zombie parent can linger; the port going silent means the browser is gone.
    return (await probeDevToolsPort(port, 500)) === null;
}

function signal(pid: number, sig: NodeJS.Signals): void {
    try {
        process.kill(pid, sig);
    } catch {
        // Already gone.
    }
}

/** Injectable DevTools probe, so the stale paths are testable without Chrome. */
export type PortProbe = (port: number) => Promise<string | null>;

/** True only when the profile's lock points at a browser that still answers. */
export async function isLockedBrowserAlive(
    userDataDir: string,
    probe: PortProbe = probeDevToolsPort
): Promise<boolean> {
    const lock = launchedLock(userDataDir);
    if (!lock) return false;
    const wsEndpoint = await probe(lock.port);
    return wsEndpoint !== null && sameBrowser(lock.wsEndpoint, wsEndpoint);
}

export interface CloseOutcome {
    closed: boolean;
    /** True when the lock pointed at a browser that was no longer there. */
    wasStale: boolean;
}

/**
 * Close the browser recorded in `userDataDir`'s lock file, from any process.
 * A lock whose port does not answer is treated as stale and merely deleted:
 * the PID may have been recycled by the OS onto an unrelated process.
 */
export async function closeLockedBrowser(
    userDataDir: string,
    log: Logger,
    options: { removeDir?: boolean; probe?: PortProbe } = {}
): Promise<CloseOutcome> {
    const probe = options.probe ?? probeDevToolsPort;
    const lock = readLockFile(userDataDir);
    if (!lock) return { closed: false, wasStale: false };
    if (lock.claiming) {
        // Another process is mid-launch and owns this file; its pid is not a browser.
        log.debug(`Lock for ${userDataDir} is a launch claim (pid ${lock.pid}); leaving it alone`);
        return { closed: false, wasStale: false };
    }

    const wsEndpoint = await probe(lock.port);
    if (!wsEndpoint || !sameBrowser(lock.wsEndpoint, wsEndpoint)) {
        log.debug(`Lock for ${userDataDir} is stale (port ${lock.port} silent or reused); not killing pid ${lock.pid}`);
        deleteLockFile(userDataDir);
        if (options.removeDir) removeTempDir(userDataDir);
        return { closed: false, wasStale: true };
    }

    signal(lock.pid, 'SIGTERM');
    const exited = await waitForExit(lock.pid, lock.port, SIGTERM_GRACE_MS);
    if (!exited) {
        log.warn(`Chrome pid ${lock.pid} ignored SIGTERM after ${SIGTERM_GRACE_MS}ms, sending SIGKILL`);
        signal(lock.pid, 'SIGKILL');
    }

    await closeAnonymizedProxy(lock.proxyUrl, log);
    deleteLockFile(userDataDir);
    if (options.removeDir) removeTempDir(userDataDir);

    return { closed: true, wasStale: false };
}
