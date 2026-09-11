import { z } from 'zod';
import { Err, Ok } from '../types';
import type { BrowserError, Result, StoredProfile } from '../types';
import { defineCommand, resolveProfile } from './define';
import { renderProfile } from './profile-get';
import { idOrNameField } from './fields';

export const profileDuplicate = defineCommand({
    name: 'profile.duplicate',
    description: 'Copy a profile settings (proxy, timezone, fingerprint) into a new profile with a new id.',
    cli: { positional: ['idOrName'], aliases: ['duplicate'] },
    input: z.object({
        idOrName: idOrNameField,
        name: z
            .string()
            .min(1)
            .optional()
            .describe('Name for the copy. Defaults to the source name followed by " (Copy)".'),
    }),
    async run(ctx, input): Promise<Result<StoredProfile>> {
        const found = await resolveProfile(ctx, input.idOrName);
        if (!found.ok) return Err(found.error);

        const copy = await ctx.profiles.duplicate(found.data.id, input.name);
        if (!copy) {
            return Err<BrowserError>({
                code: 'STORAGE_ERROR',
                message: `Failed to duplicate profile "${found.data.id}".`,
                profileId: found.data.id,
            });
        }
        return Ok(copy);
    },
    render: renderProfile,
});
