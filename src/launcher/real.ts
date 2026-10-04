// ============================================================================
// @aitofy/browser-profiles - Real mode: Chrome keeps its own identity
// ============================================================================
// A spoofed fingerprint on an account first signed in by hand reads as a new
// device, so a real profile skips every engine, override and injected script.

import type { FingerprintEngine, ResolvedEngine, StoredProfile } from '../types';
import type { CdpClient } from './deps';
import { resolveEngine } from './kernel';
import { applyCookies, cookieParams, sessionOf } from './protections';

/** Matched by the command layer to report a configuration mistake, not a launch failure. */
export const REAL_ENGINE_ADVICE =
    'Drop the engine option (or pass "auto") to open it real, or switch the profile with: ' +
    'browser-profiles profile update <idOrName> --fingerprint generated';

export function realEngineConflictMessage(profileName: string, engine: FingerprintEngine): string {
    return `Profile "${profileName}" is real (Chrome's own identity), but engine "${engine}" would spoof ` +
        `its fingerprint. ${REAL_ENGINE_ADVICE}`;
}

/**
 * A real profile resolves to `real` whatever the binary is; asking it for a spoofing
 * engine is a contradiction and throws. Other profiles resolve as before.
 */
export function resolveProfileEngine(
    profile: StoredProfile,
    requested: FingerprintEngine | undefined,
    binaryIsKernel: () => boolean
): ResolvedEngine {
    if (profile.fingerprint?.mode !== 'real') return resolveEngine(requested ?? 'auto', binaryIsKernel());
    if (requested !== undefined && requested !== 'auto') {
        throw new Error(realEngineConflictMessage(profile.name, requested));
    }
    return 'real';
}

export interface RealSessionOptions {
    connect: () => Promise<CdpClient>;
    profile: StoredProfile;
    detached: boolean;
    /** Runs once when the browser goes away on its own. */
    onDisconnect: () => void;
}

/**
 * No tab is touched. Attached, one browser-level connection only watches for the browser
 * to exit; a detached launch connects only when the profile carries cookies to install.
 */
export async function startRealSession(options: RealSessionOptions): Promise<(() => Promise<void>) | undefined> {
    const cookies = (options.profile.cookies ?? []).map(cookieParams);
    if (options.detached && cookies.length === 0) return undefined;

    const client = await options.connect();
    await applyCookies(sessionOf(client), { cookies });
    if (options.detached) {
        await client.close().catch(() => undefined);
        return undefined;
    }

    let released = false;
    client.on('disconnect', () => {
        if (!released) options.onDisconnect();
    });
    return async () => {
        released = true;
        await client.close().catch(() => undefined);
    };
}
