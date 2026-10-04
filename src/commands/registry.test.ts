import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from './define';
import { cliPathFor, createCommandContext, mcpToolNameFor, resolveProfile, runCommand } from './define';
import { commands, getCommand } from './registry';
import { resolveStoragePath } from '../storage';
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

describe('registry shape', () => {
    it('exposes the ADR command set with unique names', () => {
        const names = commands.map((c) => c.name);
        expect(names).toEqual([
            'profile.list',
            'profile.get',
            'profile.create',
            'profile.update',
            'profile.delete',
            'profile.duplicate',
            'browser.open',
            'browser.launch',
            'browser.close',
            'browser.close_all',
            'browser.status',
            'storage.path',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });

    it('describes every input field', () => {
        for (const def of commands) {
            expect(def.description.length).toBeGreaterThan(10);
            for (const [key, field] of Object.entries(def.input.shape)) {
                expect(field.description, `${def.name}.${key}`).toBeTruthy();
            }
        }
    });

    it('maps names to CLI paths and MCP tool names', () => {
        expect(cliPathFor(command('profile.list'))).toEqual(['profile', 'list']);
        expect(cliPathFor(command('browser.close_all'))).toEqual(['browser', 'close-all']);
        expect(mcpToolNameFor(command('browser.open'))).toBe('browser_open');
        expect(mcpToolNameFor(command('browser.close_all'))).toBe('browser_close_all');
    });
});

describe('resolveStoragePath', () => {
    const original = process.env.BROWSER_PROFILES_HOME;
    afterEach(() => {
        if (original === undefined) delete process.env.BROWSER_PROFILES_HOME;
        else process.env.BROWSER_PROFILES_HOME = original;
    });

    it('prefers the explicit path over the env var', () => {
        process.env.BROWSER_PROFILES_HOME = '/tmp/from-env';
        expect(resolveStoragePath('/tmp/explicit')).toBe('/tmp/explicit');
        expect(resolveStoragePath()).toBe('/tmp/from-env');
    });

    it('falls back to the default when nothing is set', () => {
        delete process.env.BROWSER_PROFILES_HOME;
        expect(resolveStoragePath()).toBe(path.join(os.homedir(), '.aitofy', 'browser-profiles'));
    });
});

describe('profile CRUD through runCommand', () => {
    it('creates, reads, lists, updates, duplicates and deletes', async () => {
        const created = await createProfile({
            name: 'Acme Main',
            id: 'acme-main',
            proxy: 'http://bob:p%40ss@10.0.0.1:8080',
            timezone: 'Asia/Ho_Chi_Minh',
            language: 'vi-VN',
            tags: ['acme'],
        });
        expect(created.id).toBe('acme-main');
        expect(created.proxy).toEqual({
            type: 'http', host: '10.0.0.1', port: 8080, username: 'bob', password: 'p@ss',
        });

        const listed = await runCommand(ctx, command('profile.list'), {});
        expect((listed.data as StoredProfile[]).map((p) => p.id)).toEqual(['acme-main']);

        const filteredOut = await runCommand(ctx, command('profile.list'), { tag: 'other' });
        expect(filteredOut.data).toEqual([]);

        const updated = await runCommand(ctx, command('profile.update'), {
            idOrName: 'Acme Main',
            name: 'Acme Renamed',
            proxy: null,
        });
        expect(updated.ok).toBe(true);
        expect((updated.data as StoredProfile).proxy).toBeNull();
        expect((updated.data as StoredProfile).fingerprint?.language).toBe('vi-VN');

        const copy = await runCommand(ctx, command('profile.duplicate'), { idOrName: 'acme-main' });
        expect(copy.ok).toBe(true);
        expect((copy.data as StoredProfile).id).not.toBe('acme-main');
        expect((copy.data as StoredProfile).name).toBe('Acme Renamed (Copy)');

        const deleted = await runCommand(ctx, command('profile.delete'), { idOrName: 'acme-main' });
        expect(deleted.data).toEqual({ id: 'acme-main', deleted: true });
        expect((await runCommand(ctx, command('profile.get'), { idOrName: 'acme-main' })).ok).toBe(false);
    });

    it('rejects a duplicate id with INVALID_CONFIG', async () => {
        await createProfile({ name: 'One', id: 'dup' });
        const again = await runCommand(ctx, command('profile.create'), { name: 'Two', id: 'dup' });
        expect(again.ok).toBe(false);
        expect(again.error?.code).toBe('INVALID_CONFIG');
    });

    it('refuses an id reserved for temporary sessions', async () => {
        const result = await runCommand(ctx, command('profile.create'), { name: 'Temp', id: 'tmp-1234' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('INVALID_CONFIG');
        expect(result.error?.message).toContain('tmp-');
    });

    it('refuses an idOrName that could walk out of the storage directory', async () => {
        for (const idOrName of ['../../etc/passwd', 'a/b', '..']) {
            const result = await runCommand(ctx, command('profile.get'), { idOrName });
            expect(result.ok, idOrName).toBe(false);
            expect(result.error?.code, idOrName).toBe('INVALID_CONFIG');
        }
        expect(await ctx.profiles.get('../../etc/passwd')).toBeNull();
        expect(await ctx.profiles.get('..')).toBeNull();
    });

    it('rejects an invalid proxy URL with INVALID_CONFIG', async () => {
        const result = await runCommand(ctx, command('profile.create'), {
            name: 'Bad proxy',
            proxy: 'http://10.0.0.1',
        });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('INVALID_CONFIG');
        expect(result.error?.message).toMatch(/no port/i);
    });
});

describe('zod validation', () => {
    it('maps missing required input to INVALID_CONFIG', async () => {
        const result = await runCommand(ctx, command('profile.create'), {});
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('INVALID_CONFIG');
        expect(result.error?.message).toContain('name');
    });

    it('maps a wrong type to INVALID_CONFIG', async () => {
        const result = await runCommand(ctx, command('profile.list'), { tag: 42 });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('INVALID_CONFIG');
        expect(result.error?.message).toMatch(/tag/);
    });

    it('accepts undefined raw input for a no-arg command', async () => {
        const result = await runCommand(ctx, command('storage.path'), undefined);
        expect(result.data).toEqual({ path: storagePath });
    });
});

describe('resolveProfile', () => {
    beforeEach(async () => {
        await createProfile({ name: 'Google Main', id: 'google-main' });
        await createProfile({ name: 'Facebook Ads', id: 'fb-ads' });
    });

    it('finds by id', async () => {
        const found = await resolveProfile(ctx, 'google-main');
        expect(found.data?.name).toBe('Google Main');
    });

    it('finds by name, case-insensitively', async () => {
        const found = await resolveProfile(ctx, 'google main');
        expect(found.data?.id).toBe('google-main');
    });

    it('misses with a "did you mean" hint built from a case-insensitive prefix', async () => {
        const missed = await resolveProfile(ctx, 'GOOGLE');
        expect(missed.ok).toBe(false);
        expect(missed.error?.code).toBe('PROFILE_NOT_FOUND');
        expect(missed.error?.message).toContain('Did you mean');
        expect(missed.error?.message).toContain('google-main');
        expect(missed.error?.message).not.toContain('fb-ads');
    });

    it('misses with a substring hint', async () => {
        const missed = await resolveProfile(ctx, 'ads');
        expect(missed.error?.message).toContain('Facebook Ads');
    });

    it('falls back to a list hint when nothing is close', async () => {
        const missed = await resolveProfile(ctx, 'zzzzz');
        expect(missed.error?.message).toContain('profile list');
    });
});

describe('atomic config writes', () => {
    it('leaves no .tmp file behind', async () => {
        const profile = await createProfile({ name: 'Atomic' });
        const dir = path.join(storagePath, 'profiles', profile.id);
        await runCommand(ctx, command('profile.update'), { idOrName: profile.id, notes: 'changed' });

        const entries = fs.readdirSync(dir);
        expect(entries).toContain('config.json');
        expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8')).notes).toBe('changed');
    });
});

describe('real fingerprint mode', () => {
    it('round-trips create, get, list and update without spoof settings', async () => {
        const created = await createProfile({ name: 'Google Main', fingerprint: 'real' });
        expect(created.fingerprint).toEqual({ mode: 'real' });
        expect(created.timezone).toBeUndefined();

        const got = await runCommand(ctx, command('profile.get'), { idOrName: 'Google Main' });
        expect((got.data as StoredProfile).fingerprint).toEqual({ mode: 'real' });
        const listed = await runCommand(ctx, command('profile.list'), {});
        expect((listed.data as StoredProfile[])[0].fingerprint?.mode).toBe('real');
        expect(command('profile.list').render(listed.data)).toContain('| real ');

        const updated = await runCommand(ctx, command('profile.update'), { idOrName: created.id, language: 'vi-VN' });
        expect((updated.data as StoredProfile).fingerprint).toEqual({ mode: 'real', language: 'vi-VN' });
        expect(command('profile.get').render(updated.data)).toContain('Fingerprint: real');
    });

    it('rejects platform on a real profile at create and update', async () => {
        const create = await runCommand(ctx, command('profile.create'), {
            name: 'Bad', fingerprint: 'real', platform: 'Win32',
        });
        expect(create.ok).toBe(false);
        expect(create.error?.code).toBe('INVALID_CONFIG');
        expect(create.error?.message).toContain('platform');

        const real = await createProfile({ name: 'Real', fingerprint: 'real' });
        const update = await runCommand(ctx, command('profile.update'), { idOrName: real.id, platform: 'Win32' });
        expect(update.error?.code).toBe('INVALID_CONFIG');
    });

    it('switches an existing profile to real and back', async () => {
        const spoofed = await createProfile({ name: 'Switch', language: 'de-DE', platform: 'MacIntel' });
        const real = await runCommand(ctx, command('profile.update'), { idOrName: spoofed.id, fingerprint: 'real' });
        expect((real.data as StoredProfile).fingerprint).toEqual({ mode: 'real', language: 'de-DE' });
        // The create-time New York default must not follow the profile into real mode.
        expect((real.data as StoredProfile).timezone).toBeUndefined();

        const back = await runCommand(ctx, command('profile.update'), { idOrName: spoofed.id, fingerprint: 'generated' });
        const fingerprint = (back.data as StoredProfile).fingerprint;
        expect(fingerprint?.mode).toBeUndefined();
        expect(fingerprint?.language).toBe('de-DE');
        expect(fingerprint && 'webgl' in fingerprint && fingerprint.webgl?.renderer).toBeTruthy();

        const pinned = await runCommand(ctx, command('profile.update'), {
            idOrName: spoofed.id, fingerprint: 'real', timezone: 'Asia/Tokyo',
        });
        expect((pinned.data as StoredProfile).timezone).toBe('Asia/Tokyo');
    });

    it('leaves a default profile as it was: generated, New York, a stored GPU', async () => {
        const created = await createProfile({ name: 'Default' });
        expect(created.timezone).toBe('America/New_York');
        expect(created.fingerprint?.mode).toBeUndefined();
        const stored = JSON.parse(
            fs.readFileSync(path.join(storagePath, 'profiles', created.id, 'config.json'), 'utf-8')
        );
        expect(stored.fingerprint).not.toHaveProperty('mode');
        expect(stored.fingerprint.webgl.renderer).toBeTruthy();
    });
});
