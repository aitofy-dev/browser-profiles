// ============================================================================
// @aitofy/browser-profiles - Launch Chrome for a profile
// ============================================================================

import type { LaunchOptions, LaunchResult, StoredProfile } from '../types';
import { createLogger } from '../log';
import { deleteLockFile, lockFilePath, probeDevToolsPort, writeLockFile } from '../storage';
import { startAutoAttach } from './auto-attach';
import { buildChromeFlags, clearStaleSingletonLocks } from './chrome-flags';
import { getChromePath } from './chrome-path';
import { claimProfile } from './claim';
import { loadCdp, loadChromeLauncher } from './deps';
import type { CdpClient, CdpConnectOptions, LaunchedChrome } from './deps';
import { applyProtections, buildProtectionPlan, sessionOf } from './protections';
import {
    assertDetachedLaunchAllowed,
    closeProxyRelay,
    detectTimezoneFromIP,
    startProxyRelay,
} from './proxy';
import { reuseExisting } from './reuse';
import { trackBrowser, untrackBrowser } from './running';

const log = createLogger('chrome-launcher');

const CONNECT_ATTEMPTS = 10;
const CONNECT_DELAY_MS = 300;
const ENDPOINT_ATTEMPTS = 10;
const ENDPOINT_DELAY_MS = 200;
/** Each pass either claims, reuses, or clears one stale lock. */
const CLAIM_ATTEMPTS = 3;

export interface ChromeLaunchOptions extends LaunchOptions {
    profile: StoredProfile;
    userDataDir: string;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Timezone for Chrome's TZ, from the profile, else the proxy exit node, else this host. */
async function resolveTimezone(profile: StoredProfile): Promise<string> {
    if (profile.timezone) return profile.timezone;

    if (profile.proxy) {
        const geo = await detectTimezoneFromIP(profile.proxy.host);
        if (geo) {
            log.info(`Auto-detected timezone: ${geo.timezone} (${geo.city}, ${geo.country})`);
            return geo.timezone;
        }
    }

    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    log.debug(`Using system timezone: ${systemTimezone}`);
    return systemTimezone;
}

async function browserEndpoint(port: number): Promise<string | null> {
    for (let attempt = 0; attempt < ENDPOINT_ATTEMPTS; attempt++) {
        const endpoint = await probeDevToolsPort(port);
        if (endpoint) return endpoint;
        if (attempt < ENDPOINT_ATTEMPTS - 1) await delay(ENDPOINT_DELAY_MS);
    }
    return null;
}

async function connectCdp(options: CdpConnectOptions): Promise<CdpClient> {
    const connect = await loadCdp();
    let lastError: unknown;

    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
        try {
            return await connect(options);
        } catch (error) {
            lastError = error;
            await delay(CONNECT_DELAY_MS);
        }
    }

    log.error(`Failed to connect CDP after ${CONNECT_ATTEMPTS} retries`);
    throw lastError instanceof Error ? lastError : new Error('Failed to connect to Chrome DevTools');
}

async function abortLaunch(chrome: LaunchedChrome, relayUrl: string | undefined): Promise<void> {
    try {
        await chrome.kill();
    } catch {
        // Already dead.
    }
    await closeProxyRelay(relayUrl);
}

/**
 * Launch Chrome with the profile's anti-detect protections.
 *
 * Unless `detached`, a browser-level CDP connection stays open for the life of
 * the browser so tabs opened later by any client are protected too (ADR 4b).
 */
export async function launchChrome(options: ChromeLaunchOptions): Promise<LaunchResult> {
    const { profile, userDataDir, detached = false } = options;

    assertDetachedLaunchAllowed(profile.proxy, detached);

    const claimed = await claimOrReuse(profile, userDataDir);
    if (claimed) return claimed;

    try {
        return await launchClaimed(options, userDataDir);
    } catch (error) {
        // The claim promises a browser; without one it must not outlive this call.
        deleteLockFile(userDataDir);
        throw error;
    }
}

/** Wait out a concurrent claim, then either reuse the browser it produced or take the profile. */
async function claimOrReuse(profile: StoredProfile, userDataDir: string): Promise<LaunchResult | null> {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
        const claim = await claimProfile(userDataDir);
        if (claim.kind === 'claimed') return null;

        const reused = await reuseExisting(profile, userDataDir, claim.lock);
        if (reused) return reused;
        // reuseExisting proved the lock stale and removed it; claim it on the next pass.
    }

    throw new Error(
        `Could not take the lock for profile "${profile.name}": another process keeps claiming ` +
        `${lockFilePath(userDataDir)}. Close it with browser.close or delete that file.`
    );
}

const URL_ARG = /^(https?|file|data|about):/i;

/**
 * chrome-launcher always appends one starting URL, and headless Chrome refuses a
 * second one, so a URL passed in `args` has to become that starting URL.
 */
function splitStartingUrl(args: string[]): { startingUrl?: string; flagArgs: string[] } {
    const index = args.findIndex((arg) => URL_ARG.test(arg));
    if (index === -1) return { flagArgs: args };
    return { startingUrl: args[index], flagArgs: args.filter((_, at) => at !== index) };
}

async function launchClaimed(options: ChromeLaunchOptions, userDataDir: string): Promise<LaunchResult> {
    const {
        profile,
        headless = false,
        chromePath,
        args = [],
        extensions = [],
        detached = false,
    } = options;

    // Safe here only because the claim above proved no browser of ours is running.
    if (!clearStaleSingletonLocks(userDataDir)) {
        throw new Error(
            `Another Chrome still holds ${userDataDir}. Close it before opening this profile.`
        );
    }

    const executablePath = getChromePath(chromePath);
    const relayUrl = profile.proxy ? await startProxyRelay(profile.proxy) : undefined;
    const timezone = await resolveTimezone(profile);

    log.debug(`Launching Chrome: ${executablePath}`);
    log.debug(`User data dir: ${userDataDir}`);

    const { startingUrl, flagArgs } = splitStartingUrl(args);

    let chrome: LaunchedChrome;
    try {
        const chromeLauncher = await loadChromeLauncher();
        chrome = await chromeLauncher.launch({
            chromePath: executablePath,
            chromeFlags: buildChromeFlags({
                profile,
                userDataDir,
                headless,
                args: flagArgs,
                extensions,
                proxyServer: relayUrl,
            }),
            ...(startingUrl ? { startingUrl } : {}),
            userDataDir,
            ignoreDefaultFlags: true,
            // Our own SIGINT handlers must run: chrome-launcher's kills and exits first.
            handleSIGINT: false,
            envVars: { TZ: timezone },
        });
        if (detached) {
            // chrome-launcher already spawns with detached:true on POSIX; unref frees our event loop.
            chrome.process?.unref();
        }
        log.info(`Chrome started on port ${chrome.port} (pid ${chrome.pid})`);
    } catch (error) {
        log.error('Chrome launch failed', error);
        await closeProxyRelay(relayUrl);
        throw error;
    }

    const wsEndpoint = await browserEndpoint(chrome.port);
    if (!wsEndpoint) {
        await abortLaunch(chrome, relayUrl);
        throw new Error('Failed to get browser WebSocket endpoint after multiple retries');
    }

    const plan = buildProtectionPlan(profile, timezone);
    let releaseSession: (() => Promise<void>) | undefined;

    try {
        releaseSession = detached
            ? await protectFirstTabOnly(chrome.port, plan)
            : await protectEveryTab(wsEndpoint, plan, profile.id, userDataDir, relayUrl);
    } catch (error) {
        await abortLaunch(chrome, relayUrl);
        throw error;
    }

    trackBrowser(profile.id, { process: chrome, proxyUrl: relayUrl, releaseSession });
    writeLockFile(userDataDir, {
        pid: chrome.pid,
        port: chrome.port,
        wsEndpoint,
        startedAt: Date.now(),
        proxyUrl: relayUrl,
        detached,
    });

    const close = async (): Promise<void> => {
        try {
            if (releaseSession) await releaseSession();
            await chrome.kill();
            await closeProxyRelay(relayUrl);
            untrackBrowser(profile.id);
            deleteLockFile(userDataDir);
        } catch (error) {
            log.error('Error closing browser', error);
        }
    };

    return { wsEndpoint, pid: chrome.pid, port: chrome.port, profileId: profile.id, close, detached };
}

/**
 * Detached: the CDP socket would pin our event loop, so it is closed again.
 * Cost: only the tab open right now carries the per-session overrides.
 */
async function protectFirstTabOnly(port: number, plan: ReturnType<typeof buildProtectionPlan>): Promise<undefined> {
    const client = await connectCdp({ port });
    try {
        await applyProtections(sessionOf(client), plan);
    } finally {
        await client.close().catch(() => undefined);
    }
    return undefined;
}

/** Attached: one browser-level connection protects the first tab and every later one. */
async function protectEveryTab(
    wsEndpoint: string,
    plan: ReturnType<typeof buildProtectionPlan>,
    profileId: string,
    userDataDir: string,
    relayUrl: string | undefined
): Promise<() => Promise<void>> {
    const client = await connectCdp({ target: wsEndpoint });

    const handle = await startAutoAttach({
        client,
        plan,
        log,
        onDisconnect: () => {
            // The browser died on its own: drop the state that claims it is alive.
            untrackBrowser(profileId);
            deleteLockFile(userDataDir);
            void closeProxyRelay(relayUrl);
        },
    });

    return async () => {
        await handle.stop();
        await client.close().catch(() => undefined);
    };
}
