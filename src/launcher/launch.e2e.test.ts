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

/** Each worker kind reports what it sees, so the test reads it back from the page. */
const WORKER_PROBE = `
const probe = () => ({
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency,
    language: navigator.language,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    userAgent: navigator.userAgent,
    appVersion: navigator.appVersion,
});
if (typeof ServiceWorkerGlobalScope !== 'undefined') {
    clients.matchAll({ includeUncontrolled: true }).then((all) => all.forEach((c) => c.postMessage(probe())));
} else if (typeof onconnect !== 'undefined') onconnect = (event) => event.ports[0].postMessage(probe());
else postMessage(probe());
`;

/** Serves a page that starts every worker kind from a real URL. */
async function serveWorkerPage(): Promise<{ url: string; acceptLanguage: () => string; close: () => Promise<void> }> {
    let acceptLanguage = '';
    const server = http.createServer((request, response) => {
        acceptLanguage = request.headers['accept-language'] ?? '';
        if (request.url === '/probe.js') {
            response.writeHead(200, { 'content-type': 'text/javascript' });
            response.end(WORKER_PROBE);
            return;
        }
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<title>workers</title>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return {
        url: `http://127.0.0.1:${port}/`,
        acceptLanguage: () => acceptLanguage,
        close: () => new Promise<void>((resolve) => {
            // A shared worker can outlive the page and keep its connection open.
            server.closeAllConnections();
            server.close(() => resolve());
        }),
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
                ownNavigatorProperties: Object.getOwnPropertyNames(navigator),
                webdriverOnPrototype: 'webdriver' in Navigator.prototype,
            }));

            expect(observed.userAgent).toBe(profile.fingerprint?.userAgent);
            expect(observed.platform).toBe('Win32');
            expect(observed.timezone).toBe('Asia/Tokyo');
            expect(observed.webdriver).toBe(false);
            // Detectors flag an own property where real Chrome has none.
            expect(observed.ownNavigatorProperties).toEqual([]);
            expect(observed.webdriverOnPrototype).toBe(true);
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

    it('gives Intl, navigator.languages and Accept-Language the profile language', async () => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-e2e-'));
        launched = await launchChrome({ profile, userDataDir, headless: true });

        const site = await serveWorkerPage();
        const browser = await puppeteer.connect({ browserWSEndpoint: launched.wsEndpoint });
        try {
            const page = await browser.newPage();
            await page.goto(site.url);
            const seen = await page.evaluate(() => ({
                locale: Intl.DateTimeFormat().resolvedOptions().locale,
                languages: navigator.languages.join(','),
            }));
            expect(seen).toEqual({ locale: 'ja-JP', languages: 'ja-JP,ja' });
            // What Chrome sends for ja-JP,ja: the header must not disagree with navigator.languages.
            expect(site.acceptLanguage()).toBe('ja-JP,ja;q=0.9');
        } finally {
            browser.disconnect();
            await site.close();
        }
    }, 60_000);

    // Needs a fingerprint-chromium build: KERNEL_PATH=/path/to/Chromium.
    it.skipIf(!process.env.KERNEL_PATH)('gives Intl the profile locale in kernel mode', async () => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-e2e-'));
        launched = await launchChrome({ profile, userDataDir, headless: true, chromePath: process.env.KERNEL_PATH });
        expect(launched.engine).toBe('kernel');

        const browser = await puppeteer.connect({ browserWSEndpoint: launched.wsEndpoint });
        try {
            const page = await browser.newPage();
            await page.goto('data:text/html,<title>e2e</title>');
            const locale = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().locale);
            expect(locale).toBe('ja-JP');
        } finally {
            browser.disconnect();
        }
    }, 60_000);

    it('spoofs classic, module, shared and service workers like the page', async () => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profiles-e2e-'));
        launched = await launchChrome({ profile, userDataDir, headless: true });

        const site = await serveWorkerPage();
        const browser = await puppeteer.connect({ browserWSEndpoint: launched.wsEndpoint });
        try {
            const page = await browser.newPage();
            await page.goto(site.url);
            const seen = await page.evaluate(async () => {
                const fromWorker = (worker: Worker) =>
                    new Promise((resolve) => {
                        worker.onmessage = (event) => resolve(event.data);
                        worker.onerror = (event) => resolve(`error: ${event.message}`);
                        setTimeout(() => resolve('timeout'), 5000);
                    });
                const shared = new SharedWorker('/probe.js');
                return {
                    page: navigator.userAgent,
                    classic: await fromWorker(new Worker('/probe.js')),
                    module: await fromWorker(new Worker('/probe.js', { type: 'module' })),
                    shared: await new Promise((resolve) => {
                        shared.port.onmessage = (event) => resolve(event.data);
                        shared.onerror = () => resolve('error');
                        setTimeout(() => resolve('timeout'), 5000);
                    }),
                    service: await new Promise((resolve) => {
                        navigator.serviceWorker.onmessage = (event) => resolve(event.data);
                        navigator.serviceWorker.register('/probe.js').catch((error) => resolve(`error: ${error}`));
                        setTimeout(() => resolve('timeout'), 5000);
                    }),
                };
            });

            const expected = {
                platform: 'Win32',
                cores: 4,
                language: 'ja-JP',
                locale: 'ja-JP',
                userAgent: seen.page,
                appVersion: seen.page.replace('Mozilla/', ''),
            };
            expect(seen.page).toBe(profile.fingerprint?.userAgent);
            expect(seen.classic).toEqual(expected);
            expect(seen.module).toEqual(expected);
            expect(seen.shared).toEqual(expected);
            expect(seen.service).toEqual(expected);
        } finally {
            browser.disconnect();
            await site.close();
        }
    }, 60_000);
});
