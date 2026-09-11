#!/usr/bin/env node
// ============================================================================
// @aitofy/browser-profiles - CLI generated from the command registry
// ============================================================================
// No business logic lives here: every command comes from src/commands/registry.

import { Command, Option } from 'commander';
import { VERSION } from './index';
import { cliPathFor, commands, createCommandContext, getCommand, runCommand } from './commands/registry';
import type { AnyCommandDef, CommandContext, CreateCommandContextOptions } from './commands/registry';
import type { BrowserError } from './types';
import {
    collectList,
    exampleFor,
    mergeInput,
    optionsFromSchema,
    positionalsFromSchema,
    renderCommandsHelp,
    startedProfileId,
} from './cli-render';
import type { CliOption } from './cli-render';

interface GlobalOptions {
    json?: boolean;
    verbose?: boolean;
    storagePath?: string;
}

/** Everything the CLI touches outside itself, injectable so tests stay in-process. */
export interface CliIo {
    stdout?(text: string): void;
    stderr?(text: string): void;
    setExitCode?(code: number): void;
    createContext?(opts: CreateCommandContextOptions): CommandContext;
}

type Execute = (def: AnyCommandDef, input: Record<string, unknown>, globals: GlobalOptions) => Promise<void>;

/** Repeated on every subcommand so they work before or after the command name. */
const GLOBAL_OPTIONS: ReadonlyArray<{ key: string; flags: string; description: string }> = [
    { key: 'json', flags: '--json', description: 'Print the raw command output as one line of JSON.' },
    { key: 'verbose', flags: '--verbose', description: 'Log progress and debug detail to stderr.' },
    {
        key: 'storagePath',
        flags: '--storage-path <dir>',
        description: 'Directory holding profiles. Overrides BROWSER_PROFILES_HOME.',
    },
];

function addOption(command: Command, spec: CliOption): void {
    const option = new Option(spec.flags, spec.description);
    if (spec.kind === 'number') option.argParser((value: string) => Number(value));
    if (spec.kind === 'array') option.argParser(collectList);
    if (spec.required) option.makeOptionMandatory(true);
    command.addOption(option);
    // Defined after the value flag so commander keeps the field undefined by default.
    if (spec.clearFlag) {
        command.addOption(new Option(spec.clearFlag, `Clear ${spec.key} (sends null).`));
    }
}

function addGlobalOptions(command: Command, taken: ReadonlySet<string>): void {
    for (const global of GLOBAL_OPTIONS) {
        if (!taken.has(global.key)) command.option(global.flags, global.description);
    }
}

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function waitForShutdown(): Promise<void> {
    return new Promise((resolve) => {
        const stop = (): void => {
            for (const signal of SHUTDOWN_SIGNALS) process.off(signal, stop);
            process.stdin.off('end', stop);
            process.stdin.pause();
            resolve();
        };
        for (const signal of SHUTDOWN_SIGNALS) process.on(signal, stop);
        process.stdin.on('end', stop);
        process.stdin.resume();
    });
}

/**
 * Last resort for a death no handler survives: 'exit' allows synchronous work only,
 * so the browser gets one signal and nothing else.
 */
function killOnExit(pid: number | undefined): () => void {
    if (typeof pid !== 'number' || pid <= 0) return () => undefined;
    const kill = (): void => {
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            // Already gone, or never ours to kill.
        }
    };
    process.on('exit', kill);
    return () => process.off('exit', kill);
}

function startedPid(output: unknown): number | undefined {
    if (typeof output !== 'object' || output === null) return undefined;
    const { pid } = output as { pid?: unknown };
    return typeof pid === 'number' ? pid : undefined;
}

export function buildProgram(io: CliIo = {}): Command {
    const out = io.stdout ?? ((text: string) => void process.stdout.write(text));
    const err = io.stderr ?? ((text: string) => void process.stderr.write(text));
    const setExitCode = io.setExitCode ?? ((code: number) => void (process.exitCode = code));
    const makeContext = io.createContext ?? createCommandContext;

    const program = new Command();
    program
        .name('browser-profiles')
        .description('Self-hosted anti-detect browser profiles.')
        .version(VERSION)
        .showHelpAfterError()
        // The generated section below replaces commander's list, including its `help` entry.
        .helpCommand(false)
        .configureOutput({ writeOut: out, writeErr: err })
        .exitOverride((error) => {
            if (error.exitCode !== 0) setExitCode(error.exitCode);
            throw error;
        });
    addGlobalOptions(program, new Set());

    // Built lazily: importing the CLI must not create the storage directory.
    let context: CommandContext | undefined;
    const ctx = (globals: GlobalOptions): CommandContext => {
        if (!context) {
            context = makeContext({ storagePath: globals.storagePath, verbose: globals.verbose });
        }
        return context;
    };

    const report = (error: BrowserError, asJson: boolean): void => {
        err(asJson
            ? `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`
            : `error: ${error.message} (${error.code})\n`);
        // ADR 0001: every Err exits 1, INTERNAL included.
        setExitCode(1);
    };

    const keepAlive = async (def: AnyCommandDef, output: unknown, globals: GlobalOptions): Promise<void> => {
        err('Browser is open. Press Ctrl+C to close it and exit.\n');
        const cancelKillOnExit = killOnExit(startedPid(output));
        await waitForShutdown();
        const profileId = startedProfileId(output);
        const close = getCommand('browser.close');
        if (!profileId || !close) {
            err(`warning: "${def.name}" exposed no profile to close; the browser is still running.\n`);
            return;
        }
        const closed = await runCommand(ctx(globals), close, { idOrName: profileId });
        cancelKillOnExit();
        if (!closed.ok) report(closed.error, globals.json === true);
    };

    const execute: Execute = async (def, input, globals) => {
        let result;
        try {
            result = await runCommand(ctx(globals), def, input);
        } catch (thrown) {
            // runCommand never throws, so only building the context can: report it like any Err.
            const message = thrown instanceof Error ? thrown.message : String(thrown);
            return report({ code: 'INTERNAL', message: `Could not open the profile storage: ${message}` },
                globals.json === true);
        }
        if (!result.ok) return report(result.error, globals.json === true);

        if (globals.json === true) {
            out(`${JSON.stringify(result.data)}\n`);
        } else {
            const text = def.render(result.data);
            out(text.endsWith('\n') ? text : `${text}\n`);
        }

        if (def.cli?.keepAlive === true) await keepAlive(def, result.data, globals);
    };

    for (const def of commands) registerCommand(program, def, execute);
    registerMcp(program, ctx);
    program.addHelpText('after', renderCommandsHelp(commands));

    return program;
}

/** The nested path plus each top-level alias, all sharing one configuration. */
function registerCommand(program: Command, def: AnyCommandDef, execute: Execute): void {
    const path = cliPathFor(def);
    let parent = program;
    for (const segment of path.slice(0, -1)) {
        parent = parent.commands.find((child) => child.name() === segment)
            // Hidden at the root, which lists the generated groups instead.
            ?? parent.command(segment, { hidden: true })
                .description(`${segment} commands`)
                .helpCommand(false)
                .configureOutput(program.configureOutput());
    }
    // Visible inside its group, so "profile --help" lists what the group holds.
    configure(parent.command(path[path.length - 1]), def, execute);
    for (const alias of def.cli?.aliases ?? []) {
        configure(program.command(alias, { hidden: true }), def, execute);
    }
}

function configure(command: Command, def: AnyCommandDef, execute: Execute): void {
    const positionalKeys = def.cli?.positional ?? [];
    const specs = optionsFromSchema(def.input, positionalKeys);

    command.description(def.description);
    for (const positional of positionalsFromSchema(def.input, positionalKeys)) {
        command.argument(positional.arg, positional.description);
    }
    for (const spec of specs) addOption(command, spec);
    addGlobalOptions(command, new Set(specs.map((spec) => spec.key)));

    const aliases = def.cli?.aliases ?? [];
    if (aliases.length > 0) command.addHelpText('after', `\nAliases: ${aliases.join(', ')}\n`);
    const example = exampleFor(def);
    if (example) command.addHelpText('after', `\nExample:\n  ${example}\n`);

    command.action(async (...args: unknown[]) => {
        const self = args[args.length - 1] as Command;
        const options = self.optsWithGlobals();
        await execute(
            def,
            mergeInput(positionalKeys, args.slice(0, positionalKeys.length), options, specs),
            options as GlobalOptions
        );
    });
}

/** Dynamic import so the MCP SDK never loads for a plain CLI call. */
function registerMcp(program: Command, ctx: (globals: GlobalOptions) => CommandContext): void {
    const command = program
        .command('mcp', { hidden: true })
        .description('Serve every registry command as MCP tools over stdio.');
    addGlobalOptions(command, new Set());
    command.action(async () => {
        const globals = command.optsWithGlobals() as GlobalOptions;
        const { startMcpServer } = await import('./mcp');
        await startMcpServer({ storagePath: ctx(globals).storagePath, verbose: globals.verbose });
    });
}

async function main(): Promise<void> {
    try {
        await buildProgram().parseAsync(process.argv);
    } catch (thrown) {
        // Commander already wrote its message and the exit code is set.
        if (typeof thrown === 'object' && thrown !== null && 'exitCode' in thrown) return;
        throw thrown;
    }
}

// True only for the CommonJS bin; the ESM build of this entry never self-runs.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    void main();
}
