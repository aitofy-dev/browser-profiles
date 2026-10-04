// ============================================================================
// @aitofy/browser-profiles - Kernel fingerprint mode
// ============================================================================
// fingerprint-chromium (an open engine-level spoof)
// applies canvas, WebGL, audio, fonts, client rects and webdriver inside Blink
// when --fingerprint is set. JavaScript hooks are not added on top: detectors
// flag the hooks, not the values.

import fs from 'fs';
import path from 'path';
import type { FingerprintConfig, StoredProfile } from '../types';
import type { FingerprintEngine, ResolvedEngine } from '../types';
import { FINGERPRINT_DEFAULTS } from '../fingerprint';

export const KERNEL_SWITCH = '--fingerprint-platform';

export const KERNEL_REQUIRED_MESSAGE =
    'Kernel mode needs a fingerprint-chromium binary (engine-level spoof). ' +
    'This executable has no --fingerprint-platform switch, so the only spoof left would be JavaScript ' +
    'hooks, and those hooks are what browserscan and creepjs flag. ' +
    'Set CHROMIUM_PATH to a fingerprint-chromium build, or install the app at ' +
    '~/.aitofy/browser-profiles/kernel/Chromium.app (macOS), ' +
    '~/.aitofy/browser-profiles/kernel/chrome (Linux), ' +
    'or %USERPROFILE%\\.aitofy\\browser-profiles\\kernel\\chrome.exe (Windows). ' +
    'Builds: https://github.com/adryfish/fingerprint-chromium/releases';

const CHUNK_BYTES = 1024 * 1024;
// Chromium stores switch names without the leading dashes.
const MARKER = Buffer.from(KERNEL_SWITCH.replace(/^--/, ''));

interface ScanCacheEntry {
    mtimeMs: number;
    size: number;
    kernel: boolean;
}

const scanCache = new Map<string, ScanCacheEntry>();

/** True when the executable is a fingerprint-chromium build, not stock Chrome. */
export function binaryLooksLikeKernel(executablePath: string): boolean {
    return switchTableFiles(executablePath).some(fileHasMarker);
}

/**
 * The file that holds Chromium's switch names. On macOS and Windows the
 * executable is a small launcher; the switches live in the framework or chrome.dll.
 */
export function switchTableFiles(executablePath: string): string[] {
    const macApp = executablePath.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
    if (macApp) {
        const frameworks = path.join(macApp[1], 'Contents', 'Frameworks');
        return listDir(frameworks)
            .filter((name) => name.endsWith(' Framework.framework'))
            .map((name) => path.join(frameworks, name, 'Versions', 'Current', name.replace(/\.framework$/, '')));
    }
    if (executablePath.toLowerCase().endsWith('.exe')) {
        const dir = path.dirname(executablePath);
        return listDir(dir).map((name) => path.join(dir, name, 'chrome.dll'));
    }
    return [executablePath];
}

function listDir(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

function fileHasMarker(filePath: string): boolean {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return false;
    }
    if (!stat.isFile()) return false;

    const cached = scanCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.kernel;

    const kernel = fileContains(filePath, stat.size);
    scanCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, kernel });
    return kernel;
}

function fileContains(filePath: string, size: number): boolean {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(CHUNK_BYTES);
        let position = 0;
        let carry = Buffer.alloc(0);
        const overlap = MARKER.length - 1;
        while (position < size) {
            const read = fs.readSync(fd, buf, 0, CHUNK_BYTES, position);
            if (read <= 0) break;
            const window = carry.length === 0
                ? buf.subarray(0, read)
                : Buffer.concat([carry, buf.subarray(0, read)]);
            if (window.includes(MARKER)) return true;
            carry = Buffer.from(window.subarray(Math.max(0, window.length - overlap)));
            position += read;
        }
        return false;
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * auto uses the kernel only when this executable actually has the switch.
 * kernel without the switch throws: skipping the hooks on stock Chrome would
 * launch a browser with no spoof at all.
 */
export function resolveEngine(requested: FingerprintEngine, binaryIsKernel: boolean): ResolvedEngine {
    if (requested === 'inject') return 'inject';
    if (requested === 'kernel') {
        if (!binaryIsKernel) throw new Error(KERNEL_REQUIRED_MESSAGE);
        return 'kernel';
    }
    return binaryIsKernel ? 'kernel' : 'inject';
}

/** Stable per profile. A new id (including a duplicate) is a new fingerprint. */
export function kernelSeed(profileId: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < profileId.length; i++) {
        hash ^= profileId.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const positive = (hash >>> 0) % 2_147_483_647;
    return positive === 0 ? 1 : positive;
}

export function kernelPlatform(navigatorPlatform: string): 'windows' | 'macos' | 'linux' {
    const value = navigatorPlatform.toLowerCase();
    if (value.includes('mac')) return 'macos';
    if (value.includes('linux') || value === 'x11') return 'linux';
    return 'windows';
}

function acceptLanguage(language: string): string {
    const primary = language.split('-')[0];
    if (!primary || primary.toLowerCase() === language.toLowerCase()) return language;
    return `${language},${primary}`;
}

function disabledSurfaces(fingerprint: FingerprintConfig | undefined): string[] {
    const off: string[] = [];
    if (fingerprint?.canvas === 'real') off.push('canvas');
    if (fingerprint?.audio === 'real') off.push('audio');
    return off;
}

/**
 * Flags the kernel build understands. Brand version is left unset so the UA
 * matches the binary; a pinned fingerprint.userAgent is not applied.
 * GPU strings are derived from the seed (Chrome 144 removed the vendor flags).
 */
export function buildKernelFlags(profile: StoredProfile, timezone: string): string[] {
    const fingerprint = profile.fingerprint;
    const language = fingerprint?.language || FINGERPRINT_DEFAULTS.language;
    const platform = kernelPlatform(fingerprint?.platform || FINGERPRINT_DEFAULTS.platform);
    const flags = [
        `--fingerprint=${kernelSeed(profile.id)}`,
        `--fingerprint-platform=${platform}`,
        '--fingerprint-brand=Chrome',
        `--accept-lang=${acceptLanguage(language)}`,
        `--timezone=${timezone}`,
        '--disable-non-proxied-udp',
    ];

    const cores = fingerprint?.hardwareConcurrency;
    if (typeof cores === 'number' && Number.isInteger(cores) && cores > 0) {
        flags.push(`--fingerprint-hardware-concurrency=${cores}`);
    }

    const off = disabledSurfaces(fingerprint);
    if (off.length > 0) flags.push(`--disable-spoofing=${off.join(',')}`);

    return flags;
}
