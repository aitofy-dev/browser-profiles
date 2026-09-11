import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, trackLifecycle } from './mcp';
import { commands, createCommandContext, mcpToolNameFor } from './commands/registry';

let storagePath: string;
let client: Client;
let stdout: ReturnType<typeof vi.spyOn>;

/** stdout belongs to the JSON-RPC stream; a single stray write breaks stdio. */
function expectSilentStdout(): void {
    expect(stdout).not.toHaveBeenCalled();
}

function textOf(result: CallToolResult): string {
    const first = result.content[0];
    return first && first.type === 'text' ? first.text : '';
}

function jsonOf(result: CallToolResult): Record<string, unknown> {
    return JSON.parse(textOf(result)) as Record<string, unknown>;
}

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

beforeAll(async () => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-mcp-'));
    const server = createMcpServer(createCommandContext({ storagePath }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test', version: '0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
    expectSilentStdout();
});

afterAll(async () => {
    stdout.mockRestore();
    await client.close();
    fs.rmSync(storagePath, { recursive: true, force: true });
});

describe('MCP server', () => {
    it('exposes exactly one tool per registry entry', async () => {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name).sort();
        expect(names).toEqual(commands.map(mcpToolNameFor).sort());
    });

    it('derives each inputSchema from the command zod shape', async () => {
        const { tools } = await client.listTools();

        for (const def of commands) {
            const tool = tools.find((candidate) => candidate.name === mcpToolNameFor(def));
            expect(tool, def.name).toBeDefined();
            expect(tool?.inputSchema.type).toBe('object');
            const properties = (tool?.inputSchema.properties ?? {}) as Record<string, unknown>;
            expect(Object.keys(properties).sort(), def.name).toEqual(Object.keys(def.input.shape).sort());
        }
    });

    it('leaves a zod default optional in the MCP schema', async () => {
        const { tools } = await client.listTools();
        const launch = tools.find((tool) => tool.name === 'browser_launch');

        expect(Object.keys(launch?.inputSchema.properties ?? {})).toContain('randomFingerprint');
        expect((launch?.inputSchema.required ?? []) as string[]).not.toContain('randomFingerprint');
    });

    it('annotates read-only and destructive tools', async () => {
        const { tools } = await client.listTools();
        const byName = new Map(tools.map((tool) => [tool.name, tool]));

        expect(byName.get('profile_list')?.annotations?.readOnlyHint).toBe(true);
        expect(byName.get('profile_delete')?.annotations?.destructiveHint).toBe(true);
        expect(byName.get('profile_create')?.annotations?.destructiveHint).toBe(false);
    });

    it('teaches the agent what to do with wsEndpoint', async () => {
        const { tools } = await client.listTools();
        const open = tools.find((tool) => tool.name === 'browser_open');

        expect(open?.description).toContain('--cdp-endpoint');
        expect(open?.description).toContain('connectOverCDP');
        expect(open?.description).toContain('reused=true');
    });

    it('round-trips profile_create and profile_list', async () => {
        const created = await call('profile_create', { name: 'MCP Test', timezone: 'Europe/Berlin' });
        expect(created.isError).toBeFalsy();
        const profile = jsonOf(created);
        expect(profile.name).toBe('MCP Test');

        const listed = await call('profile_list', {});
        const profiles = JSON.parse(textOf(listed)) as Array<{ id: string }>;
        expect(profiles.map((entry) => entry.id)).toContain(profile.id);
    });

    it('maps a missing profile to isError with PROFILE_NOT_FOUND', async () => {
        const result = await call('profile_get', { idOrName: 'does-not-exist' });

        expect(result.isError).toBe(true);
        expect(jsonOf(result).code).toBe('PROFILE_NOT_FOUND');
    });

    it('rejects wrong argument types before the command runs', async () => {
        const result = await call('profile_get', { idOrName: 42 });

        // The SDK validates against the same zod shape and fails the call first,
        // so runCommand's INVALID_CONFIG is unreachable for type errors.
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('Input validation error');
    });

    it('reports the storage path it was created with', async () => {
        const result = await call('storage_path', {});
        expect(jsonOf(result).path).toBe(storagePath);
    });
});

describe('browser ownership', () => {
    it('owns what it launched and leaves reused or detached browsers alone', () => {
        const owned = new Set<string>();

        trackLifecycle('browser.open', { profileId: 'mine', reused: false }, owned);
        trackLifecycle('browser.launch', { profileId: 'tmp-1', temporary: true }, owned);
        trackLifecycle('browser.open', { profileId: 'theirs', reused: true }, owned);
        trackLifecycle('browser.open', { profileId: 'loose', detached: true }, owned);

        expect([...owned]).toEqual(['mine', 'tmp-1']);
    });

    it('forgets browsers closed through the tools', () => {
        const owned = new Set(['a', 'b']);

        trackLifecycle('browser.close', { profileId: 'a', closed: true }, owned);
        expect([...owned]).toEqual(['b']);

        trackLifecycle('browser.close_all', { closed: ['b'] }, owned);
        expect(owned.size).toBe(0);
    });
});
