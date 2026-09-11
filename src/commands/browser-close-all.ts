import { z } from 'zod';
import { Ok } from '../types';
import type { Result } from '../types';
import { closeLockedBrowser, scanRunning, userDataDirFor } from './browser-runtime';
import { defineCommand } from './define';

export interface BrowsersClosed {
    closed: string[];
}

export const browserCloseAll = defineCommand({
    name: 'browser.close_all',
    description: 'Close every browser started from this storage path, including temporary sessions.',
    cli: { path: 'browser close-all', aliases: ['close-all'] },
    input: z.object({}),
    async run(ctx): Promise<Result<BrowsersClosed>> {
        const running = await scanRunning(ctx.storagePath, ctx.log);
        const closed: string[] = [];

        for (const browser of running) {
            const userDataDir = userDataDirFor(ctx.storagePath, browser.profileId);
            const outcome = await closeLockedBrowser(userDataDir, ctx.log, { removeDir: browser.temporary });
            if (outcome.closed) closed.push(browser.profileId);
        }

        return Ok<BrowsersClosed>({ closed });
    },
    render(output) {
        if (output.closed.length === 0) return 'No running browsers.\n';
        return `Closed ${output.closed.length} browser(s): ${output.closed.join(', ')}\n`;
    },
});
