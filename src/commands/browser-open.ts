import { z } from 'zod';
import { Err, Ok } from '../types';
import type { BrowserError, ResolvedEngine, Result } from '../types';
import { DETACHED_PROXY_MESSAGE } from '../launcher/proxy';
import { REAL_ENGINE_ADVICE } from '../launcher/real';
import { defineCommand, resolveProfile } from './define';
import { detachedField, engineField, headlessField, idOrNameField } from './fields';

export interface BrowserOpened {
    profileId: string;
    wsEndpoint: string;
    port: number;
    pid: number;
    /** True when an already-running browser for this profile was returned. */
    reused: boolean;
    /** True when Chrome was started to outlive the opener (reduced protection). */
    detached: boolean;
    /** kernel spoofs inside Chromium. inject patches from JavaScript. real changes nothing. */
    engine: ResolvedEngine;
}

/** The launcher reports every problem as a thrown Error; keep the codes honest. */
export function launchErrorCode(message: string): BrowserError['code'] {
    if (message.includes(DETACHED_PROXY_MESSAGE) || message.includes(REAL_ENGINE_ADVICE)) return 'INVALID_CONFIG';
    if (/not found/i.test(message) && /chrom/i.test(message)) return 'CHROME_NOT_FOUND';
    return 'LAUNCH_FAILED';
}

function launchError(profileId: string, thrown: unknown): BrowserError {
    const cause = thrown instanceof Error ? thrown : new Error(String(thrown));
    const code = launchErrorCode(cause.message);
    return { code, message: `Failed to open browser for "${profileId}": ${cause.message}`, cause, profileId };
}

export const browserOpen = defineCommand({
    name: 'browser.open',
    description:
        'Open Chrome with a stored profile and return its CDP wsEndpoint. Calling it again for the same ' +
        'profile returns the running browser with reused=true. engine reports real when the profile ' +
        'ran with Chrome\'s own fingerprint. Close it with browser.close.',
    cli: { positional: ['idOrName'], aliases: ['open'], keepAlive: true },
    input: z.object({
        idOrName: idOrNameField,
        headless: headlessField,
        startUrl: z
            .string()
            .url()
            .optional()
            .describe('Absolute URL to open in the first tab, e.g. "https://example.com". Omit for a blank tab.'),
        detached: detachedField,
        engine: engineField,
        port: z
            .number()
            .int()
            .min(1024)
            .max(65535)
            .optional()
            .describe(
                'Fixed DevTools port, e.g. 9301, so a client set up ahead of time can connect to ' +
                'http://127.0.0.1:<port>. Omit for a free port. A browser that is already running keeps its port.'
            ),
    }),
    async run(ctx, input): Promise<Result<BrowserOpened>> {
        const found = await resolveProfile(ctx, input.idOrName);
        if (!found.ok) return Err(found.error);
        const profile = found.data;

        try {
            const result = await ctx.profiles.launch(profile.id, {
                headless: input.headless ?? false,
                detached: input.detached ?? false,
                engine: input.engine,
                port: input.port,
                args: input.startUrl ? [input.startUrl] : [],
            });

            return Ok<BrowserOpened>({
                profileId: profile.id,
                wsEndpoint: result.wsEndpoint,
                port: result.port,
                pid: result.pid,
                reused: result.reused === true,
                detached: input.detached ?? false,
                engine: result.engine,
            });
        } catch (thrown) {
            return Err(launchError(profile.id, thrown));
        }
    },
    render(output) {
        const how = output.reused ? 'Reused running browser' : 'Browser launched';
        return [
            '',
            `${how} for profile ${output.profileId}`,
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
