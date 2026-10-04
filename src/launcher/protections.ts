// ============================================================================
// @aitofy/browser-profiles - Anti-detect injections, applied per CDP session
// ============================================================================

import { spoofSettings } from '../types';
import type { ProfileCookie, SpoofEngine, StoredProfile } from '../types';
import { FINGERPRINT_DEFAULTS, getProfileProtectionScripts, getProfileWorkerScript } from '../fingerprint';
import { buildUserAgentMetadata, resolveUserAgent, FALLBACK_CHROME_VERSION } from '../user-agent';
import type { ChromeVersion } from '../user-agent';
import type { CdpClient, CdpParams, CdpResult } from './deps';
import { FALLBACK_TIMEZONE } from './proxy';

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
    /** Navigator/WebGL spoof evaluated in worker targets before they run. */
    workerScript: string;
    timezoneId: string;
    /** BCP 47 locale for Intl. Chrome on macOS ignores --lang and uses the system locale. */
    locale: string;
    cookies: CdpParams[];
    /** Set when the profile pins a UA claiming another Chrome major than the browser running it. */
    userAgentMismatch: { claimed: number; running: number } | null;
    /** kernel: the binary owns the fingerprint; only the locale override is sent. */
    engine: SpoofEngine;
}

export function cookieParams(cookie: ProfileCookie): CdpParams {
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

/** Matches navigator.languages ([language, primary]); Chrome adds the q-values to the header itself. */
function acceptLanguageHeader(language: string): string {
    const primary = language.split('-')[0];
    return primary === language ? language : `${language},${primary}`;
}

/** Pure: turn a profile into the exact CDP payloads its tabs need. */
/** `timezoneId` is the timezone Chrome was started with (TZ env), so Intl and the clock agree. */
/** `chromeVersion` is the version the browser really reports, so the UA cannot claim another one. */
export function buildProtectionPlan(
    profile: StoredProfile,
    timezoneId: string = profile.timezone || FALLBACK_TIMEZONE,
    chromeVersion: ChromeVersion = FALLBACK_CHROME_VERSION,
    engine: SpoofEngine = 'inject'
): ProtectionPlan {
    const fingerprint = spoofSettings(profile.fingerprint);
    const platform = fingerprint?.platform || FINGERPRINT_DEFAULTS.platform;
    const language = fingerprint?.language || FINGERPRINT_DEFAULTS.language;
    const { userAgent, version, mismatch } = resolveUserAgent(
        fingerprint?.userAgent,
        platform,
        chromeVersion
    );

    return {
        userAgentOverride: {
            userAgent,
            platform,
            acceptLanguage: acceptLanguageHeader(language),
            userAgentMetadata: buildUserAgentMetadata(platform, version),
        },
        initScript: engine === 'kernel' ? '' : getProfileProtectionScripts(fingerprint),
        workerScript: engine === 'kernel' ? '' : getProfileWorkerScript(fingerprint, userAgent),
        timezoneId,
        locale: language,
        cookies: (profile.cookies ?? []).map(cookieParams),
        userAgentMismatch: engine === 'kernel'
            ? null
            : (mismatch ? { claimed: version.major, running: chromeVersion.major } : null),
        engine,
    };
}

/**
 * Apply a plan to one target. The only place injections are listed.
 * Both the tab Chrome starts with and every auto-attached tab go through here.
 */
export async function applyProtections(session: CdpSession, plan: ProtectionPlan): Promise<void> {
    // Hooks on top of a kernel build are the signal detectors look for. The locale is
    // the exception: Chrome on macOS ignores --lang, and no kernel switch sets Intl.
    if (plan.engine === 'kernel') {
        await session.send('Emulation.setLocaleOverride', { locale: plan.locale });
        return;
    }

    await session.send('Network.enable');
    await session.send('Network.setUserAgentOverride', plan.userAgentOverride);
    // New-document scripts only run for a session whose Page agent is enabled.
    await session.send('Page.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: plan.initScript });
    await session.send('Emulation.setTimezoneOverride', { timezoneId: plan.timezoneId });
    await session.send('Emulation.setLocaleOverride', { locale: plan.locale });
}

/**
 * Apply a plan to a worker paused at start. Dedicated workers inherit the
 * page's overrides; shared and service workers have their own, set here.
 */
export async function applyWorkerProtections(session: CdpSession, plan: ProtectionPlan): Promise<void> {
    if (plan.engine === 'kernel') return;

    await session.send('Network.setUserAgentOverride', plan.userAgentOverride);
    await session.send('Runtime.evaluate', { expression: plan.workerScript });
}

/**
 * Cookies belong to the browser's cookie store, not to one tab, so they are
 * installed once per launch and every later tab inherits them.
 */
export async function applyCookies(session: CdpSession, plan: Pick<ProtectionPlan, 'cookies'>): Promise<void> {
    if (plan.cookies.length === 0) return;
    // A cookie the browser rejects must not cost the rest of the launch.
    await session.send('Storage.setCookies', { cookies: plan.cookies }).catch(() => undefined);
}
