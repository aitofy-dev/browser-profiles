// ============================================================================
// @aitofy/browser-profiles - Launch Chrome for a profile
// ============================================================================

import type { LaunchOptions, LaunchResult, ResolvedEngine, StoredProfile } from '../types';
import { createLogger } from '../log';
import { deleteLockFile, lockFilePath, probeDevToolsPort, writeLockFile } from '../storage';
import { startAutoAttach } from './auto-attach';
import { buildChromeFlags, clearStaleSingletonLocks } from './chrome-flags';
import { getChromePath } from './chrome-path';
import { binaryLooksLikeKernel, buildKernelFlags, resolveEngine } from './kernel';
import { claimProfile } from './claim';
import { loadCdp, loadChromeLauncher } from './deps';
import type { CdpClient, CdpConnectOptions, LaunchedChrome } from './deps';
import { applyCookies, applyProtections, buildProtectionPlan, sessionOf } from './protections';
import type { ProtectionPlan } from './protections';
import {
    assertDetachedLaunchAllowed,
    closeProxyRelay,
    detectExitLocation,
    detectTimezoneFromIP,
    startProxyRelay,
} from './proxy';
import { reuseExisting } from './reuse';
import { trackBrowser, untrackBrowser } from './running';
import { parseChromeVersion, FALLBACK_CHROME_MAJOR, FALLBACK_CHROME_VERSION } from '../user-agent';
import type { ChromeVersion } from '../user-agent';

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

/** Timezone for Chrome's TZ, from the profile, else the proxy exit IP, else this host. */
async function resolveTimezone(profile: StoredProfile, relayUrl: string | undefined): Promise<string> {
    if (profile.timezone) return profile.timezone;

    if (profile.proxy) {
        const exit = relayUrl ? await detectExitLocation(relayUrl) : null;
        const geo = exit ?? await detectTimezoneFromIP(profile.proxy.host);
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
    const engine = resolveEngine(options.engine ?? 'auto', binaryLooksLikeKernel(executablePath));
    if (engine === 'kernel' && profile.fingerprint?.userAgent) {
        log.warn(
            'fingerprint.userAgent is ignored in kernel mode. The binary sets the user agent from its ' +
            'own version; a pinned string would disagree with it.'
        );
    }
    const relayUrl = profile.proxy ? await startProxyRelay(profile.proxy) : undefined;
    const timezone = await resolveTimezone(profile, relayUrl);

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
                kernelFlags: engine === 'kernel' ? buildKernelFlags(profile, timezone) : undefined,
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
        log.info(`Chrome started on port ${chrome.port} (pid ${chrome.pid}, ${engine})`);
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

    let releaseSession: (() => Promise<void>) | undefined;

    try {
        releaseSession = detached
            ? await protectFirstTabOnly(chrome.port, profile, timezone, engine)
            : await protectEveryTab(wsEndpoint, profile, timezone, engine, userDataDir, relayUrl);
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
        engine,
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

    return {
        wsEndpoint,
        pid: chrome.pid,
        port: chrome.port,
        profileId: profile.id,
        close,
        detached,
        engine,
    };
}

/** Ask the browser which Chrome it really is, so the UA cannot claim another version. */
async function readChromeVersion(client: CdpClient): Promise<ChromeVersion> {
    try {
        const { product } = await client.send('Browser.getVersion');
        const parsed = parseChromeVersion(String(product ?? ''));
        if (parsed) return parsed;
    } catch {
        // A UA one major off still beats refusing to launch.
    }
    log.warn(`Could not read the Chrome version, assuming ${FALLBACK_CHROME_MAJOR}`);
    return FALLBACK_CHROME_VERSION;
}

/** The plan needs the running Chrome's version, so it is built once the client is connected. */
async function planFor(
    client: CdpClient,
    profile: StoredProfile,
    timezone: string,
    engine: ResolvedEngine
): Promise<ProtectionPlan> {
    if (engine === 'kernel') return buildProtectionPlan(profile, timezone, FALLBACK_CHROME_VERSION, 'kernel');

    const plan = buildProtectionPlan(profile, timezone, await readChromeVersion(client));
    const mismatch = plan.userAgentMismatch;
    if (mismatch) {
        log.warn(
            `fingerprint.userAgent claims Chrome ${mismatch.claimed} but the running browser is ` +
            `${mismatch.running}; detectors compare these. Drop fingerprint.userAgent to follow the browser.`
        );
    }
    return plan;
}

/**
 * Detached: the CDP socket would pin our event loop, so it is closed again.
 * Cost: only the tab open right now carries the per-session overrides.
 */
async function protectFirstTabOnly(
    port: number,
    profile: StoredProfile,
    timezone: string,
    engine: ResolvedEngine
): Promise<undefined> {
    const client = await connectCdp({ port });
    try {
        const plan = await planFor(client, profile, timezone, engine);
        const session = sessionOf(client);
        await applyProtections(session, plan);
        await applyCookies(session, plan);
    } finally {
        await client.close().catch(() => undefined);
    }
    return undefined;
}

/** Attached: one browser-level connection protects the first tab and every later one. */
async function protectEveryTab(
    wsEndpoint: string,
    profile: StoredProfile,
    timezone: string,
    engine: ResolvedEngine,
    userDataDir: string,
    relayUrl: string | undefined
): Promise<() => Promise<void>> {
    const client = await connectCdp({ target: wsEndpoint });
    const plan = await planFor(client, profile, timezone, engine);
    await applyCookies(sessionOf(client), plan);

    const handle = await startAutoAttach({
        client,
        plan,
        log,
        onDisconnect: () => {
            // The browser died on its own: drop the state that claims it is alive.
            untrackBrowser(profile.id);
            deleteLockFile(userDataDir);
            void closeProxyRelay(relayUrl);
        },
    });

    return async () => {
        await handle.stop();
        await client.close().catch(() => undefined);
    };
}
