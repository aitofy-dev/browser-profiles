// ============================================================================
// @aitofy/browser-profiles - Main Entry Point
// ============================================================================

/**
 * @aitofy/browser-profiles
 *
 * Anti-detect browser profiles for Puppeteer & Playwright.
 * Multi-account browser automation with fingerprint protection.
 *
 * @example Basic usage
 * ```typescript
 * import { BrowserProfiles } from '@aitofy/browser-profiles';
 *
 * const profiles = new BrowserProfiles();
 *
 * // Create profile
 * const profile = await profiles.create({
 *   name: 'My Profile',
 *   proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
 *   timezone: 'America/New_York',
 * });
 *
 * // Launch browser
 * const { wsEndpoint, close } = await profiles.launch(profile.id);
 * ```
 *
 * @example With Puppeteer
 * ```typescript
 * import { withPuppeteer } from '@aitofy/browser-profiles/puppeteer';
 *
 * const { browser, page, close } = await withPuppeteer({
 *   profile: 'my-profile-id',
 * });
 *
 * await page.goto('https://example.com');
 * await close();
 * ```
 *
 * @example With ExTower
 * ```typescript
 * import { ExTowerClient } from '@aitofy/browser-profiles/extower';
 *
 * const client = new ExTowerClient();
 * const { puppeteer } = await client.launchBrowser('user-id');
 * ```
 *
 * @packageDocumentation
 */

// Core exports
export { BrowserProfiles } from './profile-manager';
export {
    launchChrome,
    closeBrowser,
    closeAllBrowsers,
    getChromePath,
    buildProxyUrl,
    detectTimezoneFromIP,
    autoDetectTimezone,
    // v0.2.0: Standalone Chrome launch
    launchChromeStandalone,
} from './chrome-launcher';

// Chrome launcher types
export type {
    StandaloneLaunchOptions,
    StandaloneLaunchResult,
} from './chrome-launcher';

// Fingerprint protection scripts (for custom use)
export {
    WEBRTC_PROTECTION_SCRIPT,
    CANVAS_PROTECTION_SCRIPT,
    WEBGL_PROTECTION_SCRIPT,
    AUDIO_PROTECTION_SCRIPT,
    getAllProtectionScripts,
    createNavigatorScript,
    // v0.2.0: Fingerprint generation
    generateFingerprint,
    getFingerprintScripts,
} from './fingerprint';

// Fingerprint types
export type {
    GenerateFingerprintOptions,
    GeneratedFingerprint,
} from './fingerprint';

// Types
export type {
    // Result type (no try-catch needed!)
    Result,
    BrowserError,
    BrowserErrorCode,

    // Profile types
    ProfileConfig,
    StoredProfile,
    ProfileGroup,
    BrowserProfilesOptions,

    // Launch types
    LaunchOptions,
    LaunchResult,

    // Proxy & Cookie types
    ProxyConfig,
    ProfileCookie,

    // Fingerprint types
    FingerprintConfig,
    FingerprintGenerateOptions,
    ScreenConfig,
    WebGLConfig,

    // ExTower types
    ExTowerCreateOptions,
    ExTowerProfile,
    ExTowerLaunchResult,
} from './types';

// Result helpers
export { Ok, Err } from './types';

// ============================================================================
// Puppeteer Integration (re-exported for convenience)
// ============================================================================
// Users can now use:
//   import { quickLaunch } from '@aitofy/browser-profiles'
// Instead of:
//   import { quickLaunch } from '@aitofy/browser-profiles/puppeteer'

export {
    withPuppeteer,
    quickLaunch,
    connectPuppeteer,
    patchPage,
    createSession,
} from './integrations/puppeteer';

export type {
    WithPuppeteerOptions,
    WithPuppeteerResult,
    QuickLaunchOptions,
    PatchPageOptions,
    CreateSessionOptions,
    SessionResult,
} from './integrations/puppeteer';

// Version
export const VERSION = '0.2.3';
