// ============================================================================
// @aitofy/browser-profiles - Chrome command line
// ============================================================================

import fs from 'fs';
import path from 'path';
import { isProcessAlive } from '../storage';
import type { StoredProfile } from '../types';

export interface ChromeFlagOptions {
    profile: StoredProfile;
    userDataDir: string;
    headless: boolean;
    args: string[];
    extensions: string[];
    /** Local relay URL from `startProxyRelay`, never the upstream proxy. */
    proxyServer?: string;
    /** fingerprint-chromium switches. Empty on the inject engine. */
    kernelFlags?: string[];
    /** Real profile: no anti-detect flags, and --lang only when the profile pins a language. */
    real?: boolean;
}

const BASE_FLAGS = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
];

// Drops the automation-controlled bit navigator.webdriver reads.
const NOT_WEBDRIVER_FLAG = '--disable-blink-features=AutomationControlled';

// WebRTC must not reach the network outside the proxy.
const WEBRTC_PROXY_FLAGS = [
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--force-webrtc-ip-handling-policy',
];

const ANTI_DETECT_FLAGS = [
    NOT_WEBDRIVER_FLAG,
    '--disable-infobars',
    '--disable-extensions-file-access-check',
    '--enable-features=NetworkService,NetworkServiceInProcess',
    '--disable-features=IsolateOrigins,site-per-process',
    ...WEBRTC_PROXY_FLAGS,
];

const HEADLESS_FLAGS = ['--headless=new', '--mute-audio', '--hide-scrollbars'];

function extensionFlags(extensions: string[]): string[] {
    const valid = extensions.filter(
        (ext) => fs.existsSync(ext) && fs.existsSync(path.join(ext, 'manifest.json'))
    );
    if (valid.length === 0) return [];
    const joined = valid.join(',');
    return [`--disable-extensions-except=${joined}`, `--load-extension=${joined}`];
}

/** A hand-opened Chrome is not webdriver, so that bit stays off; the proxy must not leak either. */
function realIdentityFlags(language: string | undefined, proxyServer: string | undefined): string[] {
    return [
        ...(language ? [`--lang=${language}`] : []),
        NOT_WEBDRIVER_FLAG,
        ...(proxyServer ? WEBRTC_PROXY_FLAGS : []),
    ];
}

export function buildChromeFlags(options: ChromeFlagOptions): string[] {
    const { profile, userDataDir, headless, args, extensions, proxyServer, kernelFlags = [] } = options;
    const language = profile.fingerprint?.language;

    return [
        ...BASE_FLAGS,
        ...(options.real
            ? realIdentityFlags(language, proxyServer)
            : [`--lang=${language || 'en-US'}`, ...ANTI_DETECT_FLAGS, ...kernelFlags]),
        ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
        ...(headless ? HEADLESS_FLAGS : []),
        ...(proxyServer ? [`--proxy-server=${proxyServer}`] : []),
        ...(headless ? [] : extensionFlags(extensions)),
        // Last: Chrome stops reading switches at the first positional argument (a URL).
        ...args,
    ];
}

/** SingletonLock is a symlink named "<hostname>-<pid>" pointing at the owning Chrome. */
function singletonHolderPid(userDataDir: string): number | null {
    try {
        const target = fs.readlinkSync(path.join(userDataDir, 'SingletonLock'));
        const pid = Number(/-(\d+)$/.exec(target)?.[1]);
        return Number.isInteger(pid) ? pid : null;
    } catch {
        return null;
    }
}

/**
 * Chrome refuses to start on lock files a crashed run left behind.
 * A lock a live process still holds is left alone: deleting it would let a
 * second Chrome corrupt the running one's profile.
 * @returns false when a live Chrome holds the lock.
 */
export function clearStaleSingletonLocks(userDataDir: string): boolean {
    const holder = singletonHolderPid(userDataDir);
    if (holder !== null && holder !== process.pid && isProcessAlive(holder)) return false;

    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try {
            fs.rmSync(path.join(userDataDir, name), { force: true });
        } catch {
            // The file may be held by a live Chrome; the launch below will say so.
        }
    }
    return true;
}
