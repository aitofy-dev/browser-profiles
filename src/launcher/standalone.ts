// ============================================================================
// @aitofy/browser-profiles - Chrome without a stored profile
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ProxyConfig, ResolvedEngine, StoredProfile } from '../types';
import { createLogger } from '../log';
import { launchChrome } from './launch';

const log = createLogger('chrome-launcher');

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

    /**
     * Let Chrome outlive this Node process
     * @default false
     */
    detached?: boolean;

    /**
     * Where the fingerprint is applied. Default auto.
     */
    engine?: 'auto' | 'kernel' | 'inject';
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

    /** kernel spoofs inside Chromium. inject patches from JavaScript. */
    engine: ResolvedEngine;
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
    const {
        headless = false,
        chromePath,
        userDataDir,
        proxy,
        timezone,
        fingerprint = {},
        args = [],
        extensions = [],
        detached = false,
        engine,
    } = options;

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
            // Unset lets each engine pick: inject claims Windows, kernel claims this machine.
            platform: fingerprint.platform,
            hardwareConcurrency: fingerprint.hardwareConcurrency || 8,
            deviceMemory: fingerprint.deviceMemory || 8,
        },
    };

    const finalUserDataDir = userDataDir || path.join(os.tmpdir(), `chrome-${tempProfile.id}`);

    if (!fs.existsSync(finalUserDataDir)) {
        fs.mkdirSync(finalUserDataDir, { recursive: true });
    }

    const result = await launchChrome({
        profile: tempProfile,
        userDataDir: finalUserDataDir,
        headless,
        chromePath,
        args,
        extensions,
        detached,
        engine,
    });

    const close = async () => {
        await result.close();

        // Only a directory we created ourselves may be removed.
        if (!userDataDir) {
            try {
                fs.rmSync(finalUserDataDir, { recursive: true, force: true });
            } catch {
                // A leftover temp dir is harmless.
            }
        }
    };

    log.info(`Chrome launched standalone (${headless ? 'headless' : 'headed'})`);

    return {
        wsEndpoint: result.wsEndpoint,
        pid: result.pid,
        port: result.port,
        close,
        engine: result.engine,
    };
}

