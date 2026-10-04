// Detector scores for the README, measured instead of claimed.
//
//   npm run build
//   set -a; source ~/.aff/proxy.env; set +a        # PROXY_URL=http://user:pass@host:port
//   KERNEL_PATH=/path/to/fingerprint-chromium PROXY_LABEL=residential node scripts/measure.mjs
//
// Engines: stock (plain Chrome behind the proxy, the control), inject, kernel when
// KERNEL_PATH is set, gpm (GPM Login) when GPM_PROFILE_ID names a running GPM's profile,
// adspower when ADSPOWER_PROFILE_ID is set (ADSPOWER_API, ADSPOWER_API_KEY), multilogin
// when MLX_TOKEN is set (a running Multilogin X agent), and any browser already open when
// CDP_WS is its browser WebSocket (named by CDP_LABEL).
// ENGINES=inject,kernel and SITES=browserscan pick subsets; SETTLE_MS sets the wait per site.
// A profile engine opens each site while no automation client is attached, then is
// reconnected only to mask IP addresses and capture the result.
// Output: measurements/<timestamp>/<engine>-<site>.{png,txt} and results.json.

import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { getChromePath, launchChromeStandalone, parseProxyUrl } from '../dist/index.mjs';

const SITES = [
    { name: 'browserscan', url: 'https://www.browserscan.net/' },
    { name: 'creepjs', url: 'https://abrahamjuliot.github.io/creepjs/' },
    { name: 'pixelscan', url: 'https://pixelscan.net/fingerprint-check' },
    { name: 'tls', url: 'https://tls.peet.ws/api/clean' },
    { name: 'fingerprint', url: 'https://demo.fingerprint.com/playground' },
    { name: 'iphey', url: 'https://iphey.com/' },
    { name: 'rebrowser', url: 'https://bot-detector.rebrowser.net/' },
    { name: 'deviceinfo', url: 'https://deviceandbrowserinfo.com/are_you_a_bot' },
    { name: 'cloudflare', url: 'https://www.scrapingcourse.com/antibot-challenge' },
];

const SETTLE_MS = Number(process.env.SETTLE_MS) || 30_000;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// PROFILE_PLATFORM=host leaves the platform unset, so the kernel claims this machine's OS.
const PLATFORM = process.env.PROFILE_PLATFORM || 'Win32';
const FINGERPRINT = {
    ...(PLATFORM === 'host' ? {} : { platform: PLATFORM }),
    language: 'en-US',
    hardwareConcurrency: 8,
    deviceMemory: 8,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireProxy() {
    if (!process.env.PROXY_URL) throw new Error('PROXY_URL is not set. Source the proxy env file first.');
    const parsed = parseProxyUrl(process.env.PROXY_URL);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return parsed.data;
}

/** Runs in the page: hides every IPv4 address so screenshots can be published. */
function maskAddresses() {
    const ipv4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        node.textContent = node.textContent.replace(ipv4, 'x.x.x.x');
    }
    for (const input of document.querySelectorAll('input, textarea')) {
        input.value = input.value.replace(ipv4, 'x.x.x.x');
    }
}

/** Stock Chrome stays driven by Puppeteer: it is the only way to answer proxy auth there. */
async function measureStock(proxy, site) {
    const browser = await puppeteer.launch({
        executablePath: getChromePath(),
        headless: false,
        defaultViewport: null,
        args: [`--proxy-server=${proxy.type}://${proxy.host}:${proxy.port}`],
    });
    try {
        const page = await browser.newPage();
        if (proxy.username) await page.authenticate({ username: proxy.username, password: proxy.password ?? '' });
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await delay(SETTLE_MS);
        await capture(page, 'stock', site);
    } finally {
        await browser.close();
    }
}

async function measureProfile(proxy, engine, site) {
    const launched = await launchChromeStandalone({
        proxy,
        engine,
        chromePath: engine === 'kernel' ? process.env.KERNEL_PATH : undefined,
        fingerprint: FINGERPRINT,
    });
    try {
        if (launched.engine !== engine) throw new Error(`Asked for ${engine}, launched ${launched.engine}.`);
        await measureDetached(launched.wsEndpoint, engine, site);
    } finally {
        await launched.close();
    }
}

/** GPM Login, for comparison: its local API starts a profile whose proxy is set inside GPM. */
async function measureGpm(site) {
    const api = 'http://127.0.0.1:9495/api/v1/profiles';
    const id = process.env.GPM_PROFILE_ID;
    let started = await (await fetch(`${api}/start/${id}`)).json();
    // Stop returns before the previous browser has exited.
    for (let attempt = 0; !started.success && started.message === 'ProfileInUse' && attempt < 15; attempt++) {
        await delay(2000);
        started = await (await fetch(`${api}/start/${id}`)).json();
    }
    if (!started.success) throw new Error(`GPM start failed: ${started.message}`);
    try {
        // GPM v5 leaves websocket_debugging_url empty; the port is enough to find it.
        const wsEndpoint = await debuggerUrl(started.data.remote_debugging_port);
        await measureDetached(wsEndpoint, 'gpm', site);
    } finally {
        await fetch(`${api}/stop/${id}`);
    }
}

/** AdsPower, for comparison. Its local API needs a paid plan; the key is sent as a bearer token. */
async function measureAdsPower(site) {
    const api = process.env.ADSPOWER_API || 'http://127.0.0.1:50325';
    const headers = { authorization: `Bearer ${process.env.ADSPOWER_API_KEY}` };
    const id = process.env.ADSPOWER_PROFILE_ID;
    const call = async (route) => {
        // The local API allows about one request per second.
        await delay(1100);
        return (await fetch(`${api}/api/v1/browser/${route}?user_id=${id}`, { headers })).json();
    };
    const started = await call('start');
    if (started.code !== 0) throw new Error(`AdsPower start failed: ${started.msg}`);
    try {
        await measureDetached(started.data.ws.puppeteer, 'adspower', site);
    } finally {
        await call('stop');
        await delay(3000);
    }
}

/** Multilogin X, for comparison: a one-off quick profile, nothing is saved to the workspace. */
async function measureMultilogin(proxy, site) {
    const launcher = 'https://launcher.mlx.yt:45001/api';
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${process.env.MLX_TOKEN}` };
    const flags = Object.fromEntries(
        ['navigator', 'audio', 'localization', 'geolocation', 'timezone', 'graphics', 'webrtc', 'fonts',
            'media_devices', 'screen', 'ports'].map((name) => [`${name}_masking`, 'mask'])
    );
    const body = {
        browser_type: 'mimic',
        os_type: 'windows',
        automation: 'puppeteer',
        parameters: {
            flags: { ...flags, geolocation_popup: 'prompt', canvas_noise: 'natural', graphics_noise: 'natural',
                proxy_masking: 'custom', startup_behavior: 'custom' },
            proxy: { host: proxy.host, type: proxy.type, port: proxy.port, username: proxy.username,
                password: proxy.password },
            fingerprint: {},
        },
    };
    const started = await (await fetch(`${launcher}/v3/profile/quick`, {
        method: 'POST', headers, body: JSON.stringify(body),
    })).json();
    const port = started.data?.port;
    if (!port) throw new Error(`Multilogin start failed: ${JSON.stringify(started.status ?? started)}`);
    try {
        await measureDetached(await debuggerUrl(port), 'multilogin', site);
    } finally {
        await fetch(`${launcher}/v1/profile/stop/p/${started.data.id}`, { headers });
    }
}

/** The browser answers on its debugging port a moment after GPM reports it started. */
async function debuggerUrl(port) {
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
            return version.webSocketDebuggerUrl;
        } catch {
            await delay(500);
        }
    }
    throw new Error(`Nothing answered on debugging port ${port}.`);
}

async function measureDetached(wsEndpoint, engine, site) {
    const opener = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    const session = await opener.target().createCDPSession();
    await session.send('Target.createTarget', { url: site.url });
    opener.disconnect();

    await delay(SETTLE_MS);

    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
    try {
        const host = new URL(site.url).host;
        const page = (await browser.pages()).find((candidate) => candidate.url().includes(host));
        if (!page) throw new Error(`No tab on ${host}.`);
        await capture(page, engine, site);
    } finally {
        browser.disconnect();
    }
}

let outDir = '';

async function capture(page, engine, site) {
    await page.evaluate(maskAddresses);
    const text = await page.evaluate(() => document.body.innerText);
    const base = path.join(outDir, `${engine}-${site.name}`);
    fs.writeFileSync(`${base}.txt`, text.replace(IPV4, 'x.x.x.x'));
    await page.screenshot({ path: `${base}.png`, fullPage: true });
}

async function main() {
    const proxy = requireProxy();
    const available = [
        'stock',
        'inject',
        ...(process.env.KERNEL_PATH ? ['kernel'] : []),
        ...(process.env.GPM_PROFILE_ID ? ['gpm'] : []),
        ...(process.env.ADSPOWER_PROFILE_ID ? ['adspower'] : []),
        ...(process.env.MLX_TOKEN ? ['multilogin'] : []),
        ...(process.env.CDP_WS ? [process.env.CDP_LABEL || 'cdp'] : []),
    ];
    const picked = process.env.ENGINES?.split(',');
    const engines = picked ? available.filter((engine) => picked.includes(engine)) : available;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    outDir = path.join('measurements', [stamp, process.env.PROXY_LABEL].filter(Boolean).join('-'));
    fs.mkdirSync(outDir, { recursive: true });

    const results = [];
    for (const engine of engines) {
        const pickedSites = process.env.SITES?.split(',');
        const sites = pickedSites ? SITES.filter((site) => pickedSites.includes(site.name)) : SITES;
        for (const site of sites) {
            try {
                if (engine === 'stock') await measureStock(proxy, site);
                else if (engine === 'gpm') await measureGpm(site);
                else if (engine === 'adspower') await measureAdsPower(site);
                else if (engine === 'multilogin') await measureMultilogin(proxy, site);
                // A browser someone already opened: its own proxy applies, not PROXY_URL.
                else if (engine === (process.env.CDP_LABEL || 'cdp')) await measureDetached(process.env.CDP_WS, engine, site);
                else await measureProfile(proxy, engine, site);
                results.push({ engine, site: site.name, ok: true });
            } catch (error) {
                results.push({ engine, site: site.name, ok: false, error: String(error).replace(IPV4, 'x.x.x.x') });
            }
            console.log(results.at(-1));
        }
    }
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`Wrote ${outDir}`);
}

await main();
