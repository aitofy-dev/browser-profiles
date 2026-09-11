import { describe, it, expect } from 'vitest';
import {
    createWebGLScript,
    pickWebGLForPlatform,
    getAllProtectionScripts,
    createWorkerSpoofScript,
} from './fingerprint';

describe('createWebGLScript', () => {
    it('embeds the requested vendor and renderer', () => {
        const script = createWebGLScript({
            vendor: 'Google Inc. (NVIDIA)',
            renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
        });
        expect(script).toContain('Google Inc. (NVIDIA)');
        expect(script).toContain('NVIDIA GeForce RTX 3080');
        // 37446 = UNMASKED_RENDERER_WEBGL must return the fixed renderer
        expect(script).toContain('if (pname === 37446) return RENDERER;');
    });

    it('is deterministic per renderer (seeded PRNG, no Math.random)', () => {
        expect(createWebGLScript()).not.toContain('Math.random');
    });
});

describe('pickWebGLForPlatform', () => {
    it('returns an Apple GPU for macOS', () => {
        const fp = pickWebGLForPlatform('MacIntel');
        expect(fp.renderer).toContain('Apple');
        expect(fp.vendor).toContain('Apple');
    });

    it('returns a Mesa/AMD/Intel GPU for Linux', () => {
        const fp = pickWebGLForPlatform('Linux x86_64');
        expect(fp.renderer).toMatch(/Mesa|AMD|Intel/);
    });

    it('returns a Windows-style ANGLE Direct3D renderer for Win32', () => {
        const fp = pickWebGLForPlatform('Win32');
        expect(fp.renderer).toContain('Direct3D11');
        expect(fp.renderer).not.toContain('Apple');
    });

    it('derives vendor from the renderer string', () => {
        const fp = pickWebGLForPlatform('Win32');
        const vendorName = fp.renderer.match(/^ANGLE \(([^,]+),/)?.[1];
        expect(fp.vendor).toBe(`Google Inc. (${vendorName})`);
    });
});

describe('getAllProtectionScripts', () => {
    it('includes a worker spoof wrapping Worker and SharedWorker by default', () => {
        const bundle = getAllProtectionScripts({
            navigator: { platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8, language: 'en-US' },
        });
        expect(bundle).toContain('wrapWorker');
        expect(bundle).toContain('self.Worker');
        expect(bundle).toContain('self.SharedWorker');
    });

    it('honors a fixed webgl config', () => {
        const bundle = getAllProtectionScripts({
            webgl: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0)' },
        });
        expect(bundle).toContain('AMD Radeon RX 580');
    });

    it('omits the worker script when there is nothing to re-inject', () => {
        const bundle = getAllProtectionScripts({ webgl: false, navigator: undefined, workers: true });
        expect(bundle).not.toContain('wrapWorker');
    });
});

describe('createWorkerSpoofScript', () => {
    it('loads the original worker through a blob that runs the prelude first', () => {
        const script = createWorkerSpoofScript('/* prelude */');
        expect(script).toContain('importScripts');
        expect(script).toContain('createObjectURL');
        // module workers are passed through untouched
        expect(script).toContain("options.type === 'module'");
    });
});
