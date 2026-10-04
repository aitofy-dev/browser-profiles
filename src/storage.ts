// ============================================================================
// @aitofy/browser-profiles - Storage layout, atomic writes, browser lock files
// ============================================================================

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ResolvedEngine } from './types';

/** Default profile store. Never hardcode this anywhere else. */
export const DEFAULT_STORAGE_PATH = path.join(os.homedir(), '.aitofy', 'browser-profiles');

/** Env var that overrides the default store. */
export const STORAGE_PATH_ENV = 'BROWSER_PROFILES_HOME';

/**
 * Resolve the profile storage path.
 * Precedence: explicit option > BROWSER_PROFILES_HOME > ~/.aitofy/browser-profiles
 */
export function resolveStoragePath(explicit?: string): string {
    if (explicit && explicit.trim().length > 0) return path.resolve(explicit);
    const fromEnv = process.env[STORAGE_PATH_ENV];
    if (fromEnv && fromEnv.trim().length > 0) return path.resolve(fromEnv);
    return DEFAULT_STORAGE_PATH;
}

/** Directory holding saved profiles. */
export function profilesDir(storagePath: string): string {
    return path.join(storagePath, 'profiles');
}

/** Chrome user-data directory of a saved profile. */
export function profileDataDir(storagePath: string, profileId: string): string {
    return path.join(profilesDir(storagePath), profileId, 'data');
}

/** Root for temporary (unsaved) browser sessions. */
export function tempSessionsDir(storagePath: string): string {
    return path.join(storagePath, 'tmp');
}

/**
 * Write JSON via a temp file + rename so no reader ever sees a partial file.
 * rename(2) is atomic within a filesystem, which is always the case here.
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
    // Unique per writer: a shared name lets two writers rename each other's half-written file.
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2));
        fs.renameSync(tmpPath, filePath);
    } catch (error) {
        try {
            fs.rmSync(tmpPath, { force: true });
        } catch {
            // Best effort cleanup.
        }
        throw error;
    }
}

export const LOCK_FILE_NAME = '.browser-lock.json';

/** Cross-process record of a running Chrome, stored in its user-data dir. */
export interface BrowserLockInfo {
    pid: number;
    port: number;
    wsEndpoint: string;
    startedAt: number;
    /** Local anonymized proxy URL created by proxy-chain, if any. */
    proxyUrl?: string;
    /** True when no process holds a CDP connection: only the first tab is protected. */
    detached?: boolean;
    /** Placeholder written before Chrome starts: nothing is running behind it yet. */
    claiming?: boolean;
    /** Engine the browser was launched with. Absent on locks written before kernel mode. */
    engine?: ResolvedEngine;
}

export function lockFilePath(userDataDir: string): string {
    return path.join(userDataDir, LOCK_FILE_NAME);
}

function parseEngine(value: unknown): ResolvedEngine | undefined {
    return value === 'kernel' || value === 'inject' || value === 'real' ? value : undefined;
}

export function readLockFile(userDataDir: string): BrowserLockInfo | null {
    try {
        const content = fs.readFileSync(lockFilePath(userDataDir), 'utf-8');
        const parsed = JSON.parse(content) as Partial<BrowserLockInfo>;
        if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null;
        return {
            pid: parsed.pid,
            port: parsed.port,
            wsEndpoint: parsed.wsEndpoint ?? '',
            startedAt: parsed.startedAt ?? 0,
            proxyUrl: parsed.proxyUrl,
            detached: parsed.detached,
            claiming: parsed.claiming,
            engine: parseEngine(parsed.engine),
        };
    } catch {
        return null;
    }
}

export interface ClaimAttempt {
    claimed: boolean;
    /** The lock that won, when this attempt lost. */
    existing: BrowserLockInfo | null;
}

/**
 * Take the profile's lock before Chrome exists, so two concurrent opens cannot
 * both launch. `wx` makes the create-or-fail decision in one syscall.
 */
export function claimLockFile(userDataDir: string, pid: number = process.pid): ClaimAttempt {
    const claim: BrowserLockInfo = {
        pid,
        port: 0,
        wsEndpoint: '',
        startedAt: Date.now(),
        claiming: true,
    };

    try {
        fs.mkdirSync(userDataDir, { recursive: true });
        fs.writeFileSync(lockFilePath(userDataDir), JSON.stringify(claim), { flag: 'wx' });
        return { claimed: true, existing: null };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            // An unwritable lock only costs mutual exclusion; refusing to launch costs more.
            return { claimed: true, existing: null };
        }
        return { claimed: false, existing: readLockFile(userDataDir) };
    }
}

/** The browser GUID Chrome mints per run: ws://host:port/devtools/browser/<id>. */
function browserIdOf(wsEndpoint: string): string {
    const match = /\/devtools\/browser\/([^/?#]+)/.exec(wsEndpoint);
    return match ? match[1] : '';
}

/**
 * Whether a probed endpoint belongs to the browser a lock recorded.
 * PID and port both get recycled; the GUID is what makes reuse safe.
 */
export function sameBrowser(lockEndpoint: string, probedEndpoint: string): boolean {
    const recorded = browserIdOf(lockEndpoint);
    // Locks written before the GUID was recorded cannot be told apart; trust the port.
    if (recorded.length === 0) return true;
    return recorded === browserIdOf(probedEndpoint);
}

export function writeLockFile(userDataDir: string, info: BrowserLockInfo): void {
    try {
        writeJsonAtomic(lockFilePath(userDataDir), info);
    } catch {
        // A missing lock only costs cross-process reuse, never correctness.
    }
}

export function deleteLockFile(userDataDir: string): void {
    try {
        fs.rmSync(lockFilePath(userDataDir), { force: true });
    } catch {
        // Best effort.
    }
}

/**
 * Ask a DevTools port for its WebSocket endpoint.
 * The only trustworthy liveness check: a PID may have been reused by the OS.
 */
export async function probeDevToolsPort(port: number, timeoutMs = 2000): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { webSocketDebuggerUrl?: string };
        return data.webSocketDebuggerUrl ?? null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Signal 0 only tests existence, it does not deliver a signal. */
export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
