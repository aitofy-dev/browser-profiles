/**
 * Open a stored profile and drive it with Playwright over CDP.
 * The profile's proxy, timezone and fingerprint protection stay in effect,
 * including on the new tab Playwright opens.
 *
 *   npm install @aitofy/browser-profiles playwright
 *   npx tsx examples/playwright-connect.ts
 */
import { BrowserProfiles } from '@aitofy/browser-profiles';
import { chromium } from 'playwright';

const profiles = new BrowserProfiles();

const profile =
    (await profiles.getByIdOrName('acme-main')) ??
    (await profiles.create({ id: 'acme-main', name: 'Acme Main' }));

const launched = await profiles.launch(profile.id);

const browser = await chromium.connectOverCDP(launched.wsEndpoint);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = context.pages()[0] ?? (await context.newPage());

await page.goto('https://browserleaks.com/javascript');
console.log(await page.evaluate(() => navigator.platform));

await browser.close();   // detaches the CDP client
await launched.close();  // closes Chrome
