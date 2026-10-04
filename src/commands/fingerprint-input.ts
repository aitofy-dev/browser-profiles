import { Err, Ok } from '../types';
import type { BrowserError, FingerprintConfig, ProfileFingerprint, Result } from '../types';

/** The fingerprint fields profile.create and profile.update accept. */
export interface FingerprintInput {
    mode?: 'generated' | 'real';
    language?: string;
    platform?: string;
}

export const REAL_PLATFORM_MESSAGE =
    'platform cannot be set on a real profile: it would spoof navigator.platform, and a real profile ' +
    'reports Chrome\'s own. Drop platform, or pass fingerprint "generated" to spoof again.';

/**
 * The fingerprint to store once input is applied to the current one, or undefined when
 * the input changes nothing. Switching to real keeps only the language.
 */
export function nextFingerprint(
    current: ProfileFingerprint | undefined,
    input: FingerprintInput
): Result<ProfileFingerprint | undefined> {
    const mode = input.mode ?? (current?.mode === 'real' ? 'real' : 'generated');
    if (mode === 'real' && input.platform !== undefined) {
        return Err<BrowserError>({ code: 'INVALID_CONFIG', message: REAL_PLATFORM_MESSAGE });
    }
    if (input.mode === undefined && input.language === undefined && input.platform === undefined) {
        return Ok(undefined);
    }

    const language = input.language ?? current?.language;
    if (mode === 'real') return Ok(language ? { mode: 'real', language } : { mode: 'real' });

    const next: FingerprintConfig = current?.mode === 'real' ? {} : { ...current };
    if (language) next.language = language;
    if (input.platform !== undefined) next.platform = input.platform;
    return Ok(next);
}
