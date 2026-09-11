import { z } from 'zod';
import { Err, Ok } from '../types';
import type { BrowserError, FingerprintConfig, ProxyConfig, Result, StoredProfile } from '../types';
import { defineCommand } from './define';
import { renderProfile } from './profile-get';
import { parseProxyUrl } from './proxy-url';
import {
    languageField,
    notesField,
    platformField,
    optionalProxyUrlField,
    tagsField,
    timezoneField,
} from './fields';

/** Only set fingerprint keys the caller actually provided. */
export function buildFingerprint(language?: string, platform?: string): FingerprintConfig | undefined {
    const fingerprint: FingerprintConfig = {};
    if (language) fingerprint.language = language;
    if (platform) fingerprint.platform = platform;
    return Object.keys(fingerprint).length > 0 ? fingerprint : undefined;
}

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
        language: languageField,
        platform: platformField,
        tags: tagsField,
        notes: notesField,
    }),
    async run(ctx, input): Promise<Result<StoredProfile>> {
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
                fingerprint: buildFingerprint(input.language, input.platform),
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
