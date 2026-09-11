import { z } from 'zod';
import { Err, Ok } from '../types';
import type { BrowserError, Result } from '../types';
import { closeLockedBrowser, isLockedBrowserAlive, userDataDirFor } from './browser-runtime';
import { defineCommand, resolveProfile } from './define';
import { idOrNameField } from './fields';

export interface ProfileDeleted {
    id: string;
    deleted: true;
}

export const profileDelete = defineCommand({
    name: 'profile.delete',
    description: 'Delete a profile and all of its browser data. Irreversible.',
    cli: { positional: ['idOrName'], aliases: ['delete', 'rm'] },
    input: z.object({
        idOrName: idOrNameField,
        force: z
            .boolean()
            .optional()
            .describe(
                'Delete even while a browser is open for this profile (it is closed first). ' +
                'Default false, which fails with an error instead.'
            ),
    }),
    async run(ctx, input): Promise<Result<ProfileDeleted>> {
        const found = await resolveProfile(ctx, input.idOrName);
        if (!found.ok) return Err(found.error);
        const profile = found.data;

        // A lock alone proves nothing: it survives a crash. The port is the proof.
        const userDataDir = userDataDirFor(ctx.storagePath, profile.id);
        if (await isLockedBrowserAlive(userDataDir) && !input.force) {
            return Err<BrowserError>({
                code: 'INVALID_CONFIG',
                message:
                    `Profile "${profile.id}" has a running browser. ` +
                    `Close it first (browser.close) or pass force=true.`,
                profileId: profile.id,
            });
        }
        // Closes the browser when force was given, and clears a stale lock either way.
        await closeLockedBrowser(userDataDir, ctx.log);

        const deleted = await ctx.profiles.delete(profile.id);
        if (!deleted) {
            return Err<BrowserError>({
                code: 'STORAGE_ERROR',
                message: `Failed to delete profile "${profile.id}" from ${ctx.storagePath}.`,
                profileId: profile.id,
            });
        }
        return Ok<ProfileDeleted>({ id: profile.id, deleted: true });
    },
    render(output) {
        return `Profile deleted: ${output.id}\n`;
    },
});
