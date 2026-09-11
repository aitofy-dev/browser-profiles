import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { LaunchResult, StoredProfile } from '../types';
import { loadCdp } from './deps';
import { launchChrome } from './launch';

// Launches a real Chrome: opt in with BROWSER_PROFILES_E2E=1.
const e2e = describe.skipIf(!process.env.BROWSER_PROFILES_E2E);

const profile: StoredProfile = {
    id: 'e2e-profile',
    name: 'E2E',
    createdAt: 0,
    updatedAt: 0,
    timezone: 'Asia/Tokyo',
    fingerprint: {
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        platform: 'Win32',
        language: 'ja-JP',
        hardwareConcurrency: 4,
        deviceMemory: 4,
    },
};

/** Serves an opener that pops a window up, and collects what that popup measured. */
async function servePages(): Promise<{ url: string; reported: () => Promise<string>; close: () => Promise<void> }> {
    let resolveReport: (cores: string) => void;
    const report = new Promise<string>((resolve) => {
        resolveReport = resolve;
    });

    const server = http.createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/report') resolveReport(url.searchParams.get('cores') ?? '');

        response.writeHead(200, { 'content-type': 'text/html' });
        if (url.pathname === '/popup') {
            response.end('<script>fetch("/report?cores=" + navigator.hardwareConcurrency)</script>');
        } else {
            response.end('<script>window.open("/popup")</script>');
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };

    return {
        url: `http://127.0.0.1:${port}/`,
        reported: () => report,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

let launched: LaunchResult | null = null;
let userDataDir = '';

afterEach(async () => {
    if (launched) await launched.close();
    launched = null;
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    userDataDir = '';
});

e2e('a browser launched for a profile', () => {
    it('protects a tab opened later by an external client', async () => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-e2e-'));
        launched = await launchChrome({ profile, userDataDir, headless: true });

        const browser = await puppeteer.connect({ browserWSEndpoint: launched.wsEndpoint });
        try {
            const page = await browser.newPage();
            // A real document: about:blank -> about:blank would not create one,
            // and new-document scripts only run on a document that is created.
            await page.goto('data:text/html,<title>e2e</title>');

            const observed = await page.evaluate(() => ({
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                webdriver: navigator.webdriver,
            }));

            expect(observed.userAgent).toBe(profile.fingerprint?.userAgent);
            expect(observed.platform).toBe('Win32');
            expect(observed.timezone).toBe('Asia/Tokyo');
            expect(observed.webdriver).toBeFalsy();
        } finally {
            browser.disconnect();
        }
    }, 60_000);

    it('spoofs a popup whose first document is already committed', async () => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-e2e-'));
        launched = await launchChrome({ profile, userDataDir, headless: true });

        const site = await servePages();
        const connect = await loadCdp();
        const client = await connect({ port: launched.port });
        try {
            // The popup reports its own navigator, so nothing has to attach to it.
            await client.send('Page.navigate', { url: site.url });
            expect(await site.reported()).toBe(String(profile.fingerprint?.hardwareConcurrency));
        } finally {
            await client.close();
            await site.close();
        }
    }, 60_000);
});
