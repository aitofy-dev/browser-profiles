# @aitofy/browser-profiles

> 🔒 **Self-hosted anti-detect browser profiles.** The open-source alternative to AdsPower & Multilogin. 
> Run locally, own your data, no subscriptions.

[![npm version](https://img.shields.io/npm/v/@aitofy/browser-profiles.svg)](https://www.npmjs.com/package/@aitofy/browser-profiles)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-✓-green.svg)](https://github.com/aitofy-dev/browser-profiles)

## 🎯 Why browser-profiles?

Like **n8n** for automation or **Affine** for notes, this is **AdsPower for developers** — self-hosted, open-source, and privacy-first.

| ❌ AdsPower/Multilogin | ✅ browser-profiles |
|------------------------|---------------------|
| $99+/month | **Free forever** |
| Cloud storage (data not yours) | **Local storage** (your data) |
| GUI only | **Code-first** (Puppeteer/Playwright) |
| Vendor lock-in | **Open source** (MIT) |
| No customization | **Full control** |

## ✨ Features

- 🏠 **Self-hosted** - Data stays on your machine, no cloud dependency
- 🔐 **Privacy-first** - Zero telemetry, zero tracking
- 🛡️ **Anti-detect** - WebRTC, Canvas, WebGL, Audio fingerprint protection
- 🌐 **Proxy support** - HTTP, HTTPS, SOCKS5 with auto timezone detection
- 📦 **Profile management** - Create, update, delete browser profiles
- 🎭 **Puppeteer & Playwright** - First-class integration
- ⚡ **Zero config** - Works out of the box
- 🪶 **Lightweight** - No extensions, pure CDP injection

## 📦 Installation

```bash
# Recommended: rebrowser-puppeteer-core (better anti-detect!)
npm install @aitofy/browser-profiles rebrowser-puppeteer-core

# Or standard puppeteer
npm install @aitofy/browser-profiles puppeteer-core
```

### Anti-Detect Score

| Site | Score | Notes |
|------|-------|-------|
| browserleaks.com | ✅ 100% | All checks passed |
| pixelscan.net | ✅ 100% | Hardware fingerprint passed |
| browserscan.net | ⚠️ 95% | Bot Control -5% (Puppeteer limitation) |
| creepjs | ⚠️ 85% | Minor deductions |

> **Note**: 95% is the best achievable with Puppeteer/Playwright. 100% requires modified Chromium (like AdsPower).

## 💻 CLI Tool

Install globally to use the CLI:

```bash
npm install -g @aitofy/browser-profiles
```

### Commands

```bash
# List all profiles
browser-profiles list

# Create a new profile
browser-profiles create my-account
browser-profiles create my-account --proxy http://user:pass@proxy.com:8080

# Open browser with a profile
browser-profiles open <profile-id>

# Quick launch (no profile needed)
browser-profiles launch
browser-profiles launch --proxy http://proxy.com:8080

# Show profile details
browser-profiles info <profile-id>

# Delete a profile
browser-profiles delete <profile-id>

# Show storage path
browser-profiles path
```

## 🚀 Quick Start

### ⚡ 30-Second Example

```typescript
import { quickLaunch } from '@aitofy/browser-profiles';

// Launch anti-detect browser with proxy (timezone auto-detected!)
const { page, close } = await quickLaunch({
  proxy: { type: 'http', host: 'your-proxy.com', port: 8080 },
});

await page.goto('https://browserscan.net');
await page.screenshot({ path: 'proof.png' });
await close();
```

That's it! 🎉 Browser fingerprint is protected, IP is hidden, timezone matches proxy location.

---

### Profile Management

```typescript
import { BrowserProfiles } from '@aitofy/browser-profiles';

const profiles = new BrowserProfiles();

// Create a profile (saved to ~/.aitofy/browser-profiles/)
const profile = await profiles.create({
  name: 'My Profile',
  proxy: {
    type: 'http',
    host: 'proxy.example.com',
    port: 8080,
  },
});

// Launch browser
const { wsEndpoint, close } = await profiles.launch(profile.id);

// ... automation work ...

await close();
```

### With Puppeteer

```typescript
import { withPuppeteer } from '@aitofy/browser-profiles/puppeteer';

const { browser, page, close } = await withPuppeteer({
  profile: 'my-profile-id', // or profile name
});

await page.goto('https://whoer.net');
await page.screenshot({ path: 'screenshot.png' });

await close();
```

### Quick Launch (No Profile Needed)

```typescript
import { quickLaunch } from '@aitofy/browser-profiles/puppeteer';

const { browser, page, close } = await quickLaunch({
  proxy: {
    type: 'http',
    host: 'proxy.example.com',
    port: 8080,
  },
  // timezone is now AUTO-DETECTED from proxy IP!
  // No need to specify manually. If no proxy, system timezone is used.
  fingerprint: {
    platform: 'Win32',           // Spoof as Windows
    hardwareConcurrency: 8,      // Spoof CPU cores
    language: 'en-US',
  },
});

// Output: [browser-profiles] 🌍 Auto-detected timezone: America/New_York (New York, United States)

await page.goto('https://browserscan.net');
await close();
```

### With Playwright

```typescript
import { withPlaywright } from '@aitofy/browser-profiles/playwright';

const { browser, page, close } = await withPlaywright({
  profile: 'my-profile-id',
});

await page.goto('https://example.com');
await close();
```

### 🆕 v0.2.0: Advanced Features

#### Temporary Sessions (No Profile Persistence)

```typescript
import { createSession } from '@aitofy/browser-profiles/puppeteer';

// Quick session with random fingerprint - perfect for scraping
const session = await createSession({
  temporary: true,
  randomFingerprint: true, // Random platform, language, CPU cores
  proxy: { type: 'http', host: 'proxy.com', port: 8080 },
});

await session.page.goto('https://example.com');
await session.close(); // Cleanup
```

#### Patch Existing Pages

```typescript
import { patchPage } from '@aitofy/browser-profiles/puppeteer';

// Apply anti-detect patches to any page
await patchPage(page, {
  webdriver: true,     // Hide webdriver flag
  plugins: true,       // Spoof Chrome plugins
  chrome: true,        // Fix chrome object
  webrtc: true,        // WebRTC leak protection
  fingerprint: { platform: 'Win32', hardwareConcurrency: 8 },
});
```

#### Generate Fingerprints On-Demand

```typescript
import { generateFingerprint, getFingerprintScripts } from '@aitofy/browser-profiles';

// Generate a realistic fingerprint
const fp = generateFingerprint({
  platform: 'macos',
  gpu: 'apple',
  screen: 'retina',
  language: 'ja-JP',
});

console.log(fp.userAgent);      // Mozilla/5.0 (Macintosh...
console.log(fp.webgl.renderer); // ANGLE (Apple, Apple M1 Pro...

// Use with any page
const scripts = getFingerprintScripts(fp);
await page.evaluateOnNewDocument(scripts);
```

#### Standalone Chrome Launch

```typescript
import { launchChromeStandalone } from '@aitofy/browser-profiles';
import puppeteer from 'puppeteer-core';

// Launch Chrome without profile management
const { wsEndpoint, close } = await launchChromeStandalone({
  headless: false,
  proxy: { type: 'http', host: 'proxy.com', port: 8080 },
});

const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
await close();
```

#### Inject Your Own Puppeteer

```typescript
import puppeteer from 'rebrowser-puppeteer-core';
import { withPuppeteer } from '@aitofy/browser-profiles/puppeteer';

// Use your own puppeteer instance
const { browser, page } = await withPuppeteer({
  profile: 'my-profile',
  puppeteer, // ← Inject here
});
```

### 📁 Profile Management

Profiles are saved locally to `~/.aitofy/browser-profiles/` and persist between sessions.

```typescript
import { BrowserProfiles } from '@aitofy/browser-profiles';

const profiles = new BrowserProfiles();

// ===== CREATE =====
const profile = await profiles.create({
  name: 'Facebook Account 1',
  proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
  tags: ['facebook', 'marketing'],
});

// ===== LIST ALL =====
const allProfiles = await profiles.list();
console.log(`Total: ${allProfiles.length} profiles`);

// ===== LIST BY TAG =====
const fbProfiles = await profiles.list({ tags: ['facebook'] });

// ===== GET BY ID =====
const myProfile = await profiles.get(profile.id);

// ===== UPDATE =====
await profiles.update(profile.id, {
  name: 'Facebook Account 1 - Updated',
  proxy: { type: 'socks5', host: 'new-proxy.com', port: 1080 },
});

// ===== LAUNCH BROWSER =====
const { wsEndpoint, close } = await profiles.launch(profile.id);
// ... do automation ...
await close();

// ===== DUPLICATE =====
const cloned = await profiles.duplicate(profile.id, 'Facebook Account 2');

// ===== EXPORT / IMPORT =====
const json = await profiles.export(profile.id);
const imported = await profiles.import(json);

// ===== DELETE =====
await profiles.delete(profile.id);
```

### 📂 Groups (Organization)

```typescript
// Create groups
const group = await profiles.createGroup('TikTok Shop', 'All TikTok accounts');

// Move profile to group
await profiles.moveToGroup(profile.id, group.id);

// List groups
const groups = await profiles.listGroups();

// List profiles in group
const tikTokProfiles = await profiles.list({ groupId: group.id });
```

### ExTower Integration

```typescript
import { ExTowerClient } from '@aitofy/browser-profiles/extower';
import puppeteer from 'puppeteer-core';

const client = new ExTowerClient({
  baseUrl: 'http://localhost:50325', // default
});

// Create profile in ExTower
const { id } = await client.createProfile({
  name: 'TikTok Shop 1',
  proxy: {
    type: 'http',
    host: 'proxy.example.com',
    port: 8080,
  },
});

// Launch browser
const { puppeteer: wsEndpoint } = await client.launchBrowser(id);

// Connect Puppeteer
const browser = await puppeteer.connect({
  browserWSEndpoint: wsEndpoint,
});

const page = await browser.newPage();
await page.goto('https://seller-us.tiktok.com');
```

## 📖 API Reference

### BrowserProfiles

Main class for managing browser profiles.

```typescript
const profiles = new BrowserProfiles({
  storagePath: '~/.aitofy/browser-profiles',  // Default: ~/.aitofy/browser-profiles
  chromePath: '/path/to/chrome',              // Custom Chrome path (optional)
  defaultTimezone: 'UTC',                     // Default timezone for new profiles
});
```

**Default storage locations:**
- macOS: `~/.aitofy/browser-profiles`
- Linux: `~/.aitofy/browser-profiles`  
- Windows: `C:\Users\<user>\.aitofy\browser-profiles`

#### Methods

| Method | Description |
|--------|-------------|
| `create(config)` | Create a new profile |
| `get(id)` | Get profile by ID |
| `list(options?)` | List all profiles |
| `update(id, updates)` | Update profile |
| `delete(id)` | Delete profile |
| `launch(id, options?)` | Launch browser |
| `close(id)` | Close running browser |
| `closeAll()` | Close all browsers |
| `duplicate(id)` | Duplicate profile |
| `export(id)` | Export to JSON |
| `import(json)` | Import from JSON |

### Profile Configuration

```typescript
interface ProfileConfig {
  name: string;                    // Profile name
  proxy?: ProxyConfig;             // Proxy settings
  timezone?: string;               // e.g., "America/New_York"
  cookies?: ProfileCookie[];       // Cookies to inject
  fingerprint?: FingerprintConfig; // Fingerprint settings
  startUrls?: string[];            // URLs to open on launch
  tags?: string[];                 // Tags for organization
  groupId?: string;                // Group for organization
}
```

### Proxy Configuration

```typescript
interface ProxyConfig {
  type: 'http' | 'https' | 'socks5';
  host: string;
  port: number | string;
  username?: string;
  password?: string;
}
```

### Launch Options

```typescript
interface LaunchOptions {
  headless?: boolean;              // Run headless (default: false)
  chromePath?: string;             // Custom Chrome path
  args?: string[];                 // Additional Chrome args
  extensions?: string[];           // Extension paths to load
  defaultViewport?: { width: number; height: number } | null;
  slowMo?: number;                 // Slow down by ms
  timeout?: number;                // Launch timeout
}
```

## 🔒 Anti-Detect Features

All fingerprint protections are **hardcoded** and injected via CDP - no extensions required!

### 🤖 Automation Detection Bypass

Comprehensive protection against bot detection:

| Check | Status | Description |
|-------|--------|-------------|
| `navigator.webdriver` | ✅ Hidden | Returns `undefined` |
| `window.chrome` | ✅ Faked | Complete chrome object |
| `chrome.runtime` | ✅ Faked | Runtime object present |
| `chrome.csi()` | ✅ Faked | Timing function |
| `chrome.loadTimes()` | ✅ Faked | Page load metrics |
| `navigator.plugins` | ✅ Faked | 3 default Chrome plugins |
| `navigator.connection` | ✅ Faked | 4G connection info |
| `navigator.getBattery()` | ✅ Faked | Battery status API |
| `navigator.permissions` | ✅ Mocked | Permission query handling |

### WebRTC Leak Protection

Automatically prevents WebRTC from leaking your real IP address. Works even when using proxy!

### Canvas Fingerprint Protection

Adds random noise to canvas data to prevent tracking.

### WebGL Fingerprint Protection

Spoofs WebGL parameters and adds noise to buffer data:
- Randomizes vendor/renderer strings
- Spoofs GPU parameters
- Adds noise to WebGL buffer data

### AudioContext Fingerprint Protection

Adds tiny noise to audio data without affecting audio quality.

### Timezone Spoofing

```typescript
const profile = await profiles.create({
  name: 'US Profile',
  timezone: 'America/New_York', // Browser reports this timezone
});
```

### Navigator Spoofing

Customize browser navigator properties:

```typescript
const profile = await profiles.create({
  name: 'Custom Profile',
  fingerprint: {
    language: 'en-US',
    platform: 'Win32',
    hardwareConcurrency: 8,
    deviceMemory: 16,
  },
});
```

### Proxy with Authentication

Handles authenticated proxies transparently:

```typescript
const profile = await profiles.create({
  name: 'With Auth Proxy',
  proxy: {
    type: 'http',
    host: 'proxy.example.com',
    port: 8080,
    username: 'user',       // ✅ Auth handled automatically
    password: 'password',
  },
});
```

## ✅ Verified Test Results

Tested on 2026-01-08 with the following fingerprint testing sites:

| Property | Spoofed Value | Verification |
|----------|---------------|--------------|
| Timezone | America/New_York | ✅ BrowserScan |
| Platform | Win32 | ✅ BrowserLeaks |
| CPU Cores | 8 | ✅ PixelScan |
| Device Memory | 16GB | ✅ PixelScan |
| Language | en-US | ✅ All sites |
| WebRTC IP | Hidden | ✅ BrowserLeaks |
| Webdriver | Hidden | ✅ All sites |
| Plugins | 5 | ✅ BrowserLeaks |
| Connection API | 4g | ✅ Verified |
| Chrome Object | Complete | ✅ Verified |
| Chrome.csi | Present | ✅ Verified |
| Chrome.loadTimes | Present | ✅ Verified |

**Sites tested:**
- ✅ [browserscan.net](https://browserscan.net)
- ✅ [browserleaks.com](https://browserleaks.com/javascript)
- ✅ [pixelscan.net](https://pixelscan.net)
- ✅ [creepjs](https://abrahamjuliot.github.io/creepjs/)

## 🆚 Comparison

| Feature | browser-profiles | AdsPower | Multilogin | puppeteer-extra |
|---------|-----------------|----------|------------|-----------------|
| **Open Source** | ✅ MIT | ❌ Paid | ❌ Paid | ✅ MIT |
| **Price** | **FREE** | $9-50/mo | $99-199/mo | Free |
| **Anti-Detect Score** | 95% | 100% | 100% | ~80% |
| **Profile Storage** | ✅ | ✅ | ✅ | ❌ |
| **Proxy Auth** | ✅ | ✅ | ✅ | ❌ |
| **Auto Timezone** | ✅ | ✅ | ✅ | ❌ |
| **WebRTC Protection** | ✅ | ✅ | ✅ | ⚠️ Basic |
| **Canvas Noise** | ✅ | ✅ | ✅ | ⚠️ Basic |
| **TypeScript** | ✅ | ❌ | ❌ | ⚠️ Partial |
| **npm Package** | ✅ | ❌ | ❌ | ✅ |
| **Puppeteer Integration** | ✅ | ✅ | ⚠️ | ✅ |
| **Playwright Integration** | ✅ | ❌ | ⚠️ | ✅ |
| **Cloud Sync** | 🔜 Coming | ✅ | ✅ | ❌ |
| **GUI** | ❌ | ✅ | ✅ | ❌ |

### Why 95% vs 100%?

AdsPower and Multilogin achieve 100% by using **modified Chromium binaries**. Our library uses standard Chrome with JS injection, which has a fundamental ~5% detection limitation on advanced sites like BrowserScan.

**For most use cases (social media, e-commerce, scraping), 95% is sufficient.**

## 🔐 Security

### Data Storage
- All data stored **locally** at `~/.aitofy/browser-profiles/`
- **Zero telemetry** - no data sent to any server
- Profile configs stored as JSON files
- Chrome user data (passwords, autofill) encrypted by Chrome itself

### Future: E2E Encryption (Coming Soon)
```typescript
const profiles = new BrowserProfiles({
  encryption: {
    enabled: true,
    masterKey: 'your-secret-key',
  }
});
```
- AES-256-GCM encryption for sensitive data
- Optional cloud sync with end-to-end encryption
- Only you (or people you share the key with) can decrypt

## 🆕 v0.2.5: Full Type Support

### Native Type Re-exports

Starting from v0.2.5, `PuppeteerPage` and `PlaywrightPage` are **native types** re-exported from `puppeteer-core` and `playwright`. You now have access to ALL APIs directly:

```typescript
import { withPuppeteer, PuppeteerPage } from '@aitofy/browser-profiles';

const { page, close } = await withPuppeteer({ profile: 'my-profile' });

// ✅ Full API access - no workarounds needed!
await page.setRequestInterception(true);
page.on('request', (req) => {
    if (req.resourceType() === 'image') {
        req.abort();
    } else {
        req.continue();
    }
});

const cookies = await page.cookies();
await page.setCookie({ name: 'session', value: '123', domain: '.example.com' });

await close();
```

**For Playwright:**

```typescript
import { withPlaywright, PlaywrightPage } from '@aitofy/browser-profiles';

const { page, close } = await withPlaywright({ profile: 'my-profile' });

// ✅ Full Playwright API!
await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'image') {
        route.abort();
    } else {
        route.continue();
    }
});

await page.reload();
await page.waitForTimeout(1000);

await close();
```

### Exported Types

All commonly used types are re-exported for convenience:

| Puppeteer Types | Playwright Types |
|-----------------|------------------|
| `PuppeteerPage` | `PlaywrightPage` |
| `PuppeteerBrowser` | `PlaywrightBrowser` |
| `HTTPRequest` | `PlaywrightContext` |
| `HTTPResponse` | `PlaywrightRequest` |
| `Cookie` | `PlaywrightResponse`, `Route` |

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](https://github.com/aitofy-dev/browser-profiles/blob/main/CONTRIBUTING.md).

## 📄 License

MIT © [Aitofy](https://aitofy.dev)

---

<p align="center">
  Made with ❤️ by <a href="https://aitofy.dev">Aitofy</a>
</p>
