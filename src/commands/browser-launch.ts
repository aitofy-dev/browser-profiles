import { z } from 'zod';
import { Err, Ok } from '../types';
import type { BrowserError, ProxyConfig, ResolvedEngine, Result } from '../types';
import { launchChromeStandalone } from '../chrome-launcher';
import { generateFingerprint } from '../fingerprint';
import { defineCommand } from './define';
import { launchErrorCode } from './browser-open';
import { newTempProfileId, tempSessionDir } from './browser-runtime';
import { detachedField, engineField, headlessField, optionalProxyUrlField } from './fields';
import { parseProxyUrl } from './proxy-url';

export interface BrowserLaunched {
    profileId: string;
    wsEndpoint: string;
    port: number;
    pid: number;
    temporary: true;
    /** True when Chrome was started to outlive the opener (reduced protection). */
    detached: boolean;
    /** kernel spoofs inside Chromium. inject patches from JavaScript. */
    engine: ResolvedEngine;
}

export const browserLaunch = defineCommand({
    name: 'browser.launch',
    description:
        'Launch a throwaway Chrome with a random fingerprint and no saved profile, and return its CDP ' +
        'wsEndpoint. Nothing persists: browser.close removes the session directory. Use browser.open ' +
        'when logins or cookies must survive.',
    cli: { aliases: ['launch'], keepAlive: true },
    input: z.object({
        proxy: optionalProxyUrlField,
        headless: headlessField,
        randomFingerprint: z
            .boolean()
            .default(true)
            .describe(
                'Generate a random but internally consistent user agent, platform and hardware profile. ' +
                'Default true. Set false to use Chrome own fingerprint.'
            ),
        detached: detachedField,
        engine: engineField,
    }),
    async run(ctx, input): Promise<Result<BrowserLaunched>> {
        let proxy: ProxyConfig | undefined;
        if (input.proxy) {
            const parsed = parseProxyUrl(input.proxy);
            if (!parsed.ok) return Err(parsed.error);
            proxy = parsed.data;
        }

        const profileId = newTempProfileId();
        const userDataDir = tempSessionDir(ctx.storagePath, profileId);
        const fingerprint = input.randomFingerprint ? generateFingerprint() : undefined;

        try {
            const result = await launchChromeStandalone({
                userDataDir,
                headless: input.headless ?? false,
                proxy,
                detached: input.detached ?? false,
                engine: input.engine,
                fingerprint: fingerprint && {
                    userAgent: fingerprint.userAgent,
                    language: fingerprint.language,
                    platform: fingerprint.platform,
                    hardwareConcurrency: fingerprint.hardwareConcurrency,
                    deviceMemory: fingerprint.deviceMemory,
                },
            });

            ctx.log.info(`Temporary session ${profileId} on port ${result.port}`);
            return Ok<BrowserLaunched>({
                profileId,
                wsEndpoint: result.wsEndpoint,
                port: result.port,
                pid: result.pid,
                temporary: true,
                detached: input.detached ?? false,
                engine: result.engine,
            });
        } catch (thrown) {
            const cause = thrown instanceof Error ? thrown : new Error(String(thrown));
            return Err<BrowserError>({
                code: launchErrorCode(cause.message),
                message: `Failed to launch temporary browser: ${cause.message}`,
                cause,
            });
        }
    },
    render(output) {
        return [
            '',
            `Temporary browser launched (${output.profileId})`,
            `  wsEndpoint: ${output.wsEndpoint}`,
            `  port:       ${output.port}`,
            `  pid:        ${output.pid}`,
            `  engine:     ${output.engine}`,
            '',
            `Close with: browser-profiles browser close ${output.profileId}`,
            '',
        ].join('\n');
    },
});
