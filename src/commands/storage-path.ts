import { z } from 'zod';
import { Ok } from '../types';
import type { Result } from '../types';
import { defineCommand } from './define';
import { STORAGE_PATH_ENV } from '../storage';

export interface StoragePathOutput {
    path: string;
}

export const storagePath = defineCommand({
    name: 'storage.path',
    description: 'Print the directory where profiles and browser data are stored.',
    cli: { aliases: ['path'] },
    input: z.object({}),
    async run(ctx): Promise<Result<StoragePathOutput>> {
        return Ok<StoragePathOutput>({ path: ctx.storagePath });
    },
    render(output) {
        return `Profiles stored at: ${output.path}\n(override with --storage-path or ${STORAGE_PATH_ENV})\n`;
    },
});
