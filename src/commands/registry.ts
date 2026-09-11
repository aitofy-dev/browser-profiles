// ============================================================================
// @aitofy/browser-profiles - Command registry
// ============================================================================
// One entry per user-facing operation. CLI and MCP are generators over this
// array; adding a command means one new file plus one line here.

import type { AnyCommandDef } from './define';
import { browserClose } from './browser-close';
import { browserCloseAll } from './browser-close-all';
import { browserLaunch } from './browser-launch';
import { browserOpen } from './browser-open';
import { browserStatus } from './browser-status';
import { profileCreate } from './profile-create';
import { profileDelete } from './profile-delete';
import { profileDuplicate } from './profile-duplicate';
import { profileGet } from './profile-get';
import { profileList } from './profile-list';
import { profileUpdate } from './profile-update';
import { storagePath } from './storage-path';

export type {
    AnyCommandDef,
    CommandCli,
    CommandContext,
    CommandDef,
    CreateCommandContextOptions,
} from './define';

export {
    cliPathFor,
    createCommandContext,
    defineCommand,
    mcpToolNameFor,
    resolveProfile,
    runCommand,
} from './define';

export { resolveStoragePath } from '../storage';

export const commands: readonly AnyCommandDef[] = [
    profileList,
    profileGet,
    profileCreate,
    profileUpdate,
    profileDelete,
    profileDuplicate,
    browserOpen,
    browserLaunch,
    browserClose,
    browserCloseAll,
    browserStatus,
    storagePath,
];

/** Look up a command by its dotted name, e.g. 'browser.open'. */
export function getCommand(name: string): AnyCommandDef | undefined {
    return commands.find((command) => command.name === name);
}
