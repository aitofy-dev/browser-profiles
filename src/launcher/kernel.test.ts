import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredProfile } from '../types';
import { buildChromeFlags } from './chrome-flags';
import { kernelBinaryCandidates } from './chrome-path';
import {
    KERNEL_REQUIRED_MESSAGE,
    KERNEL_SWITCH,
    binaryLooksLikeKernel,
    buildKernelFlags,
    kernelPlatform,
    kernelSeed,
    resolveEngine,
} from './kernel';

const dirs: string[] = [];

function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-'));
    dirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const profile: StoredProfile = {
    id: 'profile-a',
    name: 'A',
    createdAt: 0,
    updatedAt: 0,
    fingerprint: {
        platform: 'MacIntel',
        language: 'vi-VN',
        hardwareConcurrency: 12,
        canvas: 'real',
    },
};

describe('kernelSeed', () => {
    it('stays inside the positive 31-bit range and follows the profile id', () => {
        const seed = kernelSeed('profile-a');
        expect(seed).toBe(kernelSeed('profile-a'));
        expect(seed).not.toBe(kernelSeed('profile-b'));
        expect(seed).toBeGreaterThan(0);
        expect(seed).toBeLessThan(2_147_483_647);
    });
});

describe('kernelPlatform', () => {
    it('maps navigator.platform onto the kernel os names', () => {
        expect(kernelPlatform('Win32')).toBe('windows');
        expect(kernelPlatform('MacIntel')).toBe('macos');
        expect(kernelPlatform('Linux x86_64')).toBe('linux');
    });
});

describe('buildKernelFlags', () => {
    it('derives a Chrome identity from the profile and leaves the brand version to the binary', () => {
        const flags = buildKernelFlags(profile, 'Asia/Ho_Chi_Minh');
        expect(flags).toContain(`--fingerprint=${kernelSeed('profile-a')}`);
        expect(flags).toContain('--fingerprint-platform=macos');
        expect(flags).toContain('--fingerprint-brand=Chrome');
        expect(flags.some((flag) => flag.includes('fingerprint-brand-version'))).toBe(false);
        expect(flags).toContain('--fingerprint-hardware-concurrency=12');
        expect(flags).toContain('--accept-lang=vi-VN,vi');
        expect(flags).toContain('--timezone=Asia/Ho_Chi_Minh');
        expect(flags).toContain('--disable-non-proxied-udp');
        expect(flags).toContain('--disable-spoofing=canvas');
    });

    it('omits cores and disable-spoofing when the profile leaves them unset', () => {
        const flags = buildKernelFlags(
            { id: 'bare', name: 'Bare', createdAt: 0, updatedAt: 0 },
            'America/New_York'
        );
        expect(flags.some((flag) => flag.startsWith('--fingerprint-hardware-concurrency'))).toBe(false);
        expect(flags.some((flag) => flag.startsWith('--disable-spoofing'))).toBe(false);
        expect(flags).toContain('--fingerprint-platform=windows');
        expect(flags).toContain('--accept-lang=en-US,en');
    });

    it('is placed before a caller flag, so the caller can override it', () => {
        const flags = buildChromeFlags({
            profile,
            userDataDir: '/tmp/profile',
            headless: false,
            args: ['--fingerprint=1'],
            extensions: [],
            kernelFlags: buildKernelFlags(profile, 'Asia/Ho_Chi_Minh'),
        });
        expect(flags.at(-1)).toBe('--fingerprint=1');
        expect(flags.some((flag) => flag.startsWith('--fingerprint='))).toBe(true);
    });
});

describe('resolveEngine', () => {
    it('uses the kernel only when the binary has the switch', () => {
        expect(resolveEngine('auto', true)).toBe('kernel');
        expect(resolveEngine('auto', false)).toBe('inject');
        expect(resolveEngine('inject', true)).toBe('inject');
        expect(resolveEngine('kernel', true)).toBe('kernel');
    });

    it('refuses kernel mode on stock Chrome', () => {
        expect(() => resolveEngine('kernel', false)).toThrow(KERNEL_REQUIRED_MESSAGE);
    });
});

// Chromium compiles switch names without their dashes.
const SWITCH_NAME = KERNEL_SWITCH.replace(/^--/, '');

function writeFile(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

describe('binaryLooksLikeKernel', () => {
    it('finds the switch even when it straddles a read boundary', () => {
        const dir = tempDir();
        const file = path.join(dir, 'chrome');
        const markerAt = 1024 * 1024 - 10;
        const body = Buffer.alloc(markerAt + SWITCH_NAME.length, 0x61);
        body.write(SWITCH_NAME, markerAt, 'utf8');
        fs.writeFileSync(file, body);

        expect(binaryLooksLikeKernel(file)).toBe(true);
        expect(binaryLooksLikeKernel(file)).toBe(true);
    });

    it('rejects a binary that merely mentions fingerprint', () => {
        const dir = tempDir();
        const file = path.join(dir, 'chrome');
        fs.writeFileSync(file, Buffer.from('--fingerprint=1 --fingerprint-brand=Chrome'));
        expect(binaryLooksLikeKernel(file)).toBe(false);
    });

    it('reads the macOS framework, not the launcher stub', () => {
        const app = path.join(tempDir(), 'Chromium.app');
        const stub = path.join(app, 'Contents', 'MacOS', 'Chromium');
        writeFile(stub, 'launcher stub');
        const versions = path.join(app, 'Contents', 'Frameworks', 'Chromium Framework.framework', 'Versions');
        writeFile(path.join(versions, '148.0.0.0', 'Chromium Framework'), `switches ${SWITCH_NAME} end`);
        fs.symlinkSync('148.0.0.0', path.join(versions, 'Current'));

        expect(binaryLooksLikeKernel(stub)).toBe(true);
    });

    it('rejects a stock macOS app whose framework lacks the switch', () => {
        const app = path.join(tempDir(), 'Google Chrome.app');
        const stub = path.join(app, 'Contents', 'MacOS', 'Google Chrome');
        writeFile(stub, `stub mentioning ${SWITCH_NAME}`);
        const framework = path.join(app, 'Contents', 'Frameworks', 'Google Chrome Framework.framework');
        writeFile(path.join(framework, 'Versions', 'Current', 'Google Chrome Framework'), 'remote-debugging-port');

        expect(binaryLooksLikeKernel(stub)).toBe(false);
    });

    it('reads chrome.dll next to a Windows launcher', () => {
        const dir = tempDir();
        const exe = path.join(dir, 'chrome.exe');
        writeFile(exe, 'launcher stub');
        writeFile(path.join(dir, '148.0.0.0', 'chrome.dll'), `switches ${SWITCH_NAME} end`);

        expect(binaryLooksLikeKernel(exe)).toBe(true);
    });
});

describe('kernelBinaryCandidates', () => {
    it('looks in the user kernel directory before a stock install', () => {
        const candidates = kernelBinaryCandidates();
        expect(candidates[0]).toContain(`${path.join('.aitofy', 'browser-profiles', 'kernel')}`);
    });
});
