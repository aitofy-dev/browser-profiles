import { z } from 'zod';
import { Err, Ok } from '../types';
import type { BrowserError, ProxyConfig, Result, StoredProfile } from '../types';
import { defineCommand } from './define';
import { nextFingerprint } from './fingerprint-input';
import { renderProfile } from './profile-get';
import { parseProxyUrl } from './proxy-url';
import {
    fingerprintModeField,
    languageField,
    notesField,
    platformField,
    optionalProxyUrlField,
    tagsField,
    timezoneField,
} from './fields';

export const profileCreate = defineCommand({
    name: 'profile.create',
    description: 'Create a new browser profile with its own storage, proxy and fingerprint.',
    cli: { positional: ['name'], aliases: ['create'] },
    input: z.object({
        name: z
            .string()
            .min(1)
            .describe('Display name, e.g. "Facebook - Acme". Used by every command that takes idOrName.'),
        id: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,64}$/)
            .refine(
                (id) => !id.toLowerCase().startsWith('tmp-'),
                'Ids starting with "tmp-" are reserved for temporary browser.launch sessions.'
            )
            .optional()
            .describe(
                'Optional stable id: 1-64 chars of letters, digits, hyphen or underscore, e.g. "acme-fb-01". ' +
                'Must not start with "tmp-" (reserved for temporary browser.launch sessions). ' +
                'Omit to get a random 16-hex-character id. Must not already exist.'
            ),
        proxy: optionalProxyUrlField,
        timezone: timezoneField,
        fingerprint: fingerprintModeField,
        language: languageField,
        platform: platformField,
        tags: tagsField,
        notes: notesField,
    }),
    async run(ctx, input): Promise<Result<StoredProfile>> {
        const { fingerprint: mode, language, platform } = input;
        const fingerprint = nextFingerprint(undefined, { mode, language, platform });
        if (!fingerprint.ok) return Err(fingerprint.error);

        let proxy: ProxyConfig | undefined;
        if (input.proxy) {
            const parsed = parseProxyUrl(input.proxy);
            if (!parsed.ok) return Err(parsed.error);
            proxy = parsed.data;
        }

        try {
            const profile = await ctx.profiles.create({
                id: input.id,
                name: input.name,
                proxy,
                timezone: input.timezone,
                fingerprint: fingerprint.data,
                tags: input.tags,
                notes: input.notes,
            });
            ctx.log.info(`Created profile ${profile.id}`);
            return Ok(profile);
        } catch (thrown) {
            const cause = thrown instanceof Error ? thrown : new Error(String(thrown));
            return Err<BrowserError>({ code: 'INVALID_CONFIG', message: cause.message, cause });
        }
    },
    render(profile) {
        return `${renderProfile(profile)}Launch with: browser-profiles browser open ${profile.id}\n`;
    },
});
