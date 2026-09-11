// ============================================================================
// @aitofy/browser-profiles - Exclusive claim on a profile before Chrome starts
// ============================================================================

import { claimLockFile, deleteLockFile, readLockFile } from '../storage';
import type { BrowserLockInfo } from '../storage';

/** A claim older than this belongs to a process that died before Chrome came up. */
export const CLAIM_TIMEOUT_MS = 30_000;
const POLL_MS = 200;

export type ClaimResult =
    /** This process owns the profile and must launch or release it. */
    | { kind: 'claimed' }
    /** Another process finished launching; the caller decides to reuse or take over. */
    | { kind: 'running'; lock: BrowserLockInfo };

export interface ClaimDeps {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Claim the profile, waiting out a claim another process is still resolving.
 * Returns the real lock instead when someone else got a browser up first.
 */
export async function claimProfile(userDataDir: string, deps: ClaimDeps = {}): Promise<ClaimResult> {
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? wait;
    const deadline = now() + CLAIM_TIMEOUT_MS;

    for (;;) {
        const attempt = claimLockFile(userDataDir);
        if (attempt.claimed) return { kind: 'claimed' };

        const existing = attempt.existing ?? readLockFile(userDataDir);
        const giveUp = now() >= deadline;
        if (!existing) {
            // Unreadable lock: nothing can be reused from it.
            deleteLockFile(userDataDir);
            // A lock we can neither read nor remove must not spin forever.
            if (giveUp) return { kind: 'claimed' };
            await sleep(POLL_MS);
            continue;
        }
        if (!existing.claiming) return { kind: 'running', lock: existing };

        if (now() - existing.startedAt >= CLAIM_TIMEOUT_MS || giveUp) {
            deleteLockFile(userDataDir);
            if (giveUp) return { kind: 'claimed' };
            continue;
        }
        await sleep(POLL_MS);
    }
}
