/**
 * A persistent profile behind an authenticated proxy. Cookies and logins survive restarts.
 *
 *   npx tsx examples/profile-with-proxy.ts
 *
 * Stored under BROWSER_PROFILES_HOME, or ~/.aitofy/browser-profiles by default.
 */
import { BrowserProfiles, parseProxyUrl } from '@aitofy/browser-profiles';

const proxy = parseProxyUrl('http://user:p%40ss@proxy.example.com:8080');
if (!proxy.ok) throw new Error(proxy.error.message);

const profiles = new BrowserProfiles();

const profile =
    (await profiles.getByIdOrName('acme-main')) ??
    (await profiles.create({
        id: 'acme-main',
        name: 'Acme Main',
        proxy: proxy.data,
        // Keep the timezone consistent with the proxy exit country.
        timezone: 'America/New_York',
        fingerprint: { platform: 'Win32', language: 'en-US' },
        tags: ['acme'],
    }));

const browser = await profiles.launch(profile.id);
console.log(`wsEndpoint: ${browser.wsEndpoint}`);
console.log(`reused:     ${browser.reused === true}`);

// Drive it yourself over CDP, or close it and reopen later with the same cookies.
await browser.close();
