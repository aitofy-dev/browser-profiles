import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from './define';
import { createCommandContext, runCommand } from './define';
import { getCommand } from './registry';
import { writeLockFile } from '../storage';
import { closeLockedBrowser, isLockedBrowserAlive } from './browser-runtime';
import { assertDetachedLaunchAllowed } from '../launcher/proxy';
import type { StoredProfile } from '../types';

let storagePath: string;
let ctx: CommandContext;

beforeEach(() => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-test-'));
    ctx = createCommandContext({ storagePath });
});

afterEach(() => {
    fs.rmSync(storagePath, { recursive: true, force: true });
});

/** Stands in for Chrome's /json/version, the only liveness proof the code trusts. */
async function fakeDevTools(browserId: string): Promise<{ port: number; close: () => Promise<void> }> {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        const port = (server.address() as { port: number }).port;
        response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${browserId}` }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return {
        port: (server.address() as { port: number }).port,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

function command(name: string) {
    const def = getCommand(name);
    if (!def) throw new Error(`missing command ${name}`);
    return def;
}

async function createProfile(input: Record<string, unknown>): Promise<StoredProfile> {
    const result = await runCommand(ctx, command('profile.create'), input);
    if (!result.ok) throw new Error(result.error.message);
    return result.data as StoredProfile;
}

describe('browser lifecycle without Chrome', () => {
    it('browser.status removes a stale lock whose port does not answer', async () => {
        const profile = await createProfile({ name: 'Stale' });
        const dataDir = path.join(storagePath, 'profiles', profile.id, 'data');
        // Port 1 never answers; pid is our own so a naive liveness check would say "running".
        writeLockFile(dataDir, { pid: process.pid, port: 1, wsEndpoint: 'ws://127.0.0.1:1/x', startedAt: Date.now() });
        expect(fs.existsSync(path.join(dataDir, '.browser-lock.json'))).toBe(true);

        const status = await runCommand(ctx, command('browser.status'), {});
        expect(status.data).toEqual({ running: [] });
        expect(fs.existsSync(path.join(dataDir, '.browser-lock.json'))).toBe(false);
    });

    it('browser.close on a not-running profile returns closed:false without error', async () => {
        const profile = await createProfile({ name: 'Idle' });
        const result = await runCommand(ctx, command('browser.close'), { idOrName: profile.id });
        expect(result.ok).toBe(true);
        expect(result.data).toEqual({ profileId: profile.id, closed: false });
    });

    it('browser.close never kills the pid behind a stale lock', async () => {
        const profile = await createProfile({ name: 'Stale lock' });
        const dataDir = path.join(storagePath, 'profiles', profile.id, 'data');
        writeLockFile(dataDir, { pid: process.pid, port: 1, wsEndpoint: '', startedAt: Date.now() });

        const result = await runCommand(ctx, command('browser.close'), { idOrName: profile.id });
        expect(result.data).toEqual({ profileId: profile.id, closed: false });
        expect(fs.existsSync(path.join(dataDir, '.browser-lock.json'))).toBe(false);
        // This process is proof the stale pid was not signalled.
        expect(process.pid).toBeGreaterThan(0);
    });

    it('browser.close treats a recycled port as a stale lock', async () => {
        const profile = await createProfile({ name: 'Recycled' });
        const dataDir = path.join(storagePath, 'profiles', profile.id, 'data');
        writeLockFile(dataDir, {
            pid: process.pid,
            port: 9222,
            wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/ours',
            startedAt: Date.now(),
        });

        // Same port, another browser: killing its pid would hit an unrelated process.
        const outcome = await closeLockedBrowser(dataDir, ctx.log, {
            probe: async () => 'ws://127.0.0.1:9222/devtools/browser/someone-else',
        });

        expect(outcome).toEqual({ closed: false, wasStale: true });
        expect(fs.existsSync(path.join(dataDir, '.browser-lock.json'))).toBe(false);
    });

    it('ignores a launch claim another process is holding', async () => {
        const profile = await createProfile({ name: 'Claimed' });
        const dataDir = path.join(storagePath, 'profiles', profile.id, 'data');
        writeLockFile(dataDir, {
            pid: process.pid, port: 0, wsEndpoint: '', startedAt: Date.now(), claiming: true,
        });

        expect(await isLockedBrowserAlive(dataDir)).toBe(false);
        expect(await closeLockedBrowser(dataDir, ctx.log)).toEqual({ closed: false, wasStale: false });
        // The claim is its owner's to resolve, so it survives.
        expect(fs.existsSync(path.join(dataDir, '.browser-lock.json'))).toBe(true);

        const status = await runCommand(ctx, command('browser.status'), {});
        expect(status.data).toEqual({ running: [] });
    });

    it('profile.delete removes a profile whose lock is stale', async () => {
        const profile = await createProfile({ name: 'Crashed' });
        const dataDir = path.join(storagePath, 'profiles', profile.id, 'data');
        writeLockFile(dataDir, { pid: process.pid, port: 1, wsEndpoint: '', startedAt: Date.now() });

        const result = await runCommand(ctx, command('profile.delete'), { idOrName: profile.id });
        expect(result.data).toEqual({ id: profile.id, deleted: true });
    });

    it('profile.delete refuses while the port proves a browser is alive', async () => {
        const profile = await createProfile({ name: 'Alive' });
        const dataDir = path.join(storagePath, 'profiles', profile.id, 'data');
        const devTools = await fakeDevTools('browser-guid');
        try {
            writeLockFile(dataDir, {
                // A pid nothing owns: force must not depend on signalling it.
                pid: 0x3fff_ffff,
                port: devTools.port,
                wsEndpoint: `ws://127.0.0.1:${devTools.port}/devtools/browser/browser-guid`,
                startedAt: Date.now(),
            });

            expect(await isLockedBrowserAlive(dataDir)).toBe(true);

            const refused = await runCommand(ctx, command('profile.delete'), { idOrName: profile.id });
            expect(refused.ok).toBe(false);
            expect(refused.error?.code).toBe('INVALID_CONFIG');
            expect(await ctx.profiles.get(profile.id)).not.toBeNull();

            const forced = await runCommand(ctx, command('profile.delete'), {
                idOrName: profile.id,
                force: true,
            });
            expect(forced.data).toEqual({ id: profile.id, deleted: true });
        } finally {
            await devTools.close();
        }
    });

    it('browser.close_all reports nothing when no browser is running', async () => {
        const result = await runCommand(ctx, command('browser.close_all'), {});
        expect(result.data).toEqual({ closed: [] });
    });

    it('browser.close on an unknown profile reports PROFILE_NOT_FOUND', async () => {
        const result = await runCommand(ctx, command('browser.close'), { idOrName: 'nope' });
        expect(result.error?.code).toBe('PROFILE_NOT_FOUND');
    });
});

describe('detached launch with an authenticated proxy', () => {
    const proxy = { type: 'http' as const, host: '10.0.0.1', port: 8080, username: 'bob', password: 'x' };

    it('is refused before Chrome starts', () => {
        expect(() => assertDetachedLaunchAllowed(proxy, true)).toThrow(/authenticated proxy/i);
        expect(() => assertDetachedLaunchAllowed(proxy, false)).not.toThrow();
        expect(() => assertDetachedLaunchAllowed({ ...proxy, username: undefined }, true)).not.toThrow();
    });

    it('reaches browser.open as INVALID_CONFIG, not LAUNCH_FAILED', async () => {
        const profile = await createProfile({ name: 'Proxied', proxy: 'http://bob:x@10.0.0.1:8080' });
        ctx.profiles.launch = async () => {
            assertDetachedLaunchAllowed(profile.proxy, true);
            throw new Error('unreachable');
        };

        const result = await runCommand(ctx, command('browser.open'), {
            idOrName: profile.id,
            detached: true,
        });

        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('INVALID_CONFIG');
        expect(result.error?.message).toMatch(/authenticated proxy/i);
    });
});

describe.skipIf(!process.env.BROWSER_PROFILES_E2E)('with a real Chrome', () => {
    it('opens, reuses, reports status and closes', async () => {
        const profile = await createProfile({ name: 'E2E' });

        const opened = await runCommand(ctx, command('browser.open'), {
            idOrName: profile.id,
            headless: true,
        });
        expect(opened.ok).toBe(true);
        const first = opened.data as { wsEndpoint: string; reused: boolean; pid: number };
        expect(first.reused).toBe(false);
        expect(first.wsEndpoint).toMatch(/^ws:\/\//);

        const again = await runCommand(ctx, command('browser.open'), {
            idOrName: profile.id,
            headless: true,
        });
        expect((again.data as { reused: boolean }).reused).toBe(true);
        expect((again.data as { pid: number }).pid).toBe(first.pid);

        const status = await runCommand(ctx, command('browser.status'), {});
        expect((status.data as { running: unknown[] }).running).toHaveLength(1);

        const closed = await runCommand(ctx, command('browser.close'), { idOrName: profile.id });
        expect(closed.data).toEqual({ profileId: profile.id, closed: true });
    }, 60_000);
});
