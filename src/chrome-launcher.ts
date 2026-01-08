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
    } catch (error) {
        // Cleanup proxy if launch failed
        if (anonymizedProxyUrl) {
            await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => { });
        }
        throw error;
    }

    console.log(`Chrome launched on port ${chromeProcess.port}, PID: ${chromeProcess.pid}`);

    // Connect via CDP
    const client = await (CDP as any)({ port: chromeProcess.port });
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

    // Get WebSocket endpoint
    const response = await fetch(`http://localhost:${chromeProcess.port}/json/version`);
    const versionInfo = (await response.json()) as { webSocketDebuggerUrl: string };

    // Track running browser
    runningBrowsers.set(profile.id, {
        process: chromeProcess,
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
