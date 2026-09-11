import { z } from 'zod';
import { Ok } from '../types';
import type { Result, StoredProfile } from '../types';
import { defineCommand } from './define';

const COLUMNS = { id: 36, name: 17, proxy: 18 };

function row(id: string, name: string, proxy: string, created: string): string {
    return `${id.padEnd(COLUMNS.id)} | ${name.padEnd(COLUMNS.name)} | ${proxy.padEnd(COLUMNS.proxy)} | ${created}`;
}

export const profileList = defineCommand({
    name: 'profile.list',
    description: 'List stored browser profiles, optionally filtered by group or tag.',
    cli: { aliases: ['list', 'ls'] },
    input: z.object({
        groupId: z
            .string()
            .min(1)
            .optional()
            .describe('Return only profiles whose groupId equals this value exactly (case-sensitive).'),
        tag: z
            .string()
            .min(1)
            .optional()
            .describe('Return only profiles carrying this tag, e.g. "facebook". Exact, case-sensitive match.'),
    }),
    async run(ctx, input): Promise<Result<StoredProfile[]>> {
        const profiles = await ctx.profiles.list({
            groupId: input.groupId,
            tags: input.tag ? [input.tag] : undefined,
        });
        return Ok(profiles);
    },
    render(profiles) {
        if (profiles.length === 0) {
            return 'No profiles found. Create one with: browser-profiles profile create <name>';
        }

        const lines = [
            '',
            'Browser Profiles:',
            '',
            row('ID', 'Name', 'Proxy', 'Created'),
            `${'-'.repeat(COLUMNS.id)}-|-${'-'.repeat(COLUMNS.name)}-|-${'-'.repeat(COLUMNS.proxy)}-|----------------`,
        ];

        for (const profile of profiles) {
            lines.push(row(
                profile.id.substring(0, COLUMNS.id),
                (profile.name || 'Unnamed').substring(0, COLUMNS.name),
                profile.proxy ? `${profile.proxy.host}:${profile.proxy.port}`.substring(0, COLUMNS.proxy) : 'No proxy',
                new Date(profile.createdAt).toLocaleDateString()
            ));
        }

        lines.push('', `Total: ${profiles.length} profile(s)`, '');
        return lines.join('\n');
    },
});
