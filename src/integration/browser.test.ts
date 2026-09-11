import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { getChromePath } from '../chrome-launcher';
import { quickLaunch, type WithPuppeteerResult } from '../integrations/puppeteer';

// Skip the whole suite when no Chrome binary is present (e.g. CI on Linux
// without a browser installed).
let hasChrome = false;
try {
    getChromePath();
    hasChrome = true;
} catch {
    hasChrome = false;
}

let puppeteer: unknown;
try {
    puppeteer = (await import('rebrowser-puppeteer-core')).default;
} catch {
    puppeteer = undefined;
}

const runnable = hasChrome && !!puppeteer;
const suite = runnable ? describe : describe.skip;

suite('integration: fingerprint applied in window and worker', () => {
    let storagePath: string;
    let session: WithPuppeteerResult;

    beforeAll(async () => {
        storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-it-'));
        session = await quickLaunch({
            puppeteer,
            storagePath,
            headless: true,
            name: 'integration',
            timezone: 'America/New_York',
            fingerprint: { language: 'en-US', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8 },
        });
        await session.page.goto('data:text/html,<h1>it</h1>');
    }, 60_000);

    afterAll(async () => {
        try { await session?.close({ terminate: true }); } catch { /* noop */ }
        try { fs.rmSync(storagePath, { recursive: true, force: true }); } catch { /* noop */ }
    });

    it('spoofs navigator and WebGL in the main window', async () => {
        const win = await session.page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext;
            const dbg = gl.getExtension('WEBGL_debug_renderer_info')!;
            return {
                platform: navigator.platform,
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: (navigator as unknown as { deviceMemory: number }).deviceMemory,
                renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string,
            };
        });
        expect(win.platform).toBe('Win32');
        expect(win.hardwareConcurrency).toBe(8);
        expect(win.deviceMemory).toBe(8);
        expect(win.renderer).toContain('Direct3D11');
        expect(win.renderer).not.toContain('Apple');
    });

    it('spoofs navigator and WebGL inside a Worker (issue #1)', async () => {
        const worker = await session.page.evaluate(() => new Promise<Record<string, unknown>>((resolve) => {
            const src = `self.onmessage = () => {
                let renderer = null;
                try {
                    const oc = new OffscreenCanvas(1, 1);
                    const gl = oc.getContext('webgl');
                    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
                    renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
                } catch (e) { renderer = 'err:' + e.message; }
                postMessage({ platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency, renderer });
            };`;
            const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
            w.onmessage = (e) => resolve(e.data as Record<string, unknown>);
            w.onerror = (e) => resolve({ error: e.message });
            w.postMessage('go');
            setTimeout(() => resolve({ error: 'timeout' }), 3000);
        }));
        expect(worker.platform).toBe('Win32');
        expect(worker.hardwareConcurrency).toBe(8);
        expect(worker.renderer).toContain('Direct3D11');
    });

    it('reports the same WebGL renderer on repeated reads', async () => {
        const [a, b] = await session.page.evaluate(() => {
            const read = () => {
                const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext;
                const dbg = gl.getExtension('WEBGL_debug_renderer_info')!;
                return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
            };
            return [read(), read()];
        });
        expect(a).toBe(b);
    });
});
