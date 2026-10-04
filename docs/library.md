# Library API

Everything public is exported from `@aitofy/browser-profiles`; the Playwright and ExTower adapters
live behind subpath exports. Node >= 18, ESM and CJS.

```bash
npm install @aitofy/browser-profiles rebrowser-puppeteer-core
# or the standard build
npm install @aitofy/browser-profiles puppeteer-core
```

## quickLaunch

One call, an anti-detect browser, no saved profile.

```typescript
import { quickLaunch } from '@aitofy/browser-profiles';

const { browser, page, close } = await quickLaunch({
  proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
  timezone: 'America/New_York',        // omit to detect it from the proxy IP
  fingerprint: { language: 'en-US', platform: 'Win32' },
});

await page.goto('https://browserscan.net');
await close({ terminate: true });
```

`QuickLaunchOptions` also accepts every `LaunchOptions` field (below) plus an optional `name`; the
profile it creates is stored under the storage path like any other. `close()` closes the pages this
session opened and leaves the browser running; `close({ terminate: true })`, or the `terminate()`
shorthand, kills the browser process.

## BrowserProfiles

The full API: profiles that persist between runs, so logins survive.

```typescript
import { BrowserProfiles } from '@aitofy/browser-profiles';

const profiles = new BrowserProfiles({
  storagePath: '/data/profiles',   // default: BROWSER_PROFILES_HOME or ~/.aitofy/browser-profiles
  chromePath: '/path/to/chrome',
  defaultTimezone: 'UTC',
  defaultProxy: { type: 'socks5', host: 'gate.provider.net', port: 1080 },
});

const profile = await profiles.create({
  id: 'acme-main',                 // optional: 1-64 chars of [a-zA-Z0-9_-]
  name: 'Acme Main',
  proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
  timezone: 'America/New_York',
  tags: ['acme'],
});

const { wsEndpoint, close } = await profiles.launch(profile.id);
await close();
```

For your own accounts signed in by hand, create the profile real: it launches with Chrome's own
identity, no generated fingerprint, no override, no injected script, and no default timezone
([anti-detect.md](./anti-detect.md#real-mode)).

```typescript
const google = await profiles.create({ id: 'google-main', name: 'Google Main', fingerprint: { mode: 'real' } });
const { engine } = await profiles.launch(google.id);  // 'real'; engine: 'kernel' | 'inject' throws
```

| Method | Description |
|--------|-------------|
| `create(config)` | Create a profile from a `ProfileConfig`. |
| `get(profileId)` | One profile by id, or null. |
| `getByName(name)` | One profile by name, case-insensitive. |
| `getByIdOrName(idOrName)` | Id first, then name. |
| `list(options?)` | All profiles, filterable by `groupId` and `tags`. |
| `update(profileId, updates)` | Merge a `Partial<ProfileConfig>`; returns the stored profile or null. |
| `delete(profileId)` | Delete the profile and its browser data. |
| `duplicate(profileId, newName?)` | Copy the settings into a new profile with a new id. |
| `export(profileId)` | The profile as a JSON string. |
| `import(json)` | Create a profile from that JSON. |
| `launch(profileId, options?)` | Launch Chrome for a profile. Returns a `LaunchResult`. |
| `launchByName(name, options?)` | Same, by name. |
| `launchByIdOrName(idOrName, options?)` | Same, id first then name. |
| `close(profileId)` | Close the running browser of one profile. |
| `closeAll()` | Close every browser this instance launched. |
| `getRunning()` | `Map<profileId, LaunchResult>` of what this instance launched. |
| `createGroup(name, description?)` | Create a profile group. |
| `listGroups()` | All groups. |
| `deleteGroup(groupId)` | Delete a group. |
| `moveToGroup(profileId, groupId)` | Move a profile into a group, or out with `null`. |

`LaunchResult` carries `wsEndpoint`, `pid`, `port`, `profileId`, `close()`, `engine` (`kernel`,
`inject`, or `real` for a real profile) and, when an already running browser was returned,
`reused: true`.

## Option types

```typescript
interface ProfileConfig {
  id?: string;                     // custom id, auto-generated if omitted
  name: string;
  proxy?: ProxyConfig;
  timezone?: string;               // e.g. "America/New_York"
  cookies?: ProfileCookie[];
  fingerprint?: FingerprintConfig | RealFingerprint;  // { mode: 'real', language? }: Chrome's own identity
  startUrls?: string[];
  tags?: string[];
  groupId?: string;
}

interface ProxyConfig {
  type: 'http' | 'https' | 'socks5';
  host: string;
  port: number | string;
  username?: string;
  password?: string;
}

interface LaunchOptions {
  headless?: boolean;              // default false
  chromePath?: string;
  args?: string[];                 // extra Chrome flags
  extensions?: string[];
  defaultViewport?: { width: number; height: number } | null;
  slowMo?: number;
  timeout?: number;
  detached?: boolean;              // let Chrome outlive this process (reduced protection)
  engine?: 'auto' | 'kernel' | 'inject';  // default auto; a real profile accepts only auto
  port?: number;                   // fixed DevTools port; default a free one
}
```

`parseProxyUrl(url)` turns a `"<scheme>://[user:pass@]host:port"` string into a `ProxyConfig` and
returns a `Result`; `formatProxyUrl(config)` is its inverse. Both are exported.

## withPuppeteer

```typescript
import { withPuppeteer } from '@aitofy/browser-profiles/puppeteer';
// also re-exported from '@aitofy/browser-profiles'

const { browser, page, profile, launch, close, terminate } = await withPuppeteer({ profile: 'acme-main' });

await page.goto('https://whoer.net');
await terminate();
```

The `profile` option accepts an id or a name; the returned `profile` is the stored profile and
`launch` is its `LaunchResult`. `close()` and `terminate()` behave as for `quickLaunch`.
`connectPuppeteer(wsEndpoint)` connects to a browser someone else opened.

## Playwright

```typescript
import { withPlaywright, quickLaunchPlaywright, connectPlaywright } from '@aitofy/browser-profiles/playwright';

const { browser, context, page, profile, launch, close } = await withPlaywright({ profile: 'acme-main' });
await page.goto('https://example.com');
await close();
```

`withPlaywright` returns a single `close()` and no `terminate()`.

`PlaywrightPage`, `PlaywrightBrowser`, `PlaywrightContext`, `PlaywrightRequest`,
`PlaywrightResponse` and `Route` are the native `playwright` types, re-exported so the full API is
available with no wrappers. `PuppeteerPage`, `PuppeteerBrowser`, `HTTPRequest`, `HTTPResponse` and
`Cookie` do the same for `puppeteer-core`.

## createSession and page patching

```typescript
import { createSession, patchPage, generateFingerprint, getFingerprintScripts } from '@aitofy/browser-profiles';

// Throwaway session with a random fingerprint
const session = await createSession({ temporary: true, randomFingerprint: true });
await session.page.goto('https://example.com');
await session.terminate();   // session.close() would only close this session's page

// Apply anti-detect patches to a page you already have
await patchPage(page, {
  webdriver: true,
  plugins: true,
  chrome: true,
  webrtc: true,
  fingerprint: { platform: 'Win32', hardwareConcurrency: 8 },
});

// Generate a fingerprint and inject it yourself
const fp = generateFingerprint({ platform: 'macos', gpu: 'apple', language: 'ja-JP' });
await page.evaluateOnNewDocument(getFingerprintScripts(fp));
```

`launchChromeStandalone(options)` launches Chrome with no profile management at all and returns
`{ wsEndpoint, pid, port, close }`:

```typescript
import { launchChromeStandalone } from '@aitofy/browser-profiles';

const { wsEndpoint, close } = await launchChromeStandalone({
  headless: false,
  proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
});
```

Lower-level exports, when you want the pieces: `launchChrome`, `closeBrowser`, `closeAllBrowsers`,
`getChromePath`, `buildProxyUrl`, `detectTimezoneFromIP`, `autoDetectTimezone`,
`getAllProtectionScripts`, `createNavigatorScript`, and the raw scripts
`WEBRTC_PROTECTION_SCRIPT`, `CANVAS_PROTECTION_SCRIPT`, `WEBGL_PROTECTION_SCRIPT`,
`AUDIO_PROTECTION_SCRIPT`.

Fingerprint pieces that have to stay consistent with the running browser:

```typescript
import {
  getProfileProtectionScripts, // the exact bundle the launcher injects for a profile fingerprint
  createWebGLScript,       // WebGL script for one vendor/renderer pair, stable per profile
  createWorkerSpoofScript, // wrap Worker/SharedWorker so they run the same spoof
  pickWebGLForPlatform,    // a GPU that matches 'Win32' | 'MacIntel' | 'Linux x86_64'
  buildUserAgent,          // reduced Chrome UA for a platform and a major version
  buildBrands,             // Sec-CH-UA brands for that major version
  buildUserAgentMetadata,  // payload for Network.setUserAgentOverride
  parseChromeVersion,      // read a version out of a UA or a Browser.getVersion product string
  resolveUserAgent,        // pinned UA wins, and reports a major-version mismatch
} from '@aitofy/browser-profiles';
```

## Command registry

The CLI and the MCP server are generated from one array of command definitions, and it is exported,
so the same operations run in-process with the same validation and the same errors.

```typescript
import { createCommandContext, getCommand, runCommand } from '@aitofy/browser-profiles';

const ctx = createCommandContext();               // honours BROWSER_PROFILES_HOME
const open = getCommand('browser.open');
const result = await runCommand(ctx, open, { idOrName: 'acme-main' });

if (result.ok) console.log(result.data.wsEndpoint);
else console.error(result.error.code, result.error.message);
```

| Export | Purpose |
|--------|---------|
| `commands` | The whole registry, as a readonly array of `AnyCommandDef`. |
| `getCommand(name)` | One command by its dotted name, e.g. `'browser.open'`. |
| `createCommandContext({ storagePath?, verbose? })` | Build the `CommandContext` a command runs against. |
| `runCommand(ctx, def, input)` | Validate the input, run the command, never throw. |
| `resolveStoragePath(explicit?)` | The storage path this process would use. |

Each definition carries `name`, `description`, the zod `input` schema, `run` and `render`, which is
why the CLI flags, the MCP input schema and this documentation all say the same thing. The design is
[ADR 0001](./adr/0001-command-registry.md).

## Result type

Commands return a `Result` and never throw:

```typescript
type Result<T, E = BrowserError> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: E };
```

`Ok(data)` and `Err(error)` build them. A `BrowserError` is `{ code, message, cause?, profileId? }`;
codes are listed in [cli.md](./cli.md).

Note that `BrowserProfiles` methods are the older, throwing API: `launch` and `create` reject on
failure. Use the command registry when you want errors as values.

## ExTower

```typescript
import { ExTowerClient } from '@aitofy/browser-profiles/extower';

const client = new ExTowerClient({ baseUrl: 'http://localhost:50325' });
const { id } = await client.createProfile({ name: 'Acme 1' });
const { puppeteer: wsEndpoint } = await client.launchBrowser(id);
```

## See also

[configuration.md](./configuration.md) · [anti-detect.md](./anti-detect.md) ·
[browser-lifecycle.md](./browser-lifecycle.md) · [playwright-mcp.md](./playwright-mcp.md) ·
[`../examples/`](../examples) · [adr/0001-command-registry.md](./adr/0001-command-registry.md)
