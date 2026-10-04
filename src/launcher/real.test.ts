import { describe, expect, it } from 'vitest';
import type { StoredProfile } from '../types';
import type { CdpClient, CdpEventListener } from './deps';
import { launchErrorCode } from '../commands/browser-open';
import { realEngineConflictMessage, resolveProfileEngine, startRealSession } from './real';

const real: StoredProfile = { id: 'r', name: 'Real', createdAt: 0, updatedAt: 0, fingerprint: { mode: 'real' } };
const generated: StoredProfile = { id: 'g', name: 'Gen', createdAt: 0, updatedAt: 0 };

function fakeClient() {
    const calls: string[] = [];
    const listeners = new Map<string, CdpEventListener>();
    const client: CdpClient = {
        send: async (method) => {
            calls.push(method);
            return {};
        },
        on: (event, listener) => void listeners.set(event, listener),
        close: async () => undefined,
    };
    return { client, calls, emit: (event: string) => listeners.get(event)?.({}) };
}

describe('resolveProfileEngine', () => {
    it('opens a real profile real without reading the binary', () => {
        const probe = () => {
            throw new Error('binary must not be read');
        };
        expect(resolveProfileEngine(real, undefined, probe)).toBe('real');
        expect(resolveProfileEngine(real, 'auto', probe)).toBe('real');
    });

    it('resolves a generated profile exactly as before', () => {
        expect(resolveProfileEngine(generated, undefined, () => false)).toBe('inject');
        expect(resolveProfileEngine(generated, undefined, () => true)).toBe('kernel');
        expect(resolveProfileEngine(generated, 'inject', () => true)).toBe('inject');
    });
});

describe('startRealSession', () => {
    it('only watches for exit: no command reaches the browser', async () => {
        const fake = fakeClient();
        let gone = 0;
        const release = await startRealSession({
            connect: async () => fake.client, profile: real, detached: false, onDisconnect: () => gone++,
        });
        expect(fake.calls).toEqual([]);
        fake.emit('disconnect');
        expect(gone).toBe(1);
        await release?.();
    });

    it('installs stored cookies and nothing else', async () => {
        const fake = fakeClient();
        const withCookies = { ...real, cookies: [{ name: 'sid', value: '1', domain: 'example.com' }] };
        await startRealSession({
            connect: async () => fake.client, profile: withCookies, detached: true, onDisconnect: () => undefined,
        });
        expect(fake.calls).toEqual(['Storage.setCookies']);
    });

    it('does not connect at all when detached with no cookies', async () => {
        const connect = async (): Promise<CdpClient> => {
            throw new Error('must not connect');
        };
        const release = await startRealSession({ connect, profile: real, detached: true, onDisconnect: () => undefined });
        expect(release).toBeUndefined();
    });
});

describe('realEngineConflictMessage', () => {
    it('is reported as a configuration mistake, not a launch failure', () => {
        expect(launchErrorCode(realEngineConflictMessage('Google Main', 'kernel'))).toBe('INVALID_CONFIG');
    });
});
