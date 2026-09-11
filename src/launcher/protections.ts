// ============================================================================
// @aitofy/browser-profiles - Anti-detect injections, applied per CDP session
// ============================================================================

import type { ProfileCookie, StoredProfile } from '../types';
import { getAllProtectionScripts } from '../fingerprint';
import type { CdpClient, CdpParams, CdpResult } from './deps';
import { FALLBACK_TIMEZONE } from './proxy';

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_PLATFORM = 'Win32';
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_CORES = 8;
const DEFAULT_MEMORY_GB = 8;

/** One CDP target, addressed directly or through a flat session id. */
export interface CdpSession {
    send(method: string, params?: CdpParams): Promise<CdpResult>;
}

/** Bind a session id to a client so every command lands on that one target. */
export function sessionOf(client: CdpClient, sessionId?: string): CdpSession {
    return { send: (method, params) => client.send(method, params, sessionId) };
}

/**
 * Everything a tab needs to look like the profile.
 * Built once per launch, replayed on every target the browser opens.
 */
export interface ProtectionPlan {
    userAgentOverride: CdpParams;
    initScript: string;
    timezoneId: string;
    cookies: CdpParams[];
}

function metadataPlatform(platform: string): string {
    if (platform.includes('Win')) return 'Windows';
    if (platform.includes('Mac')) return 'macOS';
    return 'Linux';
}

function cookieParams(cookie: ProfileCookie): CdpParams {
    return {
        url: `https://${cookie.domain}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure || false,
        sameSite: cookie.sameSite || 'Lax',
        ...(cookie.expires ? { expires: cookie.expires } : {}),
    };
}

/** Pure: turn a profile into the exact CDP payloads its tabs need. */
/** `timezoneId` is the timezone Chrome was started with (TZ env), so Intl and the clock agree. */
export function buildProtectionPlan(profile: StoredProfile, timezoneId: string = profile.timezone || FALLBACK_TIMEZONE): ProtectionPlan {
    const userAgent = profile.fingerprint?.userAgent || DEFAULT_USER_AGENT;
    const platform = profile.fingerprint?.platform || DEFAULT_PLATFORM;
    const language = profile.fingerprint?.language || DEFAULT_LANGUAGE;

    return {
        userAgentOverride: {
            userAgent,
            platform,
            acceptLanguage: language,
            userAgentMetadata: {
                brands: [
                    { brand: 'Not_A Brand', version: '8' },
                    { brand: 'Chromium', version: '120' },
                    { brand: 'Google Chrome', version: '120' },
                ],
                fullVersion: '120.0.0.0',
                platform: metadataPlatform(platform),
                platformVersion: platform.includes('Win') ? '10.0.0' : '14.0.0',
                architecture: 'x86',
                model: '',
                mobile: false,
            },
        },
        initScript: getAllProtectionScripts({
            webrtc: true,
            canvas: true,
            webgl: true,
            audio: true,
            navigator: {
                language,
                platform,
                hardwareConcurrency: profile.fingerprint?.hardwareConcurrency || DEFAULT_CORES,
                deviceMemory: profile.fingerprint?.deviceMemory || DEFAULT_MEMORY_GB,
            },
        }),
        timezoneId,
        cookies: (profile.cookies ?? []).map(cookieParams),
    };
}

/**
 * Apply a plan to one target. The only place injections are listed.
 * Both the tab Chrome starts with and every auto-attached tab go through here.
 */
export async function applyProtections(session: CdpSession, plan: ProtectionPlan): Promise<void> {
    await session.send('Network.enable');
    await session.send('Network.setUserAgentOverride', plan.userAgentOverride);
    // New-document scripts only run for a session whose Page agent is enabled.
    await session.send('Page.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: plan.initScript });
    await session.send('Emulation.setTimezoneOverride', { timezoneId: plan.timezoneId });

    for (const cookie of plan.cookies) {
        // A cookie the target rejects must not cost the rest of the protections.
        await session.send('Network.setCookie', cookie).catch(() => undefined);
    }
}
