// ============================================================================
// @aitofy/browser-profiles - Chrome launcher (public surface)
// ============================================================================
// The implementation lives in ./launcher; this file keeps the import path.
// ============================================================================

export { getChromePath } from './launcher/chrome-path';
export { buildProxyUrl, detectTimezoneFromIP, autoDetectTimezone } from './launcher/proxy';
export { launchChrome } from './launcher/launch';
export type { ChromeLaunchOptions } from './launcher/launch';
export { closeBrowser, closeAllBrowsers, getRunningBrowsers } from './launcher/running';
export { launchChromeStandalone } from './launcher/standalone';
export type { StandaloneLaunchOptions, StandaloneLaunchResult } from './launcher/standalone';
