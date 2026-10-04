import { z } from 'zod';
import { Ok } from '../types';
import type { Result } from '../types';
import { scanRunning } from './browser-runtime';
import type { RunningBrowser } from './browser-runtime';
import { defineCommand } from './define';

export interface BrowserStatus {
    running: RunningBrowser[];
}

export const browserStatus = defineCommand({
    name: 'browser.status',
    description:
        'List browsers that are currently running for this storage path, with their CDP endpoints. ' +
        'Lock files left behind by crashed browsers are removed while scanning.',
    cli: { aliases: ['status', 'ps'] },
    input: z.object({}),
    async run(ctx): Promise<Result<BrowserStatus>> {
        const running = await scanRunning(ctx.storagePath, ctx.log);
        return Ok<BrowserStatus>({ running });
    },
    render(output) {
        if (output.running.length === 0) return 'No running browsers.\n';

        const lines = ['', 'Running browsers:', ''];
        for (const browser of output.running) {
            const kind = browser.temporary ? ' (temporary)' : '';
            lines.push(`${browser.profileId}${kind}`);
            lines.push(`  pid ${browser.pid}, port ${browser.port}, engine ${browser.engine}, ` +
                `since ${new Date(browser.startedAt).toLocaleString()}`);
            lines.push(`  ${browser.wsEndpoint}`);
        }
        lines.push('');
        return lines.join('\n');
    },
});
