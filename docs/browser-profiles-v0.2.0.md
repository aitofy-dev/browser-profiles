# @aitofy/browser-profiles v0.2.0 - Improvements

## 🐛 Bug Fix: ESM Compatibility

### Problem
Khi consumer sử dụng ESM (tsx, vite, etc.), `getPuppeteer()` function dùng `__require()` không hoạt động trong ESM context.

```javascript
// Current (broken in ESM):
async function getPuppeteer() {
  try {
    const rebrowser = __require("rebrowser-puppeteer-core");  // ❌ Fails in ESM
    return rebrowser;
  } catch { ... }
}
```

### Solution
Sử dụng dynamic `import()` thay vì `require()`:

```javascript
// Fixed (works in both ESM and CJS):
async function getPuppeteer() {
  const packages = [
    'rebrowser-puppeteer-core',
    'puppeteer-core', 
    'puppeteer'
  ];
  
  for (const pkg of packages) {
    try {
      const puppeteer = await import(pkg);
      console.log(`[browser-profiles] Using ${pkg}`);
      return puppeteer.default || puppeteer;
    } catch {
      continue;
    }
  }
  
  throw new Error(
    'Puppeteer not found. Please install one of the following:\n' +
    '  npm install rebrowser-puppeteer-core  (recommended for anti-detect)\n' +
    '  npm install puppeteer-core\n' +
    '  npm install puppeteer'
  );
}
```

---

## 🔧 API Optimization

### 1. Simplify Function Signatures

**Before:**
```typescript
// Too many options scattered
const { browser, page, close } = await withPuppeteer({
  profile: 'my-profile',
  headless: false,
  chromePath: '/path/to/chrome',
  args: ['--no-sandbox'],
  extensions: ['/path/to/ext'],
  defaultViewport: { width: 1920, height: 1080 },
  slowMo: 50,
  timeout: 30000,
  storagePath: '/custom/path',
});
```

**After (grouped options):**
```typescript
const { browser, page, close } = await withPuppeteer({
  profile: 'my-profile',
  
  // Launch options (puppeteer-specific)
  launch: {
    headless: false,
    chromePath: '/path/to/chrome',
    args: ['--no-sandbox'],
    extensions: ['/path/to/ext'],
    defaultViewport: { width: 1920, height: 1080 },
    slowMo: 50,
    timeout: 30000,
  },
  
  // Storage options
  storage: {
    path: '/custom/path',
  },
});
```

### 2. Named Exports cho Từng Module

**Before:**
```typescript
// Phải import từ subpath
import { withPuppeteer, quickLaunch } from '@aitofy/browser-profiles/puppeteer';
import { BrowserProfiles } from '@aitofy/browser-profiles';
```

**After (tree-shakeable named exports):**
```typescript
// Option 1: Import all from main
import { 
  BrowserProfiles, 
  withPuppeteer, 
  quickLaunch,
  connectPuppeteer,
  // Core utils
  generateFingerprint,
  detectTimezone,
  launchChrome,
} from '@aitofy/browser-profiles';

// Option 2: Subpath imports (for smaller bundles)
import { withPuppeteer } from '@aitofy/browser-profiles/puppeteer';
import { generateFingerprint } from '@aitofy/browser-profiles/fingerprint';
```

### 3. Builder Pattern cho Complex Configuration

```typescript
// Fluent API for complex setups
const { browser, page } = await BrowserProfiles
  .create('my-profile')
  .withProxy('http://user:pass@proxy.com:8080')
  .withTimezone('America/New_York')
  .withFingerprint({
    platform: 'Win32',
    vendor: 'Google Inc.',
  })
  .withExtensions(['/path/to/ublock'])
  .headless(false)
  .launch();
```

---

## 📦 Export Structure Optimization

### Current Structure (flat):
```
@aitofy/browser-profiles
├── index.ts          # Main exports
└── puppeteer.ts      # Puppeteer integration
```

### Proposed Structure (modular):
```
@aitofy/browser-profiles
├── index.ts              # Re-exports everything
├── core/
│   ├── profiles.ts       # BrowserProfiles class
│   ├── fingerprint.ts    # Fingerprint generation
│   ├── storage.ts        # Profile storage
│   └── chrome.ts         # Chrome launcher
├── integrations/
│   ├── puppeteer.ts      # Puppeteer integration
│   ├── playwright.ts     # Playwright integration (future)
│   └── selenium.ts       # Selenium integration (future)
└── utils/
    ├── timezone.ts       # Timezone detection
    ├── proxy.ts          # Proxy parsing
    └── types.ts          # Shared types
```

### Package.json Exports:
```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    },
    "./puppeteer": {
      "import": "./dist/integrations/puppeteer.mjs",
      "require": "./dist/integrations/puppeteer.cjs",
      "types": "./dist/integrations/puppeteer.d.ts"
    },
    "./fingerprint": {
      "import": "./dist/core/fingerprint.mjs",
      "require": "./dist/core/fingerprint.cjs",
      "types": "./dist/core/fingerprint.d.ts"
    },
    "./playwright": {
      "import": "./dist/integrations/playwright.mjs",
      "require": "./dist/integrations/playwright.cjs",
      "types": "./dist/integrations/playwright.d.ts"
    }
  }
}
```

---

## 🎯 Function Improvements

### 1. `launchChrome()` - Standalone Chrome Launcher

```typescript
// New: Launch Chrome without profile management
import { launchChrome } from '@aitofy/browser-profiles';

const { browser, wsEndpoint, close } = await launchChrome({
  headless: false,
  userDataDir: '/tmp/chrome-profile',
  args: ['--no-sandbox'],
});
```

### 2. `generateFingerprint()` - On-Demand Fingerprint

```typescript
// New: Generate fingerprint without creating profile
import { generateFingerprint } from '@aitofy/browser-profiles/fingerprint';

const fingerprint = generateFingerprint({
  platform: 'macos',
  browser: 'chrome',
  version: '120',
});

console.log(fingerprint);
// {
//   userAgent: 'Mozilla/5.0 ...',
//   viewport: { width: 1920, height: 1080 },
//   webgl: { vendor: 'Google Inc.', renderer: 'ANGLE ...' },
//   ...
// }
```

### 3. `patchPage()` - Anti-Detect Patches cho Existing Page

```typescript
// New: Apply anti-detect patches to any page
import { patchPage } from '@aitofy/browser-profiles';

const browser = await puppeteer.launch();
const page = await browser.newPage();

await patchPage(page, {
  webdriver: false,
  languages: ['en-US', 'en'],
  plugins: true,
  webgl: true,
});
```

### 4. `createSession()` - Lightweight Alternative

```typescript
// New: Create session without full profile
import { createSession } from '@aitofy/browser-profiles';

const session = await createSession({
  // No persistent profile, just temp session
  temporary: true,
  fingerprint: 'random',
  proxy: 'http://...',
});

const { browser, page } = session;
// Use browser...
await session.close();  // Cleanup
```

---

## 🔄 Async vs Sync API

### Problem: Some operations block unnecessarily

```typescript
// Current: Sync file operations
const profiles = new BrowserProfiles();
const list = profiles.list();  // Sync file read - blocks event loop!
```

### Solution: Async by default, sync optional

```typescript
// Recommended: Async (non-blocking)
const profiles = new BrowserProfiles();
const list = await profiles.list();  // ✅ Async

// Optional: Sync for simple scripts
import { BrowserProfilesSync } from '@aitofy/browser-profiles/sync';
const list = BrowserProfilesSync.list();  // Sync (explicit)
```

---

## 🛡️ Type Safety Improvements

### 1. Stricter Types

```typescript
// Before: Loose types
interface LaunchOptions {
  headless?: boolean | 'new' | 'shell';  // What does 'shell' mean?
  args?: string[];
}

// After: Documented types
interface LaunchOptions {
  /**
   * Run browser in headless mode
   * - true: Headless mode (fast, no UI)
   * - false: Show browser window
   * - 'new': New headless mode (Chrome 109+)
   */
  headless?: boolean | 'new';
  
  /**
   * Additional Chrome arguments
   * @see https://peter.sh/experiments/chromium-command-line-switches/
   */
  args?: ChromeArg[];
}

type ChromeArg = 
  | '--no-sandbox'
  | '--disable-gpu'
  | '--disable-dev-shm-usage'
  | `--proxy-server=${string}`
  | (string & {});  // Allow custom args
```

### 2. Discriminated Unions for Results

```typescript
// Before: Hard to handle errors
const result = await profiles.launch(id);
// result could be undefined, throw, etc.

// After: Explicit success/error
type LaunchResult = 
  | { success: true; browser: Browser; page: Page; close: () => Promise<void> }
  | { success: false; error: LaunchError };

const result = await profiles.launch(id);
if (result.success) {
  result.browser;  // ✅ Type-safe
} else {
  result.error.code;  // ✅ Error info
}
```

---

## 🛠️ CLI Tools & Utility Wrappers

Dựa trên usage patterns từ scripts, nên thêm các wrapper functions:

### 1. `setupProfile()` - Interactive Profile Setup

```typescript
import { setupProfile } from '@aitofy/browser-profiles/cli';

// Interactive setup with prompts
const profile = await setupProfile({
  name: 'my-profile',        // Optional: default generates random
  url: 'https://chatgpt.com', // Landing page after setup
  configFile: './profile.json', // Save config to file
  
  // Callbacks for custom messages
  onReady: () => console.log('Please login...'),
  onComplete: (profile) => console.log(`Profile ${profile.id} ready!`),
});
```

**CLI version:**
```bash
npx @aitofy/browser-profiles setup --name my-profile --url https://chatgpt.com
```

### 2. `openBrowser()` - Quick Launch with Profile

```typescript
import { openBrowser } from '@aitofy/browser-profiles/cli';

// Open and wait for user to close
await openBrowser({
  profile: 'my-profile',     // Profile ID or name
  url: 'https://chatgpt.com',
  waitForClose: true,        // Wait for user input to close
  message: 'Press Enter when done...', // Custom message
});
```

**CLI version:**
```bash
npx @aitofy/browser-profiles open --profile my-profile --url https://chatgpt.com
```

### 3. `exportCookies()` / `importCookies()` - Cookie Management

```typescript
import { exportCookies, importCookies } from '@aitofy/browser-profiles';

// Export cookies from browser session
const cookies = await exportCookies({
  profile: 'my-profile',
  domains: ['chatgpt.com', 'auth0.com'], // Optional filter
  format: 'json', // 'json' | 'netscape' | 'har'
});

// Save to file
fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));

// Import cookies to new session
await importCookies({
  profile: 'another-profile',
  cookies: JSON.parse(fs.readFileSync('cookies.json', 'utf-8')),
});
```

**CLI version:**
```bash
npx @aitofy/browser-profiles export-cookies --profile my-profile --output cookies.json
npx @aitofy/browser-profiles import-cookies --profile new-profile --input cookies.json
```

### 4. `listProfiles()` - Enhanced Profile Listing

```typescript
import { listProfiles } from '@aitofy/browser-profiles/cli';

const profiles = await listProfiles({
  format: 'table', // 'table' | 'json' | 'simple'
  showSize: true,  // Show profile disk size
  showLastUsed: true, // Show last used time
});

// Output:
// ┌─────────────────┬──────────────────┬─────────┬───────────────────┐
// │ ID              │ Name             │ Size    │ Last Used         │
// ├─────────────────┼──────────────────┼─────────┼───────────────────┤
// │ 8778c27aa13204d6│ chatgpt-main     │ 45 MB   │ 2 hours ago       │
// │ a1b2c3d4e5f6g7h8│ claude-session   │ 32 MB   │ 1 day ago         │
// └─────────────────┴──────────────────┴─────────┴───────────────────┘
```

**CLI version:**
```bash
npx @aitofy/browser-profiles list
npx @aitofy/browser-profiles list --format json
```

### 5. `deleteProfile()` - Safe Profile Deletion

```typescript
import { deleteProfile } from '@aitofy/browser-profiles/cli';

await deleteProfile({
  profile: 'my-profile',
  confirm: true,        // Require confirmation
  backup: true,         // Backup before delete
  backupPath: './backups/',
});
```

**CLI version:**
```bash
npx @aitofy/browser-profiles delete --profile my-profile --backup
```

### 6. `backupProfile()` / `restoreProfile()` - Backup Management

```typescript
import { backupProfile, restoreProfile } from '@aitofy/browser-profiles';

// Backup profile to zip
const backupPath = await backupProfile({
  profile: 'my-profile',
  output: './backups/',
  compress: true,
  includeExtensions: true,
});
// → ./backups/my-profile-2026-01-09.zip

// Restore from backup
await restoreProfile({
  input: './backups/my-profile-2026-01-09.zip',
  name: 'my-profile-restored', // Optional: rename
  overwrite: false,
});
```

### 7. Interactive Prompt Helpers

```typescript
import { prompt, confirm, waitForEnter } from '@aitofy/browser-profiles/cli';

// Simple prompt
const name = await prompt('Enter profile name:');

// Yes/No confirmation
const shouldContinue = await confirm('Delete profile?', { default: false });

// Wait for Enter key
await waitForEnter('Press Enter when logged in...');
```

---

## 📦 Package.json bin (CLI)

```json
{
  "bin": {
    "browser-profiles": "./dist/cli/index.js"
  },
  "scripts": {
    "postinstall": "echo 'Run: npx browser-profiles setup'"
  }
}
```

### Full CLI Commands:

```bash
# Profile Management
browser-profiles setup [--name <name>] [--url <url>]
browser-profiles open <profile> [--url <url>]
browser-profiles list [--format json|table]
browser-profiles delete <profile> [--backup] [--force]
browser-profiles info <profile>

# Backup & Restore
browser-profiles backup <profile> [--output <path>]
browser-profiles restore <backup-file> [--name <new-name>]

# Cookies
browser-profiles export-cookies <profile> [--output <file>]
browser-profiles import-cookies <profile> --input <file>

# Utilities
browser-profiles check-chrome         # Find Chrome installation
browser-profiles clean [--older-than 30d]  # Cleanup old profiles
```

---

## 📝 Implementation Checklist

### Bug Fixes
- [x] ✅ Replace `require()` with `await import()` in `getPuppeteer()` (v0.2.0)
- [x] ✅ Fix ESM/CJS dual package support (v0.2.0)

### API Improvements
- [x] ✅ Add `puppeteer` option to `withPuppeteer()`, `quickLaunch()`, and `connectPuppeteer()` (v0.2.0)
- [x] ✅ Add `launchChromeStandalone()` standalone function (v0.2.0)
- [x] ✅ Add `generateFingerprint()` standalone function (v0.2.0)
- [x] ✅ Add `patchPage()` for existing pages (v0.2.0)
- [x] ✅ Add `createSession()` for temporary sessions (v0.2.0)

### Architecture
- [ ] Restructure exports to modular format
- [ ] Add Playwright integration stub
- [ ] Convert sync operations to async
- [ ] Add `BrowserProfilesSync` for explicit sync usage

### Types
- [ ] Add stricter types with JSDoc
- [ ] Add discriminated unions for results
- [ ] Export all types from `@aitofy/browser-profiles/types`

### Documentation
- [x] ✅ Update README with ESM support info
- [ ] Add migration guide from v0.1.x
- [ ] Add examples for ESM and CJS projects

---

## 🧪 Test Scenarios

```bash
# Test 1: CJS project with ts-node
cd test-cjs && npm install && npm test

# Test 2: ESM project with tsx
cd test-esm && npm install && npm test

# Test 3: Vite project
cd test-vite && npm install && npm run dev

# Test 4: Next.js project
cd test-nextjs && npm install && npm run dev
```

---

## 📦 Release Notes

### v0.2.0 (2026-01-09)

**Breaking Changes:**
- None (backward compatible)

**Bug Fixes:**
- ✅ **Fixed ESM compatibility** - Package now works in ESM environments (tsx, vite, next.js, etc.)
  - Replaced `require()` with dynamic `import()` in `getPuppeteer()`
  - Properly handles both ESM default exports and CJS module.exports
  - Cleaner error messages with proper newlines

**New Features:**

1. **`puppeteer` option** - Inject your own puppeteer instance:
```typescript
import puppeteer from 'rebrowser-puppeteer-core';

const { browser, page } = await withPuppeteer({
  profile: 'my-profile',
  puppeteer, // Use your own puppeteer instance
});

// Also works with quickLaunch and connectPuppeteer
const { page } = await quickLaunch({ puppeteer });
const { browser } = await connectPuppeteer(wsEndpoint, { puppeteer });
```

2. **`patchPage()` function** - Apply anti-detect patches to any existing page:
```typescript
import { patchPage } from '@aitofy/browser-profiles/puppeteer';

const browser = await puppeteer.launch();
const page = await browser.newPage();

// Apply anti-detect patches
await patchPage(page, {
  webdriver: true,     // Hide webdriver flag
  plugins: true,       // Spoof Chrome plugins
  chrome: true,        // Fix chrome object (csi, loadTimes)
  webrtc: true,        // WebRTC leak protection
  fingerprint: {
    platform: 'Win32',
    hardwareConcurrency: 8,
    deviceMemory: 16,
    language: 'en-US',
  },
});
```

3. **`createSession()` function** - Lightweight temporary sessions with random fingerprints:
```typescript
import { createSession } from '@aitofy/browser-profiles/puppeteer';

// Quick session with random fingerprint - perfect for scraping
const session = await createSession({
  temporary: true,
  randomFingerprint: true, // Random platform, language, cores, memory
  proxy: { type: 'http', host: 'proxy.com', port: 8080 },
});

await session.page.goto('https://example.com');
const title = await session.page.evaluate(() => document.title);

await session.close(); // Cleanup

// Or with custom fingerprint
const session2 = await createSession({
  fingerprint: {
    platform: 'MacIntel',
    language: 'ja-JP',
    hardwareConcurrency: 16,
  },
  timezone: 'Asia/Tokyo',
});
```

4. **`generateFingerprint()` function** - Generate complete browser fingerprints on-demand:
```typescript
import { generateFingerprint, getFingerprintScripts } from '@aitofy/browser-profiles';

// Random fingerprint
const fp = generateFingerprint();
console.log(fp.userAgent);      // Mozilla/5.0 (Windows NT 10.0...
console.log(fp.platform);       // Win32
console.log(fp.screen);         // { width: 1920, height: 1080, ... }
console.log(fp.webgl.renderer); // ANGLE (NVIDIA, GeForce GTX 1080...)

// Specific platform
const macFp = generateFingerprint({
  platform: 'macos',
  gpu: 'apple',
  screen: 'retina',
  language: 'ja-JP',
});

// Get all injection scripts for a fingerprint
const scripts = getFingerprintScripts(fp);
await page.evaluateOnNewDocument(scripts);
```

5. **`launchChromeStandalone()` function** - Launch Chrome without profile management:
```typescript
import { launchChromeStandalone } from '@aitofy/browser-profiles';
import puppeteer from 'puppeteer-core';

// Quick Chrome launch without profile
const { wsEndpoint, close } = await launchChromeStandalone({
  headless: false,
  proxy: { type: 'http', host: 'proxy.com', port: 8080 },
  fingerprint: {
    platform: 'Win32',
    language: 'en-US',
  },
});

// Connect with Puppeteer
const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
const page = await browser.newPage();

await page.goto('https://example.com');
await close(); // Cleans up temp directory too
```

**Improvements:**
- Better code organization in `getPuppeteer()` with loop-based package detection
- Cleaner logging with package labels
- Dual ESM/CJS package support verified
- Added `puppeteer` option to `connectPuppeteer()` as well

**Tested Environments:**
- ✅ Node.js with CommonJS
- ✅ Node.js with ESM (`"type": "module"`)
- ✅ tsx (TypeScript execution)
- ✅ Vite projects
- ✅ Next.js projects

**Dependencies:**
- Updated peerDependencies for clearer dependency requirements
