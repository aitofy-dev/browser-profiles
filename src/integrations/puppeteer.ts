// ============================================================================
// @aitofy/browser-profiles - Puppeteer Integration
// ============================================================================

import type { StoredProfile, LaunchOptions, LaunchResult, ProxyConfig, ProfileConfig } from '../types';
import { BrowserProfiles } from '../profile-manager';

/**
 * Type for Puppeteer Browser (to avoid hard dependency)
 */
interface PuppeteerBrowser {
    newPage(): Promise<PuppeteerPage>;
    close(): Promise<void>;
    disconnect(): void;
    pages(): Promise<PuppeteerPage[]>;
    wsEndpoint(): string;
    on(event: string, callback: (...args: any[]) => void): void;
    target(): { createCDPSession(): Promise<any> };
}

interface PuppeteerPage {
    goto(url: string, options?: any): Promise<any>;
    close(): Promise<void>;
    evaluate<T>(fn: () => T): Promise<T>;
    evaluateOnNewDocument(fn: (...args: any[]) => void, ...args: any[]): Promise<void>;
    setViewport(viewport: { width: number; height: number }): Promise<void>;
    screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
    target(): { url(): string };
}

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
     * Cleanup function - closes browser and proxy
     */
    close: () => Promise<void>;
}

/**
 * Get Puppeteer dynamically
 * Priority: rebrowser-puppeteer-core > puppeteer-core > puppeteer
 */
async function getPuppeteer(): Promise<any> {
    // Use require to avoid TypeScript issues with optional peer dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    try {
        // Try rebrowser first (better anti-detect bypass!)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const rebrowser = require('rebrowser-puppeteer-core');
        console.log('[browser-profiles] Using rebrowser-puppeteer-core (enhanced anti-detect)');
        return rebrowser;
    } catch {
        try {
            // Fall back to puppeteer-core
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const puppeteer = require('puppeteer-core');
            console.log('[browser-profiles] Using puppeteer-core');
            return puppeteer;
        } catch {
            try {
                // Fall back to full puppeteer
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const puppeteer = require('puppeteer');
                console.log('[browser-profiles] Using puppeteer');
                return puppeteer;
            } catch {
                throw new Error(
                    'Puppeteer not found. Please install one of the following:\\n' +
                    '  npm install rebrowser-puppeteer-core  (recommended for anti-detect)\\n' +
                    '  npm install puppeteer-core\\n' +
                    '  npm install puppeteer'
                );
            }
        }
    }
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
    const puppeteer = await getPuppeteer();

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

    // Connect Puppeteer
    const browser: PuppeteerBrowser = await puppeteer.connect({
        browserWSEndpoint: launch.wsEndpoint,
        defaultViewport: options.defaultViewport ?? null,
        slowMo: options.slowMo,
    });

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

    // Always create NEW page - existing pages don't receive evaluateOnNewDocument scripts properly
    // when connecting to an existing browser via puppeteer.connect()
    const page = await browser.newPage();

    // Inject scripts into the new page
    await injectProtectionScripts(page);

    // Navigate to trigger the scripts
    await page.goto('data:text/html,<html><body></body></html>');

    // Cleanup function
    const close = async () => {
        try {
            browser.disconnect();
        } catch {
            // Ignore disconnect errors
        }
        await launch.close();
    };

    return {
        browser,
        page,
        profile,
        launch,
        close,
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
    const puppeteer = await getPuppeteer();

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

    // Connect Puppeteer
    const browser: PuppeteerBrowser = await puppeteer.connect({
        browserWSEndpoint: launch.wsEndpoint,
        defaultViewport: options.defaultViewport ?? null,
        slowMo: options.slowMo,
    });

    // Create NEW page (existing pages don't get evaluateOnNewDocument scripts)
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

    // Cleanup function (also deletes temporary profile)
    const close = async () => {
        try {
            browser.disconnect();
        } catch {
            // Ignore disconnect errors
        }
        await launch.close();

        // Delete temporary profile if it was auto-generated
        if (!options.name) {
            await profiles.delete(profile.id);
        }
    };

    return {
        browser,
        page,
        profile,
        launch,
        close,
    };
}

/**
 * Connect Puppeteer to an existing browser via WebSocket endpoint
 */
export async function connectPuppeteer(wsEndpoint: string, options?: {
    defaultViewport?: { width: number; height: number } | null;
    slowMo?: number;
}): Promise<{ browser: PuppeteerBrowser; page: PuppeteerPage }> {
    const puppeteer = await getPuppeteer();

    const browser: PuppeteerBrowser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: options?.defaultViewport ?? null,
        slowMo: options?.slowMo,
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    return { browser, page };
}
