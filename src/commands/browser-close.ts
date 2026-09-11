import { z } from 'zod';
import { Err, Ok } from '../types';
import type { Result } from '../types';
import { closeLockedBrowser, userDataDirFor } from './browser-runtime';
import { defineCommand, resolveProfile } from './define';
import { idOrNameField } from './fields';

export interface BrowserClosed {
    profileId: string;
    closed: boolean;
}

const TEMP_ID_PREFIX = 'tmp-';

export const browserClose = defineCommand({
    name: 'browser.close',
    description:
        'Close the browser running for a profile, from any process. Reads the profile lock file, so it ' +
        'works even if another process opened the browser. Returns closed=false when nothing was running.',
    cli: { positional: ['idOrName'], aliases: ['close'] },
    input: z.object({
        idOrName: idOrNameField.describe(
            `${idOrNameField.description} Also accepts a temporary session id from browser.launch, e.g. "tmp-1712345678901-a1b2c3".`
        ),
    }),
    async run(ctx, input): Promise<Result<BrowserClosed>> {
        const temporary = input.idOrName.startsWith(TEMP_ID_PREFIX);

        let profileId = input.idOrName;
        if (!temporary) {
            const found = await resolveProfile(ctx, input.idOrName);
            if (!found.ok) return Err(found.error);
            profileId = found.data.id;
        }

        const userDataDir = userDataDirFor(ctx.storagePath, profileId);
        const outcome = await closeLockedBrowser(userDataDir, ctx.log, { removeDir: temporary });

        return Ok<BrowserClosed>({ profileId, closed: outcome.closed });
    },
    render(output) {
        return output.closed
            ? `Browser closed: ${output.profileId}\n`
            : `No running browser for ${output.profileId}\n`;
    },
});
