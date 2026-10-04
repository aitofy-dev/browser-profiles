import { z } from 'zod';
import { Err, Ok } from '../types';
import type { BrowserError, ProfileConfig, Result, StoredProfile } from '../types';
import { defineCommand, resolveProfile } from './define';
import { nextFingerprint } from './fingerprint-input';
import { renderProfile } from './profile-get';
import { parseProxyUrl } from './proxy-url';
import {
    PROXY_URL_DESCRIPTION,
    fingerprintModeField,
    idOrNameField,
    languageField,
    notesField,
    platformField,
    proxyUrlField,
    tagsField,
    timezoneField,
} from './fields';

export const profileUpdate = defineCommand({
    name: 'profile.update',
    description: 'Change fields of an existing profile. Omitted fields are left untouched.',
    cli: { positional: ['idOrName'], aliases: ['update'] },
    input: z.object({
        idOrName: idOrNameField,
        name: z.string().min(1).optional().describe('New display name. Omit to keep the current one.'),
        proxy: proxyUrlField
            .nullable()
            .optional()
            .describe(`${PROXY_URL_DESCRIPTION} Pass null to remove the proxy; omit to keep the current one.`),
        timezone: timezoneField,
        fingerprint: fingerprintModeField,
        language: languageField,
        platform: platformField,
        tags: tagsField,
        notes: notesField,
    }),
    async run(ctx, input): Promise<Result<StoredProfile>> {
        const found = await resolveProfile(ctx, input.idOrName);
        if (!found.ok) return Err(found.error);
        const current = found.data;

        const updates: Partial<ProfileConfig> = {};
        if (input.name !== undefined) updates.name = input.name;
        if (input.timezone !== undefined) updates.timezone = input.timezone;
        if (input.tags !== undefined) updates.tags = input.tags;
        if (input.notes !== undefined) updates.notes = input.notes;

        if (input.proxy === null) {
            updates.proxy = null;
        } else if (input.proxy !== undefined) {
            const parsed = parseProxyUrl(input.proxy);
            if (!parsed.ok) return Err(parsed.error);
            updates.proxy = parsed.data;
        }

        const { fingerprint: mode, language, platform } = input;
        const fingerprint = nextFingerprint(current.fingerprint, { mode, language, platform });
        if (!fingerprint.ok) return Err(fingerprint.error);
        if (fingerprint.data) updates.fingerprint = fingerprint.data;

        const updated = await ctx.profiles.update(current.id, updates);
        if (!updated) {
            return Err<BrowserError>({
                code: 'STORAGE_ERROR',
                message: `Failed to write profile "${current.id}". Check write access to ${ctx.storagePath}.`,
                profileId: current.id,
            });
        }
        return Ok(updated);
    },
    render: renderProfile,
});
