// ============================================================================
// @aitofy/browser-profiles - Playwright Integration
// ============================================================================

import type { StoredProfile, LaunchOptions, LaunchResult, ProxyConfig, ProfileConfig } from '../types';
import { BrowserProfiles } from '../profile-manager';

// ============================================================================
// NATIVE TYPE RE-EXPORTS
// These provide FULL Playwright API access (route, on('request'), reload, etc.)
// ============================================================================

/**
 * Re-export native Playwright Page type for full API access
 * This includes ALL Playwright Page methods:
 * - route() for request interception
 * - on('request', callback)
 * - reload()
 * - waitForTimeout()
 * - screenshot()
 * - And many more...
 */
export type { Page as PlaywrightPage } from 'playwright';

/**
 * Re-export native Playwright Browser type for full API access
 */
export type { Browser as PlaywrightBrowser } from 'playwright';

/**
 * Re-export native Playwright BrowserContext type
 */
export type { BrowserContext as PlaywrightContext } from 'playwright';

/**
 * Re-export commonly used Playwright types
 */
export type { Request as PlaywrightRequest, Response as PlaywrightResponse, Route } from 'playwright';

// Import types for internal use
import type {
    Page as PlaywrightPageType,
    Browser as PlaywrightBrowserType,
    BrowserContext as PlaywrightContextType
} from 'playwright';

// Create internal aliases (used throughout this file)
type PlaywrightBrowser = PlaywrightBrowserType;
type PlaywrightContext = PlaywrightContextType;
type PlaywrightPage = PlaywrightPageType;

/**
 * Options for withPlaywright
 */
export interface WithPlaywrightOptions extends LaunchOptions {
    /**
     * Profile ID or name to launch
     */
    profile: string;

    /**
     * BrowserProfiles instance (optional)
     */
    profiles?: BrowserProfiles;

    /**
     * Storage path for profiles
     */
    storagePath?: string;

    /**
     * Create new context for isolation
     */
    newContext?: boolean;
}

/**
 * Options for quick launch
 */
export interface QuickLaunchPlaywrightOptions extends LaunchOptions {
    name?: string;
    proxy?: ProxyConfig;
    timezone?: string;
    storagePath?: string;
    newContext?: boolean;
}

/**
 * Result from withPlaywright
 */
export interface WithPlaywrightResult {
    browser: PlaywrightBrowser;
    context: PlaywrightContext;
    page: PlaywrightPage;
    profile: StoredProfile;
    launch: LaunchResult;
    close: () => Promise<void>;
}

/**
 * Get Playwright dynamically
 */
async function getPlaywright(): Promise<any> {
    // Use require to avoid TypeScript issues with optional peer dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('playwright');
    } catch {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require('playwright-core');
        } catch {
            throw new Error(
                'Playwright not found. Please install playwright:\n' +
                '  npm install playwright\n' +
                '  npx playwright install chromium'
            );
        }
    }
}

/**
 * Launch a browser profile and connect with Playwright
 *
 * @example
 * ```typescript
 * import { withPlaywright } from '@aitofy/browser-profiles/playwright';
 *
 * const { browser, page, close } = await withPlaywright({
 *   profile: 'my-profile-id',
 * });
 *
 * await page.goto('https://example.com');
 * await close();
 * ```
 */
export async function withPlaywright(options: WithPlaywrightOptions): Promise<WithPlaywrightResult> {
    const playwright = await getPlaywright();

    // Get or create BrowserProfiles instance
    const profiles = options.profiles || new BrowserProfiles({
        storagePath: options.storagePath,
    });

    // Find profile
    let profile = await profiles.get(options.profile);

    if (!profile) {
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

    // Connect Playwright via CDP
    const browser: PlaywrightBrowser = await playwright.chromium.connectOverCDP(launch.wsEndpoint);

    // Get or create context and page
    let context: PlaywrightContext;
    let page: PlaywrightPage;

    if (options.newContext) {
        context = await browser.newContext({
            locale: profile.fingerprint?.language?.split('-')[0] || 'en',
            timezoneId: profile.timezone || 'America/New_York',
            viewport: options.defaultViewport || null,
        });
        page = await context.newPage();
    } else {
        const contexts = browser.contexts();
        context = contexts.length > 0 ? contexts[0] : await browser.newContext();
        const pages = context.pages();
        page = pages.length > 0 ? pages[0] : await context.newPage();
    }

    // Cleanup function
    const close = async () => {
        try {
            await context.close();
        } catch {
            // Ignore errors
        }
        await launch.close();
    };

    return {
        browser,
        context,
        page,
        profile,
        launch,
        close,
    };
}

/**
 * Quick launch with inline configuration
 */
export async function quickLaunchPlaywright(options: QuickLaunchPlaywrightOptions = {}): Promise<WithPlaywrightResult> {
    const playwright = await getPlaywright();

    const profiles = new BrowserProfiles({
        storagePath: options.storagePath,
    });

    const profileConfig: ProfileConfig = {
        name: options.name || `PW-Quick-${Date.now()}`,
        proxy: options.proxy,
        timezone: options.timezone,
    };

    const profile = await profiles.create(profileConfig);

    const launch = await profiles.launch(profile.id, {
        headless: options.headless,
        chromePath: options.chromePath,
        args: options.args,
        extensions: options.extensions,
        defaultViewport: options.defaultViewport,
        slowMo: options.slowMo,
        timeout: options.timeout,
    });

    const browser: PlaywrightBrowser = await playwright.chromium.connectOverCDP(launch.wsEndpoint);

    let context: PlaywrightContext;
    let page: PlaywrightPage;

    if (options.newContext) {
        context = await browser.newContext({
            locale: 'en',
            timezoneId: options.timezone || 'America/New_York',
            viewport: options.defaultViewport || null,
        });
        page = await context.newPage();
    } else {
        const contexts = browser.contexts();
        context = contexts.length > 0 ? contexts[0] : await browser.newContext();
        const pages = context.pages();
        page = pages.length > 0 ? pages[0] : await context.newPage();
    }

    const close = async () => {
        try {
            await context.close();
        } catch {
            // Ignore
        }
        await launch.close();

        if (!options.name) {
            await profiles.delete(profile.id);
        }
    };

    return {
        browser,
        context,
        page,
        profile,
        launch,
        close,
    };
}

/**
 * Connect Playwright to existing browser
 */
export async function connectPlaywright(wsEndpoint: string, options?: {
    newContext?: boolean;
    timezone?: string;
    locale?: string;
}): Promise<{ browser: PlaywrightBrowser; context: PlaywrightContext; page: PlaywrightPage }> {
    const playwright = await getPlaywright();

    const browser: PlaywrightBrowser = await playwright.chromium.connectOverCDP(wsEndpoint);

    let context: PlaywrightContext;
    let page: PlaywrightPage;

    if (options?.newContext) {
        context = await browser.newContext({
            locale: options.locale || 'en',
            timezoneId: options.timezone || 'America/New_York',
        });
        page = await context.newPage();
    } else {
        const contexts = browser.contexts();
        context = contexts.length > 0 ? contexts[0] : await browser.newContext();
        const pages = context.pages();
        page = pages.length > 0 ? pages[0] : await context.newPage();
    }

    return { browser, context, page };
}
