import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchResult, StoredProfile } from '../types';
import { readLockFile } from '../storage';
import type { CdpParams } from './deps';
import { launchChrome } from './launch';

// Chrome and its DevTools socket are faked; everything between them is the real launcher.
const fake = vi.hoisted(() => ({
    port: 0,
    launches: [] as Array<{ chromeFlags: string[]; envVars?: Record<string, string> }>,
    cdpCalls: [] as string[],
}));

vi.mock('./deps', () => ({
    loadChromeLauncher: async () => ({
        launch: async (options: { chromeFlags: string[]; envVars?: Record<string, string> }) => {
            fake.launches.push(options);
            return { port: fake.port, pid: 2_000_000_000, kill: async () => undefined };
        },
    }),
    loadCdp: async () => async () => ({
        send: async (method: string): Promise<CdpParams> => {
            fake.cdpCalls.push(method);
            if (method === 'Browser.getVersion') return { product: 'Chrome/150.0.7000.1' };
            if (method === 'Target.getTargets') return { targetInfos: [] };
            return {};
        },
        on: () => undefined,
        close: async () => undefined,
    }),
}));

let server: http.Server;
let dir: string;
let chromePath: string;
let launched: LaunchResult | null = null;

beforeEach(async () => {
    fake.launches.length = 0;
    fake.cdpCalls.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-'));
    chromePath = path.join(dir, 'chrome');
    fs.writeFileSync(chromePath, 'stock chrome');
    server = http.createServer((_request, response) => {
        response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${fake.port}/devtools/browser/fake` }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    fake.port = (server.address() as { port: number }).port;
});

afterEach(async () => {
    if (launched) await launched.close();
    launched = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
});

const realProfile: StoredProfile = {
    id: 'real-1', name: 'Google Main', createdAt: 0, updatedAt: 0, fingerprint: { mode: 'real' },
};

function launch(profile: StoredProfile, engine?: 'auto' | 'kernel' | 'inject'): Promise<LaunchResult> {
    return launchChrome({ profile, userDataDir: path.join(dir, 'data'), chromePath, engine });
}

const SPOOF_FLAG = /^--(fingerprint|lang=|accept-lang|timezone|disable-features=IsolateOrigins|webrtc-ip)/;

describe('launchChrome with a real profile', () => {
    it('passes no fingerprint flag, no TZ and sends no override to any tab', async () => {
        launched = await launch(realProfile);

        expect(launched.engine).toBe('real');
        const [{ chromeFlags, envVars }] = fake.launches;
        expect(chromeFlags.filter((flag) => SPOOF_FLAG.test(flag))).toEqual([]);
        expect(envVars).toBeUndefined();
        expect(fake.cdpCalls).toEqual([]);
        expect(readLockFile(path.join(dir, 'data'))?.engine).toBe('real');
    });

    it('applies only the timezone and language the profile pins itself', async () => {
        launched = await launch({
            ...realProfile, timezone: 'Asia/Ho_Chi_Minh', fingerprint: { mode: 'real', language: 'vi-VN' },
        });

        const [{ chromeFlags, envVars }] = fake.launches;
        expect(envVars).toEqual({ TZ: 'Asia/Ho_Chi_Minh' });
        expect(chromeFlags).toContain('--lang=vi-VN');
        expect(fake.cdpCalls).toEqual([]);
    });

    it('refuses the kernel engine before Chrome starts and releases the profile', async () => {
        await expect(launch(realProfile, 'kernel')).rejects.toThrow(/real.*engine "kernel".*--fingerprint generated/s);
        await expect(launch(realProfile, 'inject')).rejects.toThrow(/engine "inject"/);
        expect(fake.launches).toEqual([]);
        expect(readLockFile(path.join(dir, 'data'))).toBeNull();
    });
});

describe('launchChrome with a generated profile', () => {
    it('still spoofs: TZ, --lang, anti-detect flags and auto-attach', async () => {
        launched = await launch({ id: 'gen-1', name: 'Gen', createdAt: 0, updatedAt: 0, timezone: 'Europe/Paris' });

        expect(launched.engine).toBe('inject');
        const [{ chromeFlags, envVars }] = fake.launches;
        expect(envVars).toEqual({ TZ: 'Europe/Paris' });
        expect(chromeFlags).toEqual(expect.arrayContaining([
            '--lang=en-US',
            '--disable-features=IsolateOrigins,site-per-process',
            '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        ]));
        expect(fake.cdpCalls).toEqual(expect.arrayContaining(['Browser.getVersion', 'Target.setAutoAttach']));
    });
});
