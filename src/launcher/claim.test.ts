import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLAIM_TIMEOUT_MS, claimProfile } from './claim';
import { claimLockFile, lockFilePath, readLockFile, writeLockFile } from '../storage';
import { reuseExisting } from './reuse';
import type { StoredProfile } from '../types';

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-claim-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Virtual clock: the loop must never depend on real waiting. */
function clock(startedAt = 0) {
    let current = startedAt;
    return {
        now: () => current,
        sleep: async (ms: number): Promise<void> => {
            current += ms;
        },
        advance: (ms: number): void => void (current += ms),
    };
}

function writeClaim(startedAt: number, pid = 999_999): void {
    fs.writeFileSync(
        lockFilePath(dir),
        JSON.stringify({ pid, port: 0, wsEndpoint: '', startedAt, claiming: true })
    );
}

describe('claimProfile', () => {
    it('claims a free profile', async () => {
        const result = await claimProfile(dir, clock());

        expect(result).toEqual({ kind: 'claimed' });
        expect(readLockFile(dir)?.claiming).toBe(true);
    });

    it('reports the running browser instead of claiming', async () => {
        writeLockFile(dir, { pid: 7, port: 9222, wsEndpoint: 'ws://x/devtools/browser/a', startedAt: 5 });

        const result = await claimProfile(dir, clock(10));

        expect(result.kind).toBe('running');
        expect(result.kind === 'running' && result.lock.port).toBe(9222);
    });

    it('waits for a fresh claim and reuses the browser it produces', async () => {
        const time = clock(1_000);
        writeClaim(1_000);
        let polls = 0;
        const sleep = async (ms: number): Promise<void> => {
            time.advance(ms);
            polls += 1;
            // The other process finished launching while we waited.
            if (polls === 2) {
                writeLockFile(dir, { pid: 7, port: 9333, wsEndpoint: 'ws://x/devtools/browser/b', startedAt: 1_200 });
            }
        };

        const result = await claimProfile(dir, { now: time.now, sleep });

        expect(polls).toBe(2);
        expect(result.kind).toBe('running');
        expect(result.kind === 'running' && result.lock.port).toBe(9333);
    });

    it('takes over a claim whose owner died before Chrome came up', async () => {
        const time = clock(CLAIM_TIMEOUT_MS + 1_000);
        writeClaim(0);

        const result = await claimProfile(dir, time);

        expect(result).toEqual({ kind: 'claimed' });
        expect(readLockFile(dir)?.pid).toBe(process.pid);
    });

    it('takes over a lock file it cannot read', async () => {
        fs.writeFileSync(lockFilePath(dir), 'not json');

        const result = await claimProfile(dir, clock());

        expect(result).toEqual({ kind: 'claimed' });
        expect(readLockFile(dir)?.claiming).toBe(true);
    });

    it('leaves an existing claim in place while it is fresh', async () => {
        const time = clock(1_000);
        writeClaim(1_000, 4_242);
        // Give up after the deadline instead of blocking forever.
        const result = await claimProfile(dir, { now: time.now, sleep: async (ms) => void time.advance(ms) });

        expect(result).toEqual({ kind: 'claimed' });
    });

    it('never claims twice from one directory', async () => {
        expect((await claimProfile(dir, clock())).kind).toBe('claimed');
        expect(claimLockFile(dir).claimed).toBe(false);
    });
});

describe('reuseExisting', () => {
    const profile = { id: 'p1', name: 'Reuse', createdAt: 0, updatedAt: 0 } as StoredProfile;
    const lock = { pid: 4_242, port: 9222, wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/ours', startedAt: 1 };

    it('reuses the browser that wrote the lock', async () => {
        writeLockFile(dir, lock);
        const reused = await reuseExisting(profile, dir, lock, async () => lock.wsEndpoint);

        expect(reused?.wsEndpoint).toBe(lock.wsEndpoint);
        expect(reused?.reused).toBe(true);
    });

    it('drops the lock when the port answers for another browser', async () => {
        writeLockFile(dir, lock);
        const reused = await reuseExisting(profile, dir, lock, async () =>
            'ws://127.0.0.1:9222/devtools/browser/someone-else');

        expect(reused).toBeNull();
        expect(readLockFile(dir)).toBeNull();
    });

    it('never reuses a claim', async () => {
        expect(await reuseExisting(profile, dir, { ...lock, claiming: true }, async () => lock.wsEndpoint)).toBeNull();
    });
});
