import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    claimLockFile,
    deleteLockFile,
    lockFilePath,
    readLockFile,
    sameBrowser,
    writeJsonAtomic,
    writeLockFile,
} from './storage';

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-storage-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeJsonAtomic', () => {
    it('never reuses a temp name between writers', () => {
        const target = path.join(dir, 'config.json');
        writeJsonAtomic(target, { a: 1 });
        writeJsonAtomic(target, { a: 2 });

        expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ a: 2 });
        expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([]);
    });

    it('leaves the temp file of a failed write behind nothing', () => {
        const target = path.join(dir, 'nested', 'config.json');
        expect(() => writeJsonAtomic(target, { a: 1 })).toThrow();
        expect(fs.readdirSync(dir)).toEqual([]);
    });
});

describe('claimLockFile', () => {
    it('claims an unlocked profile exactly once', () => {
        const first = claimLockFile(dir);
        expect(first).toEqual({ claimed: true, existing: null });

        const lock = readLockFile(dir);
        expect(lock).toMatchObject({ pid: process.pid, port: 0, wsEndpoint: '', claiming: true });

        const second = claimLockFile(dir, 999_999);
        expect(second.claimed).toBe(false);
        expect(second.existing).toMatchObject({ pid: process.pid, claiming: true });
    });

    it('reports the running lock it lost to', () => {
        writeLockFile(dir, { pid: 42, port: 9222, wsEndpoint: 'ws://x/devtools/browser/a', startedAt: 1 });

        const attempt = claimLockFile(dir);
        expect(attempt.claimed).toBe(false);
        expect(attempt.existing).toMatchObject({ pid: 42, port: 9222 });
        expect(attempt.existing?.claiming).toBeUndefined();
    });

    it('claims again once the claim is removed', () => {
        claimLockFile(dir);
        deleteLockFile(dir);
        expect(claimLockFile(dir).claimed).toBe(true);
        expect(fs.existsSync(lockFilePath(dir))).toBe(true);
    });
});

describe('sameBrowser', () => {
    const endpoint = (id: string): string => `ws://127.0.0.1:9222/devtools/browser/${id}`;

    it('matches the browser that wrote the lock', () => {
        expect(sameBrowser(endpoint('abc'), endpoint('abc'))).toBe(true);
    });

    it('rejects a different browser on the recycled port', () => {
        expect(sameBrowser(endpoint('abc'), endpoint('def'))).toBe(false);
    });

    it('trusts the port when the lock recorded no endpoint', () => {
        expect(sameBrowser('', endpoint('abc'))).toBe(true);
    });
});
