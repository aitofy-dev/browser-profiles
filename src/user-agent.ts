// ============================================================================
// User-Agent builders
// ============================================================================
//
// Chrome ships a "reduced" User-Agent: the OS part is frozen and only the
// major version changes. A spoofed UA therefore only needs a platform and the
// real major version of the Chrome binary that is actually running.

export interface ChromeVersion {
    /** Major version, e.g. 152 */
    major: number;
    /** Full version, e.g. "152.0.7977.83". Falls back to "<major>.0.0.0". */
    full: string;
}

/** Used only when there is no running browser to ask. */
export const FALLBACK_CHROME_MAJOR = 152;

const FROZEN_OS_TOKENS = {
    windows: 'Windows NT 10.0; Win64; x64',
    macos: 'Macintosh; Intel Mac OS X 10_15_7',
    linux: 'X11; Linux x86_64',
} as const;

export type OsFamily = keyof typeof FROZEN_OS_TOKENS;

/**
 * Map a navigator.platform value ("Win32", "MacIntel", "Linux x86_64") to an OS family.
 */
export function osFamilyFromPlatform(platform: string): OsFamily {
    const p = platform.toLowerCase();
    if (p.startsWith('win')) return 'windows';
    if (p.startsWith('mac')) return 'macos';
    return 'linux';
}

/**
 * Parse a Chrome version out of strings such as
 * "Chrome/152.0.7977.83", "HeadlessChrome/152.0.0.0", "Google Chrome 152.0.7977.83"
 * or a full User-Agent string. Returns null when no version is present.
 */
export function parseChromeVersion(input: string): ChromeVersion | null {
    const match = input.match(/(?:Chrome|Chromium|CriOS)\/(\d+)(?:\.(\d+)\.(\d+)\.(\d+))?/)
        ?? input.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    const major = Number(match[1]);
    if (!Number.isFinite(major) || major <= 0) return null;
    const full = match[2] !== undefined
        ? `${major}.${match[2]}.${match[3]}.${match[4]}`
        : `${major}.0.0.0`;
    return { major, full };
}

/**
 * Build a reduced Chrome User-Agent for the given navigator.platform and major version.
 */
export function buildUserAgent(platform: string, major: number): string {
    const os = FROZEN_OS_TOKENS[osFamilyFromPlatform(platform)];
    return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export interface ResolvedUserAgent {
    userAgent: string;
    /** Version the UA claims; drives Client Hints so headers and UA agree. */
    version: ChromeVersion;
    /** True when an explicit UA claims a different major than the running browser. */
    mismatch: boolean;
}

/**
 * Pick the UA to advertise. An explicit UA always wins; otherwise build one
 * that matches the running browser.
 */
export function resolveUserAgent(
    explicit: string | undefined,
    platform: string,
    running: ChromeVersion,
): ResolvedUserAgent {
    if (!explicit) {
        return { userAgent: buildUserAgent(platform, running.major), version: running, mismatch: false };
    }
    const claimed = parseChromeVersion(explicit);
    if (!claimed) {
        return { userAgent: explicit, version: running, mismatch: false };
    }
    return { userAgent: explicit, version: claimed, mismatch: claimed.major !== running.major };
}

export interface UABrand {
    brand: string;
    version: string;
}

/**
 * Brands list for Sec-CH-UA / navigator.userAgentData, consistent with the UA major version.
 */
export function buildBrands(major: number): UABrand[] {
    return [
        { brand: 'Not_A Brand', version: '8' },
        { brand: 'Chromium', version: String(major) },
        { brand: 'Google Chrome', version: String(major) },
    ];
}

export interface UserAgentMetadata {
    brands: UABrand[];
    fullVersionList: UABrand[];
    fullVersion: string;
    platform: string;
    platformVersion: string;
    architecture: string;
    model: string;
    mobile: boolean;
}

/**
 * Metadata for CDP Network.setUserAgentOverride, consistent with buildUserAgent().
 */
export function buildUserAgentMetadata(platform: string, version: ChromeVersion): UserAgentMetadata {
    const family = osFamilyFromPlatform(platform);
    const chPlatform = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[family];
    const platformVersion = { windows: '10.0.0', macos: '14.0.0', linux: '6.5.0' }[family];
    return {
        brands: buildBrands(version.major),
        fullVersionList: [
            { brand: 'Not_A Brand', version: '8.0.0.0' },
            { brand: 'Chromium', version: version.full },
            { brand: 'Google Chrome', version: version.full },
        ],
        fullVersion: version.full,
        platform: chPlatform,
        platformVersion,
        architecture: 'x86',
        model: '',
        mobile: false,
    };
}
