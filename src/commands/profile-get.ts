import { z } from 'zod';
import type { StoredProfile } from '../types';
import { defineCommand, resolveProfile } from './define';
import { idOrNameField } from './fields';

/** Shared by profile.get, profile.create, profile.update and profile.duplicate. */
export function renderProfile(profile: StoredProfile): string {
    const lines = [
        '',
        'Profile:',
        '',
        `ID:         ${profile.id}`,
        `Name:       ${profile.name || 'Unnamed'}`,
        `Created:    ${new Date(profile.createdAt).toLocaleString()}`,
        `Updated:    ${new Date(profile.updatedAt).toLocaleString()}`,
    ];

    if (profile.proxy) {
        lines.push('', 'Proxy:');
        lines.push(`  Type:     ${profile.proxy.type}`);
        lines.push(`  Host:     ${profile.proxy.host}`);
        lines.push(`  Port:     ${profile.proxy.port}`);
        if (profile.proxy.username) lines.push(`  Username: ${profile.proxy.username}`);
    }

    if (profile.timezone) lines.push('', `Timezone:   ${profile.timezone}`);
    if (profile.tags && profile.tags.length > 0) lines.push(`Tags:       ${profile.tags.join(', ')}`);
    if (profile.notes) lines.push(`Notes:      ${profile.notes}`);

    const fingerprint = profile.fingerprint;
    if (fingerprint?.mode === 'real') {
        lines.push('', 'Fingerprint: real (Chrome\'s own identity, nothing spoofed)');
        if (fingerprint.language) lines.push(`  Language: ${fingerprint.language}`);
    } else if (fingerprint && Object.keys(fingerprint).length > 0) {
        lines.push('', 'Fingerprint:');
        if (fingerprint.language) lines.push(`  Language: ${fingerprint.language}`);
        if (fingerprint.platform) lines.push(`  Platform: ${fingerprint.platform}`);
        if (fingerprint.userAgent) lines.push(`  UA:       ${fingerprint.userAgent}`);
    }

    lines.push('');
    return lines.join('\n');
}

export const profileGet = defineCommand({
    name: 'profile.get',
    description: 'Show one profile by id or name, including its proxy and fingerprint.',
    cli: { positional: ['idOrName'], aliases: ['info'] },
    input: z.object({ idOrName: idOrNameField }),
    async run(ctx, input) {
        return resolveProfile(ctx, input.idOrName);
    },
    render: renderProfile,
});
