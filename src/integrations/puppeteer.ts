// ============================================================================
// @aitofy/browser-profiles - Puppeteer Integration
// ============================================================================

import type { StoredProfile, LaunchOptions, LaunchResult, ProxyConfig, ProfileConfig } from '../types';
import { BrowserProfiles } from '../profile-manager';

// ============================================================================
// NATIVE TYPE RE-EXPORTS
// These provide FULL Puppeteer API access (setRequestInterception, on('request'), etc.)
// ============================================================================

/**
 * Re-export native Puppeteer Page type for full API access
 * This includes ALL Puppeteer Page methods:
 * - setRequestInterception()
 * - on('request', callback)
 * - on('response', callback)
 * - cookies()
 * - setCookie()
 * - waitForSelector()
 * - And many more...
 */
export type { Page as PuppeteerPage } from 'puppeteer-core';

/**
 * Re-export native Puppeteer Browser type for full API access
 */
export type { Browser as PuppeteerBrowser } from 'puppeteer-core';

/**
 * Re-export commonly used Puppeteer types
 */
export type { HTTPRequest, HTTPResponse, Cookie } from 'puppeteer-core';

// Import types for internal use
import type { Page as PuppeteerPageType, Browser as PuppeteerBrowserType } from 'puppeteer-core';

// Create internal aliases (these are used throughout this file)
type PuppeteerBrowser = PuppeteerBrowserType;
type PuppeteerPage = PuppeteerPageType;

/**
 * Options for withPuppeteer
 */
export interface WithPuppeteerOptions extends LaunchOptions {
    /**
     * Profile ID or name to launch
     */
    profile: string;

    /**
     * BrowserProfiles instance (optional, creates new one if not provided)
     */
    profiles?: BrowserProfiles;

    /**
     * Storage path for profiles (if creating new BrowserProfiles instance)
     */
    storagePath?: string;

    /**
     * Puppeteer instance to use (optional)
     * If not provided, will auto-detect from installed packages
     * 
     * @example
     * ```typescript
     * import puppeteer from 'puppeteer-core';
     * 
     * const { browser, page } = await withPuppeteer({
     *   profile: 'my-profile',
     *   puppeteer, // Use your own puppeteer instance
     * });
     * ```
     */
    puppeteer?: any;
}

/**
 * Options for quick launch without existing profile
 */
export interface QuickLaunchOptions extends LaunchOptions {
    /**
     * Profile name (optional)
     */
    name?: string;

    /**
     * Proxy configuration
     */
    proxy?: ProxyConfig;

    /**
     * Timezone
     */
    timezone?: string;

    /**
     * Fingerprint configuration
     */
    fingerprint?: {
        language?: string;
        platform?: string;
        hardwareConcurrency?: number;
        deviceMemory?: number;
        userAgent?: string;
    };

    /**
     * Storage path for profiles
     */
    storagePath?: string;

    /**
     * Puppeteer instance to use (optional)
     * If not provided, will auto-detect from installed packages
     * 
     * @example
     * ```typescript
     * import puppeteer from 'rebrowser-puppeteer-core';
     * 
     * const { browser, page } = await quickLaunch({
     *   puppeteer, // Use your own puppeteer instance
     *   proxy: { type: 'http', host: 'proxy.com', port: 8080 },
     * });
     * ```
     */
    puppeteer?: any;
}

/**
 * Options for close function
 */
export interface CloseOptions {
    /**
     * If true, kill the browser process entirely.
     * If false (default), only close pages opened by this session.
     * @default false
     */
    terminate?: boolean;
}

/**
 * Result from withPuppeteer
 */
export interface WithPuppeteerResult {
    /**
     * Connected Puppeteer browser instance
     */
    browser: PuppeteerBrowser;

    /**
     * First page (convenience)
     */
    page: PuppeteerPage;

    /**
     * Profile that was used
     */
    profile: StoredProfile;

    /**
     * Launch result with ws endpoint and close function
     */
    launch: LaunchResult;

    /**
     * Close this session's pages only (browser stays running for other sessions).
     * Use `terminate()` to kill the browser entirely.
     * @param options - Optional close options
     */
    close: (options?: CloseOptions) => Promise<void>;

    /**
     * Kill the browser process entirely.
     * Shorthand for `close({ terminate: true })`
     */
    terminate: () => Promise<void>;
}

/**
 * Get Puppeteer dynamically
 * Priority: rebrowser-puppeteer-core > puppeteer-core > puppeteer
 * 
 * Uses dynamic import() for ESM compatibility (works in tsx, vite, next.js, etc.)
 */
async function getPuppeteer(): Promise<any> {
    const packages = [
        { name: 'rebrowser-puppeteer-core', label: 'rebrowser-puppeteer-core (enhanced anti-detect)' },
        { name: 'puppeteer-core', label: 'puppeteer-core' },
        { name: 'puppeteer', label: 'puppeteer' },
    ];

    for (const pkg of packages) {
        try {
            const module = await import(pkg.name);
            console.log(`[browser-profiles] Using ${pkg.label}`);
            // Handle both ESM default export and CJS module.exports
            return module.default || module;
        } catch {
            // Package not installed, try next
            continue;
        }
    }

    throw new Error(
        'Puppeteer not found. Please install one of the following:\n' +
        '  npm install rebrowser-puppeteer-core  (recommended for anti-detect)\n' +
        '  npm install puppeteer-core\n' +
        '  npm install puppeteer'
    );
}

/**
 * Launch a browser profile and connect with Puppeteer
 *
 * @example
 * ```typescript
 * import { withPuppeteer } from '@aitofy/browser-profiles/puppeteer';
 *
 * const { browser, page, close } = await withPuppeteer({
 *   profile: 'my-profile-id',
 * });
 *
 * await page.goto('https://example.com');
 *
 * // Cleanup when done
 * await close();
 * ```
 */
export async function withPuppeteer(options: WithPuppeteerOptions): Promise<WithPuppeteerResult> {
    // Use injected puppeteer or auto-detect
    const puppeteer = options.puppeteer || await getPuppeteer();

    // Get or create BrowserProfiles instance
    const profiles = options.profiles || new BrowserProfiles({
        storagePath: options.storagePath,
    });

    // Find profile by ID or name
    let profile = await profiles.get(options.profile);

    if (!profile) {
        // Try to find by name
        const allProfiles = await profiles.list();
        profile = allProfiles.find((p) => p.name === options.profile) || null;
    }

    if (!profile) {
        throw new Error(`Profile not found: ${options.profile}`);
    }

    // Launch browser
    const launch = await profiles.launch(profile.id, {
        headless: options.headless,
        chromePath: options.chromePath,
        args: options.args,
        extensions: options.extensions,
        defaultViewport: options.defaultViewport,
        slowMo: options.slowMo,
        timeout: options.timeout,
    });

    // Connect Puppeteer (with retry on connection failure)
    let browser: PuppeteerBrowser;
    try {
        browser = await puppeteer.connect({
            browserWSEndpoint: launch.wsEndpoint,
            defaultViewport: options.defaultViewport ?? null,
            slowMo: options.slowMo,
        });
    } catch (connectError: any) {
        // Connection failed - browser might have crashed between detection and connection
        // Force close and retry with fresh launch
        console.log(`[browser-profiles] ⚠️ Connection failed (${connectError?.code || connectError?.message}), retrying with fresh browser...`);

        try {
            await launch.close();
        } catch {
            // Ignore close errors
        }

        // Force new launch by calling again (lock file was deleted by close())
        const freshLaunch = await profiles.launch(profile.id, {
            headless: options.headless,
            chromePath: options.chromePath,
            args: options.args,
            extensions: options.extensions,
            defaultViewport: options.defaultViewport,
            slowMo: options.slowMo,
            timeout: options.timeout,
        });

        // Update launch reference
        Object.assign(launch, freshLaunch);

        browser = await puppeteer.connect({
            browserWSEndpoint: freshLaunch.wsEndpoint,
            defaultViewport: options.defaultViewport ?? null,
            slowMo: options.slowMo,
        });
    }

    // Helper to inject fingerprint protection scripts into a page
    // IMPORTANT: Must use Puppeteer's native evaluateOnNewDocument, NOT CDP session!
    // CDP session created via page.createCDPSession() does NOT work for script injection.
    const injectProtectionScripts = async (page: PuppeteerPage) => {
        // Get fingerprint config from profile
        const fpConfig = {
            language: profile.fingerprint?.language || 'en-US',
            platform: profile.fingerprint?.platform || 'Win32',
            hardwareConcurrency: profile.fingerprint?.hardwareConcurrency || 8,
            deviceMemory: profile.fingerprint?.deviceMemory || 8,
        };

        // Inject navigator overrides using string template (avoids TypeScript browser context issues)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (page as any).evaluateOnNewDocument(`
            (function() {
                var config = ${JSON.stringify(fpConfig)};
                var nav = Object.getPrototypeOf(window.navigator);
                Object.defineProperty(nav, 'hardwareConcurrency', {
                    get: function() { return config.hardwareConcurrency; },
                    configurable: true
                });
                Object.defineProperty(nav, 'deviceMemory', {
                    get: function() { return config.deviceMemory; },
                    configurable: true
                });
                Object.defineProperty(nav, 'platform', {
                    get: function() { return config.platform; },
                    configurable: true
                });
                Object.defineProperty(nav, 'language', {
                    get: function() { return config.language; },
                    configurable: true
                });
                Object.defineProperty(nav, 'languages', {
                    get: function() { return [config.language, config.language.split('-')[0]]; },
                    configurable: true
                });
            })();
        `);

        // WebRTC protection
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (page as any).evaluateOnNewDocument(`
            (function() {
                const origRTC = window.RTCPeerConnection;
                if (origRTC) {
                    window.RTCPeerConnection = function(conf, constraints) {
                        if (conf && conf.iceServers) conf.iceCandidatePoolSize = 0;
                        const pc = new origRTC(conf, constraints);
                        const origAddListener = pc.addEventListener.bind(pc);
                        pc.addEventListener = function(type, listener, options) {
                            if (type === 'icecandidate') {
                                return origAddListener(type, function(e) {
                                    if (e.candidate && e.candidate.candidate &&
                                        (e.candidate.candidate.includes('typ host') ||
                                         e.candidate.candidate.includes('typ srflx'))) return;
                                    listener.call(this, e);
                                }, options);
                            }
                            return origAddListener(type, listener, options);
                        };
                        return pc;
                    };
                }
            })();
        `);

        // Automation detection bypass (webdriver, chrome object, plugins, etc.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (page as any).evaluateOnNewDocument(`
            (function() {
                // Remove webdriver flag
                Object.defineProperty(navigator, 'webdriver', {
                    get: function() { return undefined; },
                    configurable: true
                });
                delete Object.getPrototypeOf(navigator).webdriver;
                
                // Fix chrome object for headless detection
                if (!window.chrome) window.chrome = {};
                if (!window.chrome.runtime) window.chrome.runtime = {};
                
                // Fix chrome.csi
                if (!window.chrome.csi) {
                    window.chrome.csi = function() {
                        return { startE: Date.now(), onloadT: Date.now() + 100, pageT: Date.now() + 150, tran: 15 };
                    };
                }
                
                // Fix chrome.loadTimes
                if (!window.chrome.loadTimes) {
                    window.chrome.loadTimes = function() {
                        return {
                            commitLoadTime: Date.now() / 1000,
                            connectionInfo: "http/1.1",
                            finishDocumentLoadTime: Date.now() / 1000 + 0.1,
                            finishLoadTime: Date.now() / 1000 + 0.2,
                            firstPaintTime: Date.now() / 1000 + 0.05,
                            navigationType: "Other",
                            requestTime: Date.now() / 1000 - 0.5,
                            startLoadTime: Date.now() / 1000 - 0.3
                        };
                    };
                }
                
                // Mock permissions API
                if (navigator.permissions && navigator.permissions.query) {
                    var origQuery = navigator.permissions.query.bind(navigator.permissions);
                    navigator.permissions.query = function(params) {
                        if (params.name === 'notifications') {
                            return Promise.resolve({ state: Notification.permission });
                        }
                        return origQuery(params);
                    };
                }
                
                // Fix plugins for non-headless
                if (navigator.plugins.length === 0) {
                    Object.defineProperty(navigator, 'plugins', {
                        get: function() {
                            var plugins = [
                                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'PDF' },
                                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                            ];
                            plugins.item = function(i) { return plugins[i]; };
                            plugins.namedItem = function(n) { return plugins.find(function(p) { return p.name === n; }); };
                            plugins.refresh = function() {};
                            return plugins;
                        },
                        configurable: true
                    });
                }
                
                // Fix connection API
                if (!navigator.connection) {
                    Object.defineProperty(navigator, 'connection', {
                        get: function() {
                            return { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, type: 'wifi' };
                        },
                        configurable: true
                    });
                }
                
                // Add battery API
                if (!navigator.getBattery) {
                    navigator.getBattery = function() {
                        return Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 });
                    };
                }
            })();
        `);
    };

    // Listen for new pages and inject scripts (like puppeteer-extra-stealth's onPageCreated)
    browser.on('targetcreated', async (target: any) => {
        if (target.type() === 'page') {
            try {
                const newPage = await target.page();
                if (newPage) {
                    await injectProtectionScripts(newPage);
                }
            } catch {
                // Ignore errors for pages that can't be accessed
            }
        }
    });

    // Always create NEW page for this session (session isolation)
    // This ensures each session has its own page, even when reconnecting to existing browser
    const page = await browser.newPage();

    // Inject scripts into the new page
    await injectProtectionScripts(page);

    // Navigate to trigger the scripts
    await page.goto('data:text/html,<html><body></body></html>');

    // Close function - by default only closes this session's page
    const close = async (options?: CloseOptions) => {
        try {
            if (options?.terminate) {
                // Kill the entire browser
                browser.disconnect();
                await launch.close();
            } else {
                // Only close this session's page (browser stays running)
                await page.close().catch(() => { });
                browser.disconnect();
            }
        } catch {
            // Ignore errors
        }
    };

    // Terminate function - kills the browser entirely
    const terminate = async () => {
        await close({ terminate: true });
    };

    return {
        browser,
        page,
        profile,
        launch,
        close,
        terminate,
    };
}

/**
 * Quick launch with inline profile configuration
 *
 * @example
 * ```typescript
 * import { quickLaunch } from '@aitofy/browser-profiles/puppeteer';
 *
 * const { browser, page, close } = await quickLaunch({
 *   proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
 *   timezone: 'America/Los_Angeles',
 * });
 *
 * await page.goto('https://whatismyip.com');
 * await close();
 * ```
 */
export async function quickLaunch(options: QuickLaunchOptions = {}): Promise<WithPuppeteerResult> {
    // Use injected puppeteer or auto-detect
    const puppeteer = options.puppeteer || await getPuppeteer();

    const profiles = new BrowserProfiles({
        storagePath: options.storagePath,
    });

    // Create temporary profile
    const profileConfig: ProfileConfig = {
        name: options.name || `Quick-${Date.now()}`,
        proxy: options.proxy,
        timezone: options.timezone,
        fingerprint: options.fingerprint,
    };

    const profile = await profiles.create(profileConfig);

    // Launch browser
    const launch = await profiles.launch(profile.id, {
        headless: options.headless,
        chromePath: options.chromePath,
        args: options.args,
        extensions: options.extensions,
        defaultViewport: options.defaultViewport,
        slowMo: options.slowMo,
        timeout: options.timeout,
    });

    // Connect Puppeteer (with retry on connection failure)
    let browser: PuppeteerBrowser;
    try {
        browser = await puppeteer.connect({
            browserWSEndpoint: launch.wsEndpoint,
            defaultViewport: options.defaultViewport ?? null,
            slowMo: options.slowMo,
        });
    } catch (connectError: any) {
        console.log(`[browser-profiles] ⚠️ Connection failed (${connectError?.code || connectError?.message}), retrying with fresh browser...`);

        try {
            await launch.close();
        } catch {
            // Ignore close errors
        }

        const freshLaunch = await profiles.launch(profile.id, {
            headless: options.headless,
            chromePath: options.chromePath,
            args: options.args,
            extensions: options.extensions,
            defaultViewport: options.defaultViewport,
            slowMo: options.slowMo,
            timeout: options.timeout,
        });

        Object.assign(launch, freshLaunch);

        browser = await puppeteer.connect({
            browserWSEndpoint: freshLaunch.wsEndpoint,
            defaultViewport: options.defaultViewport ?? null,
            slowMo: options.slowMo,
        });
    }

    // Always create NEW page for this session (session isolation)
    const page = await browser.newPage();

    // Inject fingerprint protection scripts
    const fpConfig = {
        language: profile.fingerprint?.language || 'en-US',
        platform: profile.fingerprint?.platform || 'Win32',
        hardwareConcurrency: profile.fingerprint?.hardwareConcurrency || 8,
        deviceMemory: profile.fingerprint?.deviceMemory || 8,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page as any).evaluateOnNewDocument(`
        (function() {
            var config = ${JSON.stringify(fpConfig)};
            var nav = Object.getPrototypeOf(window.navigator);
            Object.defineProperty(nav, 'hardwareConcurrency', {
                get: function() { return config.hardwareConcurrency; },
                configurable: true
            });
            Object.defineProperty(nav, 'deviceMemory', {
                get: function() { return config.deviceMemory; },
                configurable: true
            });
            Object.defineProperty(nav, 'platform', {
                get: function() { return config.platform; },
                configurable: true
            });
            Object.defineProperty(nav, 'language', {
                get: function() { return config.language; },
                configurable: true
            });
            Object.defineProperty(nav, 'languages', {
                get: function() { return [config.language, config.language.split('-')[0]]; },
                configurable: true
            });
        })();
    `);

    // Automation detection bypass
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page as any).evaluateOnNewDocument(`
        (function() {
            Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; }, configurable: true });
            delete Object.getPrototypeOf(navigator).webdriver;
            if (!window.chrome) window.chrome = {};
            if (!window.chrome.runtime) window.chrome.runtime = {};
            if (!window.chrome.csi) window.chrome.csi = function() { return { startE: Date.now(), onloadT: Date.now() + 100 }; };
            if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { return { commitLoadTime: Date.now() / 1000 }; };
            if (navigator.plugins.length === 0) {
                Object.defineProperty(navigator, 'plugins', {
                    get: function() {
                        var p = [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }];
                        p.item = function(i) { return p[i]; };
                        p.namedItem = function(n) { return p.find(function(x) { return x.name === n; }); };
                        p.refresh = function() {};
                        return p;
                    }, configurable: true
                });
            }
            if (!navigator.connection) {
                Object.defineProperty(navigator, 'connection', {
                    get: function() { return { effectiveType: '4g', rtt: 50, downlink: 10 }; },
                    configurable: true
                });
            }
            if (!navigator.getBattery) {
                navigator.getBattery = function() {
                    return Promise.resolve({ charging: true, level: 1 });
                };
            }
        })();
    `);

    // Navigate to trigger the scripts
    await page.goto('data:text/html,<html><body></body></html>');

    // Close function - by default only closes this session's page
    const close = async (closeOptions?: CloseOptions) => {
        try {
            if (closeOptions?.terminate) {
                // Kill the entire browser
                browser.disconnect();
                await launch.close();

                // Delete temporary profile if it was auto-generated
                if (!options.name) {
                    await profiles.delete(profile.id);
                }
            } else {
                // Only close this session's page (browser stays running)
                await page.close().catch(() => { });
                browser.disconnect();
            }
        } catch {
            // Ignore errors
        }
    };

    // Terminate function - kills the browser entirely
    const terminate = async () => {
        await close({ terminate: true });
    };

    return {
        browser,
        page,
        profile,
        launch,
        close,
        terminate,
    };
}

/**
 * Connect Puppeteer to an existing browser via WebSocket endpoint
 */
export async function connectPuppeteer(wsEndpoint: string, options?: {
    defaultViewport?: { width: number; height: number } | null;
    slowMo?: number;
    puppeteer?: any;
}): Promise<{ browser: PuppeteerBrowser; page: PuppeteerPage }> {
    const puppeteer = options?.puppeteer || await getPuppeteer();

    const browser: PuppeteerBrowser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: options?.defaultViewport ?? null,
        slowMo: options?.slowMo,
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    return { browser, page };
}

/**
 * Options for patchPage
 */
export interface PatchPageOptions {
    /**
     * Hide navigator.webdriver flag
     * @default true
     */
    webdriver?: boolean;

    /**
     * Override navigator languages
     * @example ['en-US', 'en']
     */
    languages?: string[];

    /**
     * Spoof navigator plugins (PDF, NativeClient, etc.)
     * @default true
     */
    plugins?: boolean;

    /**
     * Add WebGL noise for fingerprint protection
     * @default true
     */
    webgl?: boolean;

    /**
     * Add WebRTC leak protection
     * @default true
     */
    webrtc?: boolean;

    /**
     * Spoof chrome object (csi, loadTimes, runtime)
     * @default true
     */
    chrome?: boolean;

    /**
     * Fingerprint configuration
     */
    fingerprint?: {
        language?: string;
        platform?: string;
        hardwareConcurrency?: number;
        deviceMemory?: number;
    };
}

/**
 * Apply anti-detect patches to an existing Puppeteer page
 * 
 * Use this when you have a page from an external source (e.g., browser pool,
 * third-party launcher) and want to apply fingerprint protections.
 * 
 * @example
 * ```typescript
 * import { patchPage } from '@aitofy/browser-profiles/puppeteer';
 * import puppeteer from 'puppeteer';
 * 
 * const browser = await puppeteer.launch();
 * const page = await browser.newPage();
 * 
 * // Apply anti-detect patches
 * await patchPage(page, {
 *   webdriver: true,
 *   plugins: true,
 *   chrome: true,
 *   fingerprint: {
 *     platform: 'Win32',
 *     hardwareConcurrency: 8,
 *   },
 * });
 * 
 * await page.goto('https://browserscan.net');
 * ```
 */
export async function patchPage(page: PuppeteerPage, options: PatchPageOptions = {}): Promise<void> {
    const {
        webdriver = true,
        plugins = true,
        webrtc = true,
        chrome = true,
        fingerprint = {},
    } = options;

    const fpConfig = {
        language: fingerprint.language || options.languages?.[0] || 'en-US',
        platform: fingerprint.platform || 'Win32',
        hardwareConcurrency: fingerprint.hardwareConcurrency || 8,
        deviceMemory: fingerprint.deviceMemory || 8,
        languages: options.languages || [fingerprint.language || 'en-US', (fingerprint.language || 'en-US').split('-')[0]],
    };

    // Navigator overrides (always applied if fingerprint is provided)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (page as any).evaluateOnNewDocument(`
        (function() {
            var config = ${JSON.stringify(fpConfig)};
            var nav = Object.getPrototypeOf(window.navigator);
            Object.defineProperty(nav, 'hardwareConcurrency', {
                get: function() { return config.hardwareConcurrency; },
                configurable: true
            });
            Object.defineProperty(nav, 'deviceMemory', {
                get: function() { return config.deviceMemory; },
                configurable: true
            });
            Object.defineProperty(nav, 'platform', {
                get: function() { return config.platform; },
                configurable: true
            });
            Object.defineProperty(nav, 'language', {
                get: function() { return config.language; },
                configurable: true
            });
            Object.defineProperty(nav, 'languages', {
                get: function() { return config.languages; },
                configurable: true
            });
        })();
    `);

    // WebRTC protection
    if (webrtc) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (page as any).evaluateOnNewDocument(`
            (function() {
                const origRTC = window.RTCPeerConnection;
                if (origRTC) {
                    window.RTCPeerConnection = function(conf, constraints) {
                        if (conf && conf.iceServers) conf.iceCandidatePoolSize = 0;
                        const pc = new origRTC(conf, constraints);
                        const origAddListener = pc.addEventListener.bind(pc);
                        pc.addEventListener = function(type, listener, options) {
                            if (type === 'icecandidate') {
                                return origAddListener(type, function(e) {
                                    if (e.candidate && e.candidate.candidate &&
                                        (e.candidate.candidate.includes('typ host') ||
                                         e.candidate.candidate.includes('typ srflx'))) return;
                                    listener.call(this, e);
                                }, options);
                            }
                            return origAddListener(type, listener, options);
                        };
                        return pc;
                    };
                }
            })();
        `);
    }

    // Automation detection bypass
    if (webdriver || chrome || plugins) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (page as any).evaluateOnNewDocument(`
            (function() {
                ${webdriver ? `
                // Remove webdriver flag
                Object.defineProperty(navigator, 'webdriver', {
                    get: function() { return undefined; },
                    configurable: true
                });
                delete Object.getPrototypeOf(navigator).webdriver;
                ` : ''}
                
                ${chrome ? `
                // Fix chrome object for headless detection
                if (!window.chrome) window.chrome = {};
                if (!window.chrome.runtime) window.chrome.runtime = {};
                
                // Fix chrome.csi
                if (!window.chrome.csi) {
                    window.chrome.csi = function() {
                        return { startE: Date.now(), onloadT: Date.now() + 100, pageT: Date.now() + 150, tran: 15 };
                    };
                }
                
                // Fix chrome.loadTimes
                if (!window.chrome.loadTimes) {
                    window.chrome.loadTimes = function() {
                        return {
                            commitLoadTime: Date.now() / 1000,
                            connectionInfo: "http/1.1",
                            finishDocumentLoadTime: Date.now() / 1000 + 0.1,
                            finishLoadTime: Date.now() / 1000 + 0.2,
                            firstPaintTime: Date.now() / 1000 + 0.05,
                            navigationType: "Other",
                            requestTime: Date.now() / 1000 - 0.5,
                            startLoadTime: Date.now() / 1000 - 0.3
                        };
                    };
                }
                
                // Mock permissions API
                if (navigator.permissions && navigator.permissions.query) {
                    var origQuery = navigator.permissions.query.bind(navigator.permissions);
                    navigator.permissions.query = function(params) {
                        if (params.name === 'notifications') {
                            return Promise.resolve({ state: Notification.permission });
                        }
                        return origQuery(params);
                    };
                }
                ` : ''}
                
                ${plugins ? `
                // Fix plugins for non-headless
                if (navigator.plugins.length === 0) {
                    Object.defineProperty(navigator, 'plugins', {
                        get: function() {
                            var plugins = [
                                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'PDF' },
                                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                                { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                            ];
                            plugins.item = function(i) { return plugins[i]; };
                            plugins.namedItem = function(n) { return plugins.find(function(p) { return p.name === n; }); };
                            plugins.refresh = function() {};
                            return plugins;
                        },
                        configurable: true
                    });
                }
                ` : ''}
                
                // Fix connection API
                if (!navigator.connection) {
                    Object.defineProperty(navigator, 'connection', {
                        get: function() {
                            return { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, type: 'wifi' };
                        },
                        configurable: true
                    });
                }
                
                // Add battery API
                if (!navigator.getBattery) {
                    navigator.getBattery = function() {
                        return Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1 });
                    };
                }
            })();
        `);
    }

    console.log('[browser-profiles] Page patched with anti-detect protections');
}

/**
 * Options for createSession
 */
export interface CreateSessionOptions {
    /**
     * If true, creates a temporary session without persistent storage
     * @default true
     */
    temporary?: boolean;

    /**
     * Generate random fingerprint
     * @default true
     */
    randomFingerprint?: boolean;

    /**
     * Proxy configuration
     */
    proxy?: ProxyConfig;

    /**
     * Timezone to use (auto-detected from proxy if not specified)
     */
    timezone?: string;

    /**
     * Custom fingerprint configuration
     */
    fingerprint?: {
        language?: string;
        platform?: string;
        hardwareConcurrency?: number;
        deviceMemory?: number;
        userAgent?: string;
    };

    /**
     * Run in headless mode
     * @default false
     */
    headless?: boolean;

    /**
     * Custom Chrome path
     */
    chromePath?: string;

    /**
     * Additional Chrome arguments
     */
    args?: string[];

    /**
     * Puppeteer instance to use (optional)
     */
    puppeteer?: any;
}

/**
 * Result from createSession
 */
export interface SessionResult {
    /**
     * Puppeteer browser instance
     */
    browser: PuppeteerBrowser;

    /**
     * Ready-to-use page with anti-detect protections
     */
    page: PuppeteerPage;

    /**
     * Session info
     */
    session: {
        id: string;
        temporary: boolean;
        createdAt: Date;
    };

    /**
     * Close this session's page only (browser stays running for other sessions).
     * Use `terminate()` to kill the browser entirely.
     * @param options - Optional close options
     */
    close: (options?: { terminate?: boolean }) => Promise<void>;

    /**
     * Kill the browser process entirely.
     * Shorthand for `close({ terminate: true })`
     */
    terminate: () => Promise<void>;
}

/**
 * Create a lightweight browser session without persistent profile management
 * 
 * Perfect for:
 * - Quick scraping tasks
 * - Testing and development
 * - One-off automation tasks
 * - When you don't need session persistence
 * 
 * @example
 * ```typescript
 * import { createSession } from '@aitofy/browser-profiles/puppeteer';
 * 
 * // Quick session with random fingerprint
 * const session = await createSession({
 *   temporary: true,
 *   proxy: { type: 'http', host: 'proxy.com', port: 8080 },
 * });
 * 
 * await session.page.goto('https://example.com');
 * const data = await session.page.evaluate(() => document.title);
 * 
 * await session.close(); // Cleanup
 * ```
 * 
 * @example With custom fingerprint
 * ```typescript
 * const session = await createSession({
 *   fingerprint: {
 *     platform: 'MacIntel',
 *     language: 'ja-JP',
 *     hardwareConcurrency: 16,
 *   },
 * });
 * ```
 */
export async function createSession(options: CreateSessionOptions = {}): Promise<SessionResult> {
    const {
        temporary = true,
        randomFingerprint = true,
        proxy,
        timezone,
        fingerprint = {},
        headless = false,
        chromePath,
        args = [],
        puppeteer: injectedPuppeteer,
    } = options;

    const puppeteer = injectedPuppeteer || await getPuppeteer();

    // Generate session ID
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Generate random fingerprint if requested
    const platforms = ['Win32', 'MacIntel', 'Linux x86_64'];
    const languages = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'ko-KR', 'zh-CN'];
    const cores = [4, 8, 12, 16];
    const memories = [4, 8, 16, 32];

    const fpConfig = {
        language: fingerprint.language || (randomFingerprint ? languages[Math.floor(Math.random() * languages.length)] : 'en-US'),
        platform: fingerprint.platform || (randomFingerprint ? platforms[Math.floor(Math.random() * platforms.length)] : 'Win32'),
        hardwareConcurrency: fingerprint.hardwareConcurrency || (randomFingerprint ? cores[Math.floor(Math.random() * cores.length)] : 8),
        deviceMemory: fingerprint.deviceMemory || (randomFingerprint ? memories[Math.floor(Math.random() * memories.length)] : 8),
    };

    // Build Chrome args
    const chromeArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        ...args,
    ];

    if (proxy) {
        const proxyUrl = `${proxy.type}://${proxy.host}:${proxy.port}`;
        chromeArgs.push(`--proxy-server=${proxyUrl}`);
    }

    // Create temporary user data dir if needed
    const userDataDir = temporary ? undefined : undefined; // TODO: implement persistent session storage

    // Launch browser
    const browser: PuppeteerBrowser = await puppeteer.launch({
        headless,
        executablePath: chromePath,
        args: chromeArgs,
        userDataDir,
        defaultViewport: null,
    });

    // Always create NEW page for this session (session isolation)
    const page = await browser.newPage();

    // Apply anti-detect patches
    await patchPage(page, {
        webdriver: true,
        plugins: true,
        chrome: true,
        webrtc: true,
        fingerprint: fpConfig,
    });

    // Handle proxy authentication if needed
    if (proxy?.username && proxy?.password) {
        await page.authenticate({
            username: proxy.username,
            password: proxy.password,
        });
    }

    // Set timezone if provided
    if (timezone) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = await (page as any).createCDPSession?.() || await browser.target().createCDPSession();
        await client.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
    }

    // Navigate to trigger the scripts
    await page.goto('data:text/html,<html><body></body></html>');

    const session = {
        id: sessionId,
        temporary,
        createdAt: new Date(),
    };

    console.log(`[browser-profiles] Session created: ${sessionId} (${temporary ? 'temporary' : 'persistent'})`);

    // Close function - by default only closes this session's page
    const close = async (closeOptions?: { terminate?: boolean }) => {
        try {
            if (closeOptions?.terminate) {
                // Kill the entire browser
                await browser.close();
                console.log(`[browser-profiles] Session terminated: ${sessionId}`);
            } else {
                // Only close this session's page
                await page.close().catch(() => { });
                console.log(`[browser-profiles] Session page closed: ${sessionId}`);
            }
        } catch {
            // Ignore close errors
        }
    };

    // Terminate function - kills the browser entirely
    const terminate = async () => {
        await close({ terminate: true });
    };

    return {
        browser,
        page,
        session,
        close,
        terminate,
    };
}
