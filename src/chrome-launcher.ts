// ============================================================================
// @aitofy/browser-profiles - Chrome Launcher with Anti-Detect Features
// ============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { StoredProfile, LaunchResult, LaunchOptions, ProxyConfig } from './types';
import { getAllProtectionScripts } from './fingerprint';

// Dynamic imports to handle ESM/CJS
let chromeLauncher: typeof import('chrome-launcher');
let CDP: any;
let proxyChain: typeof import('proxy-chain');

async function loadDependencies() {
    if (!chromeLauncher) {
        chromeLauncher = await import('chrome-launcher');
    }
    if (!CDP) {
        const cdpModule = await import('chrome-remote-interface');
        // Handle both ESM default export and CJS module.exports
        CDP = (cdpModule as any).default || cdpModule;
    }
    if (!proxyChain) {
        proxyChain = await import('proxy-chain');
    }
}

/**
 * Global tracking of browser processes and proxy servers
 */
const runningBrowsers: Map<string, { process: any; proxyUrl?: string }> = new Map();

/**
 * Lock file info stored in profile directory
 */
interface BrowserLockInfo {
    pid: number;
    port: number;
    wsEndpoint: string;
    startedAt: number;
    proxyUrl?: string;
}

/**
 * Write lock file to track running browser
 */
function writeLockFile(userDataDir: string, info: BrowserLockInfo): void {
    const lockPath = path.join(userDataDir, '.browser-lock.json');
    try {
        fs.writeFileSync(lockPath, JSON.stringify(info, null, 2));
    } catch {
        // Ignore write errors
    }
}

/**
 * Read lock file from profile directory
 */
function readLockFile(userDataDir: string): BrowserLockInfo | null {
    const lockPath = path.join(userDataDir, '.browser-lock.json');
    try {
        if (fs.existsSync(lockPath)) {
            const content = fs.readFileSync(lockPath, 'utf-8');
            return JSON.parse(content) as BrowserLockInfo;
        }
    } catch {
        // Ignore read errors
    }
    return null;
}

/**
 * Delete lock file
 */
function deleteLockFile(userDataDir: string): void {
    const lockPath = path.join(userDataDir, '.browser-lock.json');
    try {
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
        }
    } catch {
        // Ignore delete errors
    }
}

/**
 * Check if a process is still running by PID
 */
function isProcessRunning(pid: number): boolean {
    try {
        // Sending signal 0 doesn't kill the process, just checks if it exists
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Try to connect to an existing browser and verify it's responsive
 */
async function tryConnectExisting(lockInfo: BrowserLockInfo): Promise<{
    wsEndpoint: string;
    pid: number;
    port: number;
} | null> {
    // Try to fetch browser info to verify it's responsive
    // Note: Don't trust PID check alone - OS can reuse PIDs
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(`http://localhost:${lockInfo.port}/json/version`, {
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log(`[browser-profiles] Browser at port ${lockInfo.port} returned status ${response.status}`);
            return null;
        }

        const data = await response.json() as { webSocketDebuggerUrl: string };

        if (!data.webSocketDebuggerUrl) {
            console.log(`[browser-profiles] Browser at port ${lockInfo.port} has no wsEndpoint`);
            return null;
        }

        // Return the current wsEndpoint (might be different from lock file if browser restarted)
        return {
            wsEndpoint: data.webSocketDebuggerUrl,
            pid: lockInfo.pid,
            port: lockInfo.port,
        };
    } catch (error: any) {
        // ECONNREFUSED, timeout, or any other error means browser is not running
        if (error?.code === 'ECONNREFUSED' || error?.name === 'AbortError') {
            // Expected - browser is not running
        } else {
            console.log(`[browser-profiles] Error checking browser at port ${lockInfo.port}:`, error?.message || error);
        }
        return null;
    }
}

/**
 * Get Chrome/Chromium executable path
 */
export function getChromePath(customPath?: string): string {
    // 1) Explicit override
    if (customPath && fs.existsSync(customPath)) {
        return customPath;
    }

    // 2) Environment variables
    const envPath = process.env.CHROMIUM_PATH || process.env.CHROME_PATH;
    if (envPath && fs.existsSync(envPath)) {
        return envPath;
    }

    // 3) Platform-specific defaults
    const platform = os.platform();

    if (platform === 'darwin') {
        const macPaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        ];
        for (const p of macPaths) {
            if (fs.existsSync(p)) return p;
        }
    }

    if (platform === 'win32') {
        const winPaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
        ];
        for (const p of winPaths) {
            if (fs.existsSync(p)) return p;
        }
    }

    if (platform === 'linux') {
        const linuxPaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
        ];
        for (const p of linuxPaths) {
            if (fs.existsSync(p)) return p;
        }
    }

    throw new Error(
        'Chrome/Chromium not found. Please install Chrome or set CHROME_PATH environment variable.'
    );
}

/**
 * Build proxy authentication URL from config
 */
export function buildProxyUrl(proxy: ProxyConfig): string {
    const { type, host, port, username, password } = proxy;
    const protocol = type === 'socks5' ? 'socks5' : 'http';

    if (username && password) {
        return `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    }

    return `${protocol}://${host}:${port}`;
}

/**
 * Detect timezone from IP address using free GeoIP API
 * @param ip - IP address to lookup
 * @returns Geo info or null if failed
 */
export async function detectTimezoneFromIP(ip: string): Promise<{
    timezone: string;
    country: string;
    city: string;
    region: string;
} | null> {
    try {
        // Use ip-api.com (free, no API key required, 45 requests/minute)
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,timezone`);
        const data = await response.json() as {
            status: string;
            country: string;
            regionName: string;
            city: string;
            timezone: string;
        };

        if (data.status === 'success') {
            return {
                timezone: data.timezone,
                country: data.country,
                city: data.city,
                region: data.regionName,
            };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Auto-detect and set timezone based on proxy IP
 * @param proxy - Proxy configuration
 * @returns Timezone string or default
 */
export async function autoDetectTimezone(proxy: ProxyConfig): Promise<string> {
    const geoInfo = await detectTimezoneFromIP(proxy.host);
    if (geoInfo) {
        console.log(`🌍 Detected location: ${geoInfo.city}, ${geoInfo.country} (${geoInfo.timezone})`);
        return geoInfo.timezone;
    }
    return 'America/New_York'; // Default fallback
}

/**
 * Options for launchChrome function
 */
interface ChromeLaunchOptions extends LaunchOptions {
    profile: StoredProfile;
    userDataDir: string;
}

/**
 * Launch Chrome with anti-detect features
 */
export async function launchChrome(options: ChromeLaunchOptions): Promise<LaunchResult> {
    await loadDependencies();

    const { profile, userDataDir, headless = false, chromePath, args = [], extensions = [] } = options;

    // ===== CHECK FOR EXISTING BROWSER SESSION =====
    // Check if browser is already running for this profile (across processes)
    const lockInfo = readLockFile(userDataDir);
    if (lockInfo) {
        const existing = await tryConnectExisting(lockInfo);
        if (existing) {
            console.log(`[browser-profiles] ♻️ Found existing browser for profile "${profile.name}" (PID: ${existing.pid}, Port: ${existing.port})`);

            // Create a close function that properly cleans up
            const close = async () => {
                try {
                    if (isProcessRunning(existing.pid)) {
                        process.kill(existing.pid, 'SIGTERM');
                    }
                    deleteLockFile(userDataDir);
                    runningBrowsers.delete(profile.id);

                    // Also close proxy if stored in lock
                    if (lockInfo.proxyUrl) {
                        await proxyChain.closeAnonymizedProxy(lockInfo.proxyUrl, true).catch(() => { });
                    }
                } catch (error) {
                    console.error('Error closing browser:', error);
                }
            };

            return {
                wsEndpoint: existing.wsEndpoint,
                pid: existing.pid,
                port: existing.port,
                profileId: profile.id,
                close,
            };
        } else {
            // Lock file exists but browser not running - clean up stale lock
            console.log(`[browser-profiles] 🧹 Cleaning up stale lock file for profile "${profile.name}"`);
            deleteLockFile(userDataDir);
        }
    }

    // Clean up stale Chrome lock files that prevent launch
    // These files are created by Chrome and left behind if Chrome crashes
    const staleFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const file of staleFiles) {
        const filePath = path.join(userDataDir, file);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`[browser-profiles] 🧹 Cleaned up stale ${file}`);
            } catch {
                // Ignore errors - file might be in use
            }
        }
    }

    // Get Chrome path
    const executablePath = getChromePath(chromePath);

    // Build Chrome flags
    const chromeFlags: string[] = [
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
        `--lang=${profile.fingerprint?.language || 'en-US'}`,

        // ===== ANTI-AUTOMATION DETECTION FLAGS =====
        // Disable automation-controlled flag
        '--disable-blink-features=AutomationControlled',
        // Remove "Chrome is being controlled by automated test software" infobar
        '--disable-infobars',
        // Disable extensions that might reveal automation
        '--disable-extensions-file-access-check',
        // Use a real-looking user agent
        '--enable-features=NetworkService,NetworkServiceInProcess',
        // Disable features that might reveal headless
        '--disable-features=IsolateOrigins,site-per-process',

        // WebRTC leak protection
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--force-webrtc-ip-handling-policy',

        // User data
        ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),

        // Additional args
        ...args,
    ];

    // Headless mode
    if (headless) {
        chromeFlags.push('--headless=new', '--mute-audio', '--hide-scrollbars');
    }

    // Setup proxy
    let anonymizedProxyUrl: string | undefined;
    if (profile.proxy) {
        const proxyUrl = buildProxyUrl(profile.proxy);

        try {
            // Use proxy-chain to handle authenticated proxies
            anonymizedProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
            chromeFlags.push(`--proxy-server=${anonymizedProxyUrl}`);
        } catch (error) {
            console.error('Proxy setup failed:', error);
            throw new Error(`Failed to configure proxy: ${(error as Error).message}`);
        }
    }

    // Load extensions
    if (!headless && extensions.length > 0) {
        const validExtensions = extensions.filter((ext) => {
            // Check if it's a valid path with manifest.json
            if (fs.existsSync(ext) && fs.existsSync(path.join(ext, 'manifest.json'))) {
                return true;
            }
            return false;
        });

        if (validExtensions.length > 0) {
            const extPaths = validExtensions.join(',');
            chromeFlags.push(`--disable-extensions-except=${extPaths}`);
            chromeFlags.push(`--load-extension=${extPaths}`);
        }
    }

    // Launch Chrome
    let chromeProcess: any;

    // Auto-detect timezone if not specified
    let timezone = profile.timezone;
    if (!timezone) {
        if (profile.proxy) {
            // Auto-detect from proxy IP
            const geoInfo = await detectTimezoneFromIP(profile.proxy.host);
            if (geoInfo) {
                timezone = geoInfo.timezone;
                console.log(`[browser-profiles] 🌍 Auto-detected timezone: ${timezone} (${geoInfo.city}, ${geoInfo.country})`);
            }
        }
        // Fall back to system timezone
        if (!timezone) {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            console.log(`[browser-profiles] 🌍 Using system timezone: ${timezone}`);
        }
    }

    console.log(`[browser-profiles] 🚀 Launching Chrome with executablePath: ${executablePath}`);
    console.log(`[browser-profiles] 📁 User data dir: ${userDataDir}`);

    try {
        chromeProcess = await chromeLauncher.launch({
            chromePath: executablePath,
            chromeFlags,
            userDataDir,
            ignoreDefaultFlags: true,
            envVars: {
                TZ: timezone,
            },
        });
        console.log(`[browser-profiles] ✅ Chrome process started, port: ${chromeProcess.port}, pid: ${chromeProcess.pid}`);
    } catch (error) {
        console.error(`[browser-profiles] ❌ Chrome launch failed:`, error);
        // Cleanup proxy if launch failed
        if (anonymizedProxyUrl) {
            await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => { });
        }
        throw error;
    }

    console.log(`Chrome launched on port ${chromeProcess.port}, PID: ${chromeProcess.pid}`);

    // Connect via CDP with retry (Chrome needs time to initialize debugging port)
    let client: any;
    const cdpMaxRetries = 10;
    const cdpRetryDelay = 300; // ms

    for (let i = 0; i < cdpMaxRetries; i++) {
        try {
            client = await (CDP as any)({ port: chromeProcess.port });
            break;
        } catch (cdpError: any) {
            if (i === cdpMaxRetries - 1) {
                // Last retry failed, cleanup and throw
                console.error(`[browser-profiles] Failed to connect CDP after ${cdpMaxRetries} retries`);
                try {
                    await chromeProcess.kill();
                    if (anonymizedProxyUrl) {
                        await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => { });
                    }
                } catch { }
                throw cdpError;
            }
            // Wait and retry
            await new Promise(r => setTimeout(r, cdpRetryDelay));
        }
    }

    const { Network, Emulation, Page } = client;

    // Enable network and inject anti-fingerprint scripts
    await Network.enable();

    // Set User-Agent override with platform spoofing (KEY: This is how puppeteer-extra-stealth does it!)
    const userAgent = profile.fingerprint?.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const platform = profile.fingerprint?.platform || 'Win32';
    const language = profile.fingerprint?.language || 'en-US';

    await Network.setUserAgentOverride({
        userAgent,
        platform,
        acceptLanguage: language,
        userAgentMetadata: {
            brands: [
                { brand: 'Not_A Brand', version: '8' },
                { brand: 'Chromium', version: '120' },
                { brand: 'Google Chrome', version: '120' },
            ],
            fullVersion: '120.0.0.0',
            platform: platform.includes('Win') ? 'Windows' : (platform.includes('Mac') ? 'macOS' : 'Linux'),
            platformVersion: platform.includes('Win') ? '10.0.0' : '14.0.0',
            architecture: 'x86',
            model: '',
            mobile: false,
        },
    });

    // Inject fingerprint protection scripts
    await Page.addScriptToEvaluateOnNewDocument({
        source: getAllProtectionScripts({
            webrtc: true,
            canvas: true,
            webgl: true,
            audio: true,
            navigator: {
                language,
                platform,
                hardwareConcurrency: profile.fingerprint?.hardwareConcurrency || 8,
                deviceMemory: profile.fingerprint?.deviceMemory || 8,
            },
        }),
    });

    // Set timezone
    await Emulation.setTimezoneOverride({
        timezoneId: profile.timezone || 'America/New_York',
    });

    // Inject cookies
    if (profile.cookies && profile.cookies.length > 0) {
        for (const cookie of profile.cookies) {
            await Network.setCookie({
                url: `https://${cookie.domain}`,
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path || '/',
                httpOnly: cookie.httpOnly || false,
                secure: cookie.secure || false,
                sameSite: cookie.sameSite || 'Lax',
                ...(cookie.expires ? { expires: cookie.expires } : {}),
            }).catch(() => {
                // Ignore cookie errors
            });
        }
    }

    // Get WebSocket endpoint with retry (browser needs time to fully initialize)
    let versionInfo: { webSocketDebuggerUrl: string } | null = null;
    const maxRetries = 10;
    const retryDelay = 200; // ms

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(`http://localhost:${chromeProcess.port}/json/version`);
            if (response.ok) {
                versionInfo = await response.json() as { webSocketDebuggerUrl: string };
                if (versionInfo?.webSocketDebuggerUrl) {
                    break;
                }
            }
        } catch {
            // Browser not ready yet, wait and retry
        }

        if (i < maxRetries - 1) {
            await new Promise(r => setTimeout(r, retryDelay));
        }
    }

    if (!versionInfo?.webSocketDebuggerUrl) {
        // Cleanup on failure
        try {
            await chromeProcess.kill();
            if (anonymizedProxyUrl) {
                await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => { });
            }
        } catch { }
        throw new Error('Failed to get browser WebSocket endpoint after multiple retries');
    }

    // Track running browser
    runningBrowsers.set(profile.id, {
        process: chromeProcess,
        proxyUrl: anonymizedProxyUrl,
    });

    // Write lock file for cross-process detection
    writeLockFile(userDataDir, {
        pid: chromeProcess.pid,
        port: chromeProcess.port,
        wsEndpoint: versionInfo.webSocketDebuggerUrl,
        startedAt: Date.now(),
        proxyUrl: anonymizedProxyUrl,
    });

    // Create close function
    const close = async () => {
        try {
            // Close CDP connection
            await client.close().catch(() => { });

            // Kill Chrome process
            await chromeProcess.kill();

            // Close anonymized proxy
            if (anonymizedProxyUrl) {
                await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => { });
            }

            // Remove from tracking
            runningBrowsers.delete(profile.id);

            // Delete lock file
            deleteLockFile(userDataDir);
        } catch (error) {
            console.error('Error closing browser:', error);
        }
    };

    return {
        wsEndpoint: versionInfo.webSocketDebuggerUrl,
        pid: chromeProcess.pid,
        port: chromeProcess.port,
        profileId: profile.id,
        close,
    };
}

/**
 * Close a browser by profile ID
 */
export async function closeBrowser(profileId: string): Promise<boolean> {
    const browser = runningBrowsers.get(profileId);
    if (!browser) {
        return false;
    }

    await loadDependencies();

    try {
        await browser.process.kill();

        if (browser.proxyUrl) {
            await proxyChain.closeAnonymizedProxy(browser.proxyUrl, true).catch(() => { });
        }

        runningBrowsers.delete(profileId);
        return true;
    } catch {
        return false;
    }
}

/**
 * Close all running browsers
 */
export async function closeAllBrowsers(): Promise<void> {
    await loadDependencies();

    const promises = Array.from(runningBrowsers.entries()).map(async ([_profileId, browser]) => {
        try {
            await browser.process.kill();
            if (browser.proxyUrl) {
                await proxyChain.closeAnonymizedProxy(browser.proxyUrl, true).catch(() => { });
            }
        } catch {
            // Ignore errors
        }
    });

    await Promise.allSettled(promises);
    runningBrowsers.clear();
}

/**
 * Get all running browsers
 */
export function getRunningBrowsers(): string[] {
    return Array.from(runningBrowsers.keys());
}

// ============================================================================
// Standalone Chrome Launch (v0.2.0)
// ============================================================================

/**
 * Options for standalone Chrome launch
 */
export interface StandaloneLaunchOptions {
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
     * User data directory (for session persistence)
     * If not provided, a temporary directory will be used
     */
    userDataDir?: string;

    /**
     * Proxy configuration
     */
    proxy?: ProxyConfig;

    /**
     * Timezone (auto-detected from proxy if not specified)
     */
    timezone?: string;

    /**
     * Fingerprint configuration
     */
    fingerprint?: {
        userAgent?: string;
        language?: string;
        platform?: string;
        hardwareConcurrency?: number;
        deviceMemory?: number;
    };

    /**
     * Additional Chrome arguments
     */
    args?: string[];

    /**
     * Extensions to load
     */
    extensions?: string[];
}

/**
 * Result from standalone Chrome launch
 */
export interface StandaloneLaunchResult {
    /**
     * WebSocket debugger URL
     */
    wsEndpoint: string;

    /**
     * Chrome process ID
     */
    pid: number;

    /**
     * Chrome debugging port
     */
    port: number;

    /**
     * Close function
     */
    close: () => Promise<void>;
}

/**
 * Launch Chrome without profile management
 * 
 * A standalone version of launchChrome that doesn't require a profile object.
 * Perfect for quick scripts, testing, or when you don't need session persistence.
 * 
 * @example Basic usage
 * ```typescript
 * import { launchChromeStandalone } from '@aitofy/browser-profiles';
 * 
 * const { wsEndpoint, close } = await launchChromeStandalone({
 *   headless: false,
 * });
 * 
 * // Connect with Puppeteer
 * const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
 * 
 * // ... do work ...
 * 
 * await close();
 * ```
 * 
 * @example With proxy and fingerprint
 * ```typescript
 * const { wsEndpoint, close } = await launchChromeStandalone({
 *   proxy: { type: 'http', host: 'proxy.com', port: 8080 },
 *   fingerprint: {
 *     platform: 'Win32',
 *     language: 'en-US',
 *   },
 * });
 * ```
 */
export async function launchChromeStandalone(options: StandaloneLaunchOptions = {}): Promise<StandaloneLaunchResult> {
    await loadDependencies();

    const {
        headless = false,
        chromePath,
        userDataDir,
        proxy,
        timezone,
        fingerprint = {},
        args = [],
        extensions = [],
    } = options;

    // Create a temporary profile-like object for internal use
    const tempProfile: StoredProfile = {
        id: `standalone-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        name: 'Standalone Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        proxy,
        timezone,
        fingerprint: {
            userAgent: fingerprint.userAgent,
            language: fingerprint.language || 'en-US',
            platform: fingerprint.platform || 'Win32',
            hardwareConcurrency: fingerprint.hardwareConcurrency || 8,
            deviceMemory: fingerprint.deviceMemory || 8,
        },
    };

    // Determine user data directory
    const finalUserDataDir = userDataDir || path.join(os.tmpdir(), `chrome-${tempProfile.id}`);

    // Ensure directory exists
    if (!fs.existsSync(finalUserDataDir)) {
        fs.mkdirSync(finalUserDataDir, { recursive: true });
    }

    // Launch using existing launchChrome
    const result = await launchChrome({
        profile: tempProfile,
        userDataDir: finalUserDataDir,
        headless,
        chromePath,
        args,
        extensions,
    });

    // Create a simplified close function
    const close = async () => {
        await result.close();

        // Clean up temporary directory if we created it
        if (!userDataDir && fs.existsSync(finalUserDataDir)) {
            try {
                // Use fs.rmSync for Node 14+
                if (typeof fs.rmSync === 'function') {
                    fs.rmSync(finalUserDataDir, { recursive: true, force: true });
                } else {
                    // Fallback for older Node versions
                    fs.rmdirSync(finalUserDataDir, { recursive: true } as any);
                }
            } catch {
                // Ignore cleanup errors
            }
        }
    };

    console.log(`[browser-profiles] Chrome launched standalone (${headless ? 'headless' : 'headed'})`);

    return {
        wsEndpoint: result.wsEndpoint,
        pid: result.pid,
        port: result.port,
        close,
    };
}

