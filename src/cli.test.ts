import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildProgram } from './cli';
import { optionsFromSchema, positionalsFromSchema, renderCommandsHelp } from './cli-render';
import type { CliIo } from './cli';
import { cliPathFor, commands, createCommandContext } from './commands/registry';
import type { CommandContext } from './commands/registry';

// ---------------------------------------------------------------------------
// optionsFromSchema
// ---------------------------------------------------------------------------

const matrix = z.object({
    name: z.string().describe('Required name.'),
    startUrl: z.string().optional().describe('Optional URL.'),
    headless: z.boolean().optional().describe('Boolean flag.'),
    randomFingerprint: z.boolean().default(true).describe('Defaults to true.'),
    port: z.number().optional().describe('A number.'),
    tags: z.array(z.string()).optional().describe('A list.'),
    mode: z.enum(['fast', 'slow']).optional().describe('An enum.'),
    notes: z.string().nullable().optional().describe('Nullable and optional.'),
});

function optionFor(key: string) {
    const found = optionsFromSchema(matrix).find((option) => option.key === key);
    if (!found) throw new Error(`no option derived for "${key}"`);
    return found;
}

describe('optionsFromSchema', () => {
    it('maps a required string to a mandatory value flag', () => {
        expect(optionFor('name')).toMatchObject({
            flags: '--name <value>',
            kind: 'string',
            required: true,
            description: 'Required name.',
        });
    });

    it('respects optional fields', () => {
        expect(optionFor('startUrl')).toMatchObject({ flags: '--start-url <value>', required: false });
    });

    it('turns booleans into flags without a value', () => {
        expect(optionFor('headless')).toMatchObject({ flags: '--headless', kind: 'boolean', negated: false });
    });

    it('negates booleans that default to true', () => {
        expect(optionFor('randomFingerprint')).toMatchObject({
            flags: '--no-random-fingerprint',
            kind: 'boolean',
            negated: true,
            required: false,
        });
    });

    it('marks numbers so they can be parsed', () => {
        expect(optionFor('port')).toMatchObject({ flags: '--port <number>', kind: 'number' });
    });

    it('documents repeatable array flags', () => {
        const option = optionFor('tags');
        expect(option).toMatchObject({ flags: '--tags <value...>', kind: 'array' });
        expect(option.description).toContain('comma-separated');
    });

    it('lists enum members in the help text', () => {
        const option = optionFor('mode');
        expect(option).toMatchObject({ kind: 'string', choices: ['fast', 'slow'] });
        expect(option.description).toContain('One of: fast, slow.');
    });

    it('unwraps nullable inside optional', () => {
        expect(optionFor('notes')).toMatchObject({ flags: '--notes <value>', kind: 'string', required: false });
    });

    it('skips keys claimed by positionals', () => {
        const keys = optionsFromSchema(matrix, ['name']).map((option) => option.key);
        expect(keys).not.toContain('name');
        expect(keys).toContain('startUrl');
    });
});

describe('positionalsFromSchema', () => {
    it('brackets optional positionals and angles required ones', () => {
        expect(positionalsFromSchema(matrix, ['name', 'startUrl'])).toEqual([
            { key: 'name', arg: '<name>', description: 'Required name.' },
            { key: 'startUrl', arg: '[startUrl]', description: 'Optional URL.' },
        ]);
    });

    it('ignores keys the schema does not declare', () => {
        expect(positionalsFromSchema(matrix, ['nope'])).toEqual([]);
    });
});

describe('renderCommandsHelp', () => {
    it('groups by the first path segment and shows aliases', () => {
        const help = renderCommandsHelp(commands);
        expect(help).toContain('  profile');
        expect(help).toContain('(aliases: list, ls)');
    });
});

// ---------------------------------------------------------------------------
// buildProgram
// ---------------------------------------------------------------------------

interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

let storage: string;

beforeEach(() => {
    storage = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cli-'));
});

afterEach(() => {
    fs.rmSync(storage, { recursive: true, force: true });
});

async function run(argv: string[], io: Pick<CliIo, 'createContext'> = {}): Promise<RunResult> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode = 0;
    const program = buildProgram({
        stdout: (text) => void stdout.push(text),
        stderr: (text) => void stderr.push(text),
        setExitCode: (code) => void (exitCode = code),
        createContext: io.createContext,
    });

    try {
        await program.parseAsync(argv, { from: 'user' });
    } catch {
        // Commander signals help and usage errors by throwing; the code is captured above.
    }

    return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode };
}

const noop = (): void => undefined;

const withStorage = (argv: string[]): string[] => ['--storage-path', storage, ...argv];

describe('cli commands', () => {
    it('round-trips a created profile through list --json', async () => {
        const created = await run(withStorage(['profile', 'create', 'Acme', '--tags', 'a,b', '--json']));
        expect(created.exitCode).toBe(0);
        const profile = JSON.parse(created.stdout) as { id: string; name: string; tags?: string[] };
        expect(profile.name).toBe('Acme');
        expect(profile.tags).toEqual(['a', 'b']);

        const listed = await run(withStorage(['list', '--json']));
        expect(listed.stderr).toBe('');
        expect(listed.stdout.trimEnd().split('\n')).toHaveLength(1);
        expect(JSON.parse(listed.stdout)).toEqual([profile]);
    });

    it('renders human output when --json is absent', async () => {
        await run(withStorage(['create', 'Acme']));
        const listed = await run(withStorage(['ls']));
        expect(listed.stdout).toContain('Acme');
        expect(listed.stdout).not.toContain('{');
    });

    it('accepts global flags before or after the command name', async () => {
        const before = await run(['--json', '--storage-path', storage, 'list']);
        expect(JSON.parse(before.stdout)).toEqual([]);
    });

    it('reports errors on stderr with exit code 1 and nothing on stdout', async () => {
        const result = await run(withStorage(['profile', 'get', 'missing']));
        expect(result.stdout).toBe('');
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('error: Profile not found: "missing".');
        expect(result.stderr).toContain('(PROFILE_NOT_FOUND)');
    });

    it('hints at close matches for an unknown profile', async () => {
        await run(withStorage(['create', 'Google Main']));
        const result = await run(withStorage(['info', 'goog']));
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Did you mean: Google Main (');
    });

    it('prints errors as JSON on stderr when --json is set', async () => {
        const result = await run(withStorage(['profile', 'get', 'missing', '--json']));
        expect(result.stdout).toBe('');
        const payload = JSON.parse(result.stderr) as { error: { code: string; message: string } };
        expect(payload.error.code).toBe('PROFILE_NOT_FOUND');
    });

    it('exits 1 when a command throws unexpectedly', async () => {
        const context: CommandContext = createCommandContext({ storagePath: storage });
        context.profiles.list = async () => {
            throw new Error('disk on fire');
        };
        context.log = { debug: noop, info: noop, warn: noop, error: noop };
        const result = await run(withStorage(['list']), { createContext: () => context });
        expect(result.stdout).toBe('');
        // ADR 0001: every Err is exit code 1.
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('(INTERNAL)');
    });

    it('reports an unusable storage path instead of crashing', async () => {
        const file = path.join(storage, 'a-file');
        fs.writeFileSync(file, 'not a directory');

        const result = await run(['--storage-path', path.join(file, 'nested'), 'list', '--json']);
        expect(result.stdout).toBe('');
        expect(result.exitCode).toBe(1);
        expect(JSON.parse(result.stderr).error.code).toBe('INTERNAL');
    });

    it('rejects invalid input through the schema, not the parser', async () => {
        const result = await run(withStorage(['create', 'Acme', '--proxy', 'not-a-url']));
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('error:');
    });

    it('clears a nullable field through --no-<flag>', async () => {
        const created = await run(withStorage([
            'create', 'Proxied', '--proxy', 'http://bob:x@10.0.0.1:8080', '--json',
        ]));
        const profile = JSON.parse(created.stdout) as { id: string; proxy: unknown };
        expect(profile.proxy).toMatchObject({ host: '10.0.0.1' });

        const cleared = await run(withStorage(['profile', 'update', profile.id, '--no-proxy', '--json']));
        expect(cleared.exitCode).toBe(0);
        expect((JSON.parse(cleared.stdout) as { proxy: unknown }).proxy).toBeNull();

        const stored = await run(withStorage(['profile', 'get', profile.id, '--json']));
        expect((JSON.parse(stored.stdout) as { proxy: unknown }).proxy).toBeNull();
    });

    it('rejects an idOrName that looks like a path', async () => {
        const result = await run(withStorage(['profile', 'get', '../../etc/passwd']));
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('INVALID_CONFIG');
    });

    it('respects --storage-path and prints the resolved path', async () => {
        const result = await run(withStorage(['path', '--json']));
        expect(JSON.parse(result.stdout)).toEqual({ path: path.resolve(storage) });
    });

    it('falls back to BROWSER_PROFILES_HOME when --storage-path is absent', async () => {
        const previous = process.env.BROWSER_PROFILES_HOME;
        process.env.BROWSER_PROFILES_HOME = storage;
        try {
            const result = await run(['path', '--json']);
            expect(JSON.parse(result.stdout)).toEqual({ path: path.resolve(storage) });
        } finally {
            if (previous === undefined) delete process.env.BROWSER_PROFILES_HOME;
            else process.env.BROWSER_PROFILES_HOME = previous;
        }
    });
});

describe('cli help', () => {
    it('lists every registry command and its aliases', async () => {
        const result = await run(['--help']);
        for (const def of commands) {
            expect(result.stdout).toContain(cliPathFor(def).join(' '));
            for (const alias of def.cli?.aliases ?? []) expect(result.stdout).toContain(alias);
        }
        expect(result.stdout).toContain('mcp');
    });

    it('offers a way to clear a nullable field and to turn a defaulted flag off', async () => {
        const update = await run(['profile', 'update', '--help']);
        expect(update.stdout).toContain('--proxy <value>');
        expect(update.stdout).toContain('--no-proxy');

        const launch = await run(['browser', 'launch', '--help']);
        expect(launch.stdout).toContain('--no-random-fingerprint');
    });

    it('shows per-command help for the nested path, not the root list', async () => {
        const nested = await run(['profile', 'list', '--help']);
        expect(nested.stdout).toContain('List stored browser profiles');
        expect(nested.stdout).toContain('--group-id <value>');
        expect(nested.stdout).toContain('--tag <value>');
        // The grouped root list must not leak into a single command's help.
        expect(nested.stdout).not.toContain('Run "browser-profiles <command> --help"');
        expect(nested.stdout).toBe((await run(['ls', '--help'])).stdout.replace('browser-profiles ls', 'browser-profiles profile list'));
    });

    it('documents every derived flag on the command help', async () => {
        const result = await run(['profile', 'create', '--help']);
        expect(result.stdout).toContain('--proxy <value>');
        expect(result.stdout).toContain('--tags <value...>');
        expect(result.stdout).toContain('<name>');
        expect(result.stdout).toContain('Aliases: create');
    });
});
