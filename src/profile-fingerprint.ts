// ============================================================================
// @aitofy/browser-profiles - Stored fingerprint rules for create and update
// ============================================================================

import type { FingerprintConfig, ProfileConfig, StoredProfile } from './types';
import { pickWebGLForPlatform } from './fingerprint';

/**
 * Persist a platform-consistent WebGL vendor/renderer so every launch of the
 * profile reports the same GPU
 */
function withDefaultWebGL(fingerprint: FingerprintConfig): FingerprintConfig {
    if (fingerprint.webgl?.renderer) return fingerprint;
    return { ...fingerprint, webgl: { ...pickWebGLForPlatform(fingerprint.platform), ...fingerprint.webgl } };
}

type Identity = Pick<ProfileConfig, 'timezone' | 'fingerprint'>;

/** A real profile gets no default timezone and no stored GPU: Chrome keeps its own. */
export function initialIdentity(config: ProfileConfig, defaultTimezone: string | undefined): Identity {
    if (config.fingerprint?.mode === 'real') return { timezone: config.timezone, fingerprint: config.fingerprint };
    return {
        timezone: config.timezone || defaultTimezone || 'America/New_York',
        fingerprint: withDefaultWebGL(config.fingerprint || {}),
    };
}

/**
 * Entering real mode drops the stored timezone (often the create-time default) unless the update
 * names one; leaving it stores the GPU that create() gives a new profile.
 */
export function modeSwitch(existing: StoredProfile, updates: Partial<ProfileConfig>): Partial<ProfileConfig> {
    const next = updates.fingerprint;
    const wasReal = existing.fingerprint?.mode === 'real';
    if (!next || wasReal === (next.mode === 'real')) return {};
    if (next.mode === 'real') return 'timezone' in updates ? {} : { timezone: undefined };
    return { fingerprint: withDefaultWebGL(next) };
}
