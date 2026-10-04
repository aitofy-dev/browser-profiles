// ============================================================================
// @aitofy/browser-profiles - Core Type Definitions
// ============================================================================

// ============================================================================
// RESULT TYPE (No try-catch needed!)
// ============================================================================

/**
 * Result type for error handling without try-catch
 * Same pattern as @aitofy/ai-chat
 */
export type Result<T, E = BrowserError> =
    | { ok: true; data: T; error: null }
    | { ok: false; data: null; error: E };

/**
 * Create a success result
 */
export function Ok<T>(data: T): { ok: true; data: T; error: null } {
    return { ok: true, data, error: null };
}

/**
 * Create an error result
 */
export function Err<E>(error: E): { ok: false; data: null; error: E } {
    return { ok: false, data: null, error };
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Browser profile error codes
 */
export type BrowserErrorCode =
    | 'CHROME_NOT_FOUND'     // Chrome executable not found
    | 'LAUNCH_FAILED'        // Failed to launch browser
    | 'PROFILE_NOT_FOUND'    // Profile ID not found
    | 'PROXY_ERROR'          // Proxy configuration error
    | 'NETWORK'              // Network/connection error
    | 'TIMEOUT'              // Operation timed out
    | 'CDP_ERROR'            // Chrome DevTools Protocol error
    | 'INVALID_CONFIG'       // Invalid configuration
    | 'STORAGE_ERROR'        // File system error
    | 'GEO_LOOKUP_FAILED'    // IP geolocation failed
    | 'INTERNAL';            // Unexpected failure, not caused by user input

/**
 * Structured error for browser operations
 */
export interface BrowserError {
    /** Error code for programmatic handling */
    code: BrowserErrorCode;
    /** Human-readable error message */
    message: string;
    /** Original error if available */
    cause?: Error;
    /** Profile ID if applicable */
    profileId?: string;
}

/**
 * Proxy configuration for browser profiles
 */
export interface ProxyConfig {
    /** Proxy type: http, https, or socks5 */
    type: 'http' | 'https' | 'socks5';
    /** Proxy host/IP address */
    host: string;
    /** Proxy port */
    port: number | string;
    /** Username for authentication (optional) */
    username?: string;
    /** Password for authentication (optional) */
    password?: string;
}

/**
 * Cookie to inject into browser profile
 */
export interface ProfileCookie {
    /** Cookie name */
    name: string;
    /** Cookie value */
    value: string;
    /** Domain for the cookie */
    domain: string;
    /** Cookie path (default: "/") */
    path?: string;
    /** HTTP only flag */
    httpOnly?: boolean;
    /** Secure flag */
    secure?: boolean;
    /** SameSite attribute */
    sameSite?: 'Strict' | 'Lax' | 'None';
    /** Expiration timestamp */
    expires?: number;
}

/**
 * Screen resolution configuration
 */
export interface ScreenConfig {
    /** Screen width in pixels */
    width: number;
    /** Screen height in pixels */
    height: number;
    /** Device pixel ratio (default: 1) */
    deviceScaleFactor?: number;
}

/**
 * WebGL fingerprint configuration
 */
export interface WebGLConfig {
    /** WebGL vendor string */
    vendor?: string;
    /** WebGL renderer string */
    renderer?: string;
}

/**
 * Fingerprint configuration for anti-detect
 */
export interface FingerprintConfig {
    /** Absent or "generated": the profile gets a spoofed fingerprint built from these settings. */
    mode?: 'generated';
    /** User agent string */
    userAgent?: string;
    /** Accept-Language header */
    language?: string;
    /** Screen configuration */
    screen?: ScreenConfig;
    /** WebGL configuration */
    webgl?: WebGLConfig;
    /** Platform (e.g., "Win32", "MacIntel") */
    platform?: string;
    /** Number of CPU cores */
    hardwareConcurrency?: number;
    /** Device memory in GB */
    deviceMemory?: number;
    /** WebRTC handling: disable, fake, or real */
    webrtc?: 'disable' | 'fake' | 'real';
    /** Canvas fingerprint: noise or real */
    canvas?: 'noise' | 'real';
    /** Audio fingerprint: noise or real */
    audio?: 'noise' | 'real';
}

/**
 * Chrome's own identity: nothing is generated, overridden or injected, so a hand-made
 * login keeps looking like the same device. Only an explicit language becomes --lang.
 */
export interface RealFingerprint {
    mode: 'real';
    /** BCP 47 tag passed to Chrome as --lang. Unset keeps Chrome's own language. */
    language?: string;
}

/** What a stored profile says about its fingerprint. Stored JSON without `mode` is generated. */
export type ProfileFingerprint = FingerprintConfig | RealFingerprint;

/** The settings a spoofing engine reads. A real profile has none. */
export function spoofSettings(fingerprint: ProfileFingerprint | undefined): FingerprintConfig | undefined {
    return fingerprint?.mode === 'real' ? undefined : fingerprint;
}

/**
 * auto: kernel when the executable is fingerprint-chromium, otherwise JavaScript injection.
 * kernel: engine-level spoof. Refuses to launch on stock Chrome.
 * inject: JavaScript and CDP overrides, even if the binary is a kernel build.
 */
export type FingerprintEngine = 'auto' | 'kernel' | 'inject';

/** The engines that spoof a fingerprint. */
export type SpoofEngine = 'kernel' | 'inject';

/** What a running browser actually launched with. real: no engine, Chrome's own identity. */
export type ResolvedEngine = SpoofEngine | 'real';

/**
 * Browser profile configuration
 */
export interface ProfileConfig {
    /** Unique profile ID (auto-generated if not provided) */
    id?: string;
    /** Profile display name */
    name: string;
    /** Proxy configuration */
    proxy?: ProxyConfig | null;
    /** Timezone ID (e.g., "America/New_York") */
    timezone?: string;
    /** Cookies to inject */
    cookies?: ProfileCookie[];
    /** Spoofed fingerprint settings (default), or `{ mode: 'real' }` for Chrome's own identity */
    fingerprint?: ProfileFingerprint;
    /** URLs to open on launch */
    startUrls?: string[];
    /** Additional notes/metadata */
    notes?: string;
    /** Group ID for organization */
    groupId?: string;
    /** Tags for categorization */
    tags?: string[];
}

/**
 * Stored profile with metadata
 */
export interface StoredProfile extends ProfileConfig {
    /** Unique profile ID */
    id: string;
    /** Creation timestamp */
    createdAt: number;
    /** Last updated timestamp */
    updatedAt: number;
    /** Last launched timestamp */
    lastLaunchedAt?: number;
}

/**
 * Browser launch options
 */
export interface LaunchOptions {
    /** Run in headless mode */
    headless?: boolean;
    /** Custom Chrome/Chromium path */
    chromePath?: string;
    /** Additional Chrome flags */
    args?: string[];
    /** Extensions to load (paths or built-in names) */
    extensions?: string[];
    /** Viewport width */
    defaultViewport?: { width: number; height: number } | null;
    /** Slow motion delay in ms (for debugging) */
    slowMo?: number;
    /** Timeout for browser launch in ms */
    timeout?: number;
    /** Let Chrome outlive this Node process (no SIGINT handler, child unref'd) */
    detached?: boolean;
    /**
     * Where the fingerprint is applied.
     * Default `auto`: kernel when the executable has the fingerprint-chromium switch.
     * A real profile only accepts `auto`; it then launches with no engine.
     */
    engine?: FingerprintEngine;
}

/**
 * Options for BrowserProfiles manager
 */
export interface BrowserProfilesOptions {
    /** Directory to store profile data */
    storagePath?: string;
    /** Custom Chrome/Chromium executable path */
    chromePath?: string;
    /** Default timezone for new profiles */
    defaultTimezone?: string;
    /** Default proxy for new profiles */
    defaultProxy?: ProxyConfig;
}

/**
 * Result of launching a browser
 */
export interface LaunchResult {
    /** WebSocket debugger URL for connecting Puppeteer/Playwright */
    wsEndpoint: string;
    /** Browser process ID */
    pid: number;
    /** Port the browser is listening on */
    port: number;
    /** Profile ID that was launched */
    profileId: string;
    /** Close function to cleanup */
    close: () => Promise<void>;
    /** True when an already-running browser was reused instead of launched */
    reused?: boolean;
    /** True when Chrome outlives this process, so only the first tab is protected */
    detached?: boolean;
    /** kernel spoofs inside Chromium. inject patches from JavaScript. real changes nothing. */
    engine: ResolvedEngine;
}

/**
 * Profile group for organization
 */
export interface ProfileGroup {
    /** Unique group ID */
    id: string;
    /** Group name */
    name: string;
    /** Group description */
    description?: string;
    /** Number of profiles in group */
    profileCount?: number;
}

/**
 * ExTower API specific types
 */
export interface ExTowerCreateOptions {
    /** Profile name */
    name: string;
    /** Group ID to add profile to */
    groupId?: string;
    /** Proxy configuration */
    proxy?: ProxyConfig;
    /** Cookies to set */
    cookies?: ProfileCookie[];
    /** URLs to open */
    openUrls?: string[];
    /** User agent override */
    userAgent?: string;
}

export interface ExTowerProfile {
    /** ExTower user ID */
    userId: string;
    /** Profile name */
    name: string;
    /** Group ID */
    groupId?: string;
    /** Creation time */
    createdTime?: string;
}

export interface ExTowerLaunchResult {
    /** WebSocket URL for Puppeteer */
    puppeteer: string;
    /** WebSocket URL for Selenium */
    selenium?: string;
    /** WebDriver path */
    webdriver?: string;
}

/**
 * Fingerprint generation options
 */
export interface FingerprintGenerateOptions {
    /** Target OS: Windows, macOS, Linux */
    os?: 'Windows' | 'macOS' | 'Linux';
    /** Target browser */
    browser?: 'Chrome' | 'Firefox' | 'Edge';
    /** Base User-Agent to modify */
    baseUserAgent?: string;
    /** Screen resolution presets */
    screenPreset?: '1080p' | '1440p' | '4k' | 'laptop';
}
