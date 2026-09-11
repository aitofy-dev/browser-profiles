/**
 * The 30-second version: an anti-detect browser with no saved profile.
 *
 *   npm install @aitofy/browser-profiles rebrowser-puppeteer-core
 *   npx tsx examples/quick-launch.ts
 */
import { quickLaunch } from '@aitofy/browser-profiles';

const { page, close } = await quickLaunch({
    // Optional. With a proxy, the timezone is detected from its exit IP.
    // proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
    fingerprint: {
        platform: 'Win32',
        language: 'en-US',
        hardwareConcurrency: 8,
    },
});

await page.goto('https://browserscan.net', { waitUntil: 'networkidle2' });
await page.screenshot({ path: 'anti-detect-score.png', fullPage: true });

console.log('Saved anti-detect-score.png');

await close();
