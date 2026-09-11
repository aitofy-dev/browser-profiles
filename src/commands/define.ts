// ============================================================================
// @aitofy/browser-profiles - Command primitives shared by CLI, MCP and library
// ============================================================================

import { z } from 'zod';
import { BrowserProfiles } from '../profile-manager';
import { createLogger } from '../log';
import type { Logger } from '../log';
import { resolveStoragePath } from '../storage';
import { Err } from '../types';
import type { BrowserError, Result, StoredProfile } from '../types';

/** Everything a command is allowed to touch. No globals. */
export interface CommandContext {
    profiles: BrowserProfiles;
    storagePath: string;
    /** Writes to stderr only; stdout belongs to the CLI/MCP protocol. */
    log: Logger;
}

/** How a command surfaces on the CLI. Consumed by the CLI generator. */
export interface CommandCli {
    /** Override the default path derived from the dotted name ('profile list'). */
    path?: string;
    /** Extra top-level aliases, e.g. ['list', 'ls']. */
    aliases?: string[];
    /** Input keys mapped to positional args, in order. */
    positional?: string[];
    /** CLI blocks until Ctrl+C instead of exiting after render(). */
    keepAlive?: boolean;
}

export interface CommandDef<I, O> {
    /** Dotted name: 'profile.list', 'browser.open'. */
    name: string;
    /** One sentence, used verbatim by CLI help and MCP tool description. */
    description: string;
    /** Single source for CLI flags, MCP inputSchema and validation. */
    input: z.ZodObject<z.ZodRawShape>;
    cli?: CommandCli;
    run(ctx: CommandContext, input: I): Promise<Result<O, BrowserError>>;
    /** Human text for CLI; MCP and --json use the raw output. */
    render(output: O): string;
}

/** Erased command type, for registries and generators. */
export type AnyCommandDef = CommandDef<Record<string, unknown>, unknown>;

/** Identity helper that keeps input/output inference from the zod schema and run(). */
export function defineCommand<S extends z.ZodObject<z.ZodRawShape>, O>(def: {
    name: string;
    description: string;
    input: S;
    cli?: CommandCli;
    run(ctx: CommandContext, input: z.output<S>): Promise<Result<O, BrowserError>>;
    render(output: O): string;
}): CommandDef<z.output<S>, O> {
    return def;
}

export interface CreateCommandContextOptions {
    /** Explicit storage path; wins over BROWSER_PROFILES_HOME and the default. */
    storagePath?: string;
    /** Turn debug/info logging on regardless of DEBUG. */
    verbose?: boolean;
}

export function createCommandContext(opts: CreateCommandContextOptions = {}): CommandContext {
    const storagePath = resolveStoragePath(opts.storagePath);
    return {
        storagePath,
        profiles: new BrowserProfiles({ storagePath }),
        log: createLogger('command', { verbose: opts.verbose }),
    };
}

/** CLI path segments: 'profile.list' -> ['profile', 'list']. */
export function cliPathFor(def: CommandDef<never, never> | AnyCommandDef): string[] {
    const override = def.cli?.path;
    if (override) return override.trim().split(/\s+/);
    return def.name.split('.');
}

/** MCP tool name: 'browser.close_all' -> 'browser_close_all'. */
export function mcpToolNameFor(def: CommandDef<never, never> | AnyCommandDef): string {
    return def.name.replace(/\./g, '_');
}

const MAX_SUGGESTIONS = 5;

function suggestionsFor(profiles: StoredProfile[], idOrName: string): string[] {
    const needle = idOrName.toLowerCase();
    if (needle.length === 0) return [];

    const prefixed: string[] = [];
    const contained: string[] = [];

    for (const profile of profiles) {
        const id = profile.id.toLowerCase();
        const name = (profile.name ?? '').toLowerCase();
        const label = `${profile.name ?? 'Unnamed'} (${profile.id})`;
        if (id.startsWith(needle) || name.startsWith(needle)) prefixed.push(label);
        else if (id.includes(needle) || name.includes(needle)) contained.push(label);
    }

    return [...prefixed, ...contained].slice(0, MAX_SUGGESTIONS);
}

/** The one place `idOrName` turns into a profile. */
export async function resolveProfile(
    ctx: CommandContext,
    idOrName: string
): Promise<Result<StoredProfile, BrowserError>> {
    const profile = await ctx.profiles.getByIdOrName(idOrName);
    if (profile) return { ok: true, data: profile, error: null };

    const all = await ctx.profiles.list();
    const hints = suggestionsFor(all, idOrName);
    const tail = hints.length > 0
        ? ` Did you mean: ${hints.join(', ')}?`
        : ` Run "browser-profiles profile list" to see the ${all.length} stored profile(s).`;

    return Err<BrowserError>({
        code: 'PROFILE_NOT_FOUND',
        message: `Profile not found: "${idOrName}".${tail}`,
        profileId: idOrName,
    });
}

function formatIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const where = issue.path.length > 0 ? issue.path.join('.') : '(input)';
            return `${where}: ${issue.message}`;
        })
        .join('; ');
}

function toInternalError(name: string, thrown: unknown): BrowserError {
    const cause = thrown instanceof Error ? thrown : new Error(String(thrown));
    return {
        code: 'INTERNAL',
        message: `Command "${name}" failed unexpectedly: ${cause.message}`,
        cause,
    };
}

/**
 * Validate raw input, run the command, never throw.
 * CLI and MCP both go through this so their behaviour cannot drift.
 */
export async function runCommand<I, O>(
    ctx: CommandContext,
    def: CommandDef<I, O>,
    rawInput: unknown
): Promise<Result<O, BrowserError>> {
    const parsed = def.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
        return Err<BrowserError>({
            code: 'INVALID_CONFIG',
            message: `Invalid input for "${def.name}" - ${formatIssues(parsed.error)}`,
        });
    }

    try {
        return await def.run(ctx, parsed.data as I);
    } catch (thrown) {
        const error = toInternalError(def.name, thrown);
        ctx.log.error(error.message);
        return Err(error);
    }
}
