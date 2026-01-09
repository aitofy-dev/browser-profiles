# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-01-09

### Changed

- **Simplified imports** - All Puppeteer functions now available from main entry point
  ```typescript
  // Before (still works)
  import { quickLaunch } from '@aitofy/browser-profiles/puppeteer';
  
  // Now also available (recommended)
  import { quickLaunch } from '@aitofy/browser-profiles';
  ```

- Re-exported from main entry:
  - `withPuppeteer`, `quickLaunch`, `connectPuppeteer`
  - `patchPage`, `createSession`
  - All related TypeScript types

## [0.2.0] - 2026-01-09

### Added

#### New Functions
- **`createSession()`** - Create lightweight temporary browser sessions with random fingerprints
  ```typescript
  const session = await createSession({
    temporary: true,
    randomFingerprint: true,
    proxy: { type: 'http', host: 'proxy.com', port: 8080 },
  });
  ```

- **`patchPage()`** - Apply anti-detect patches to any existing Puppeteer page
  ```typescript
  await patchPage(page, {
    webdriver: true,
    plugins: true,
    webrtc: true,
    fingerprint: { platform: 'Win32' },
  });
  ```

- **`generateFingerprint()`** - Generate complete browser fingerprints on-demand
  ```typescript
  const fp = generateFingerprint({
    platform: 'macos',
    gpu: 'apple',
    language: 'ja-JP',
  });
  ```

- **`getFingerprintScripts()`** - Get all injection scripts for a fingerprint
  ```typescript
  const scripts = getFingerprintScripts(fp);
  await page.evaluateOnNewDocument(scripts);
  ```

- **`launchChromeStandalone()`** - Launch Chrome without profile management
  ```typescript
  const { wsEndpoint, close } = await launchChromeStandalone({
    headless: false,
    proxy: { type: 'http', host: 'proxy.com', port: 8080 },
  });
  ```

#### New Options
- Added `puppeteer` option to `withPuppeteer()`, `quickLaunch()`, and `connectPuppeteer()` to inject your own puppeteer instance
  ```typescript
  import puppeteer from 'rebrowser-puppeteer-core';
  const { browser, page } = await withPuppeteer({
    profile: 'my-profile',
    puppeteer, // Use your own instance
  });
  ```

### Fixed

- **ESM Compatibility** - Package now works correctly in ESM environments (tsx, vite, next.js)
  - Replaced `require()` with dynamic `import()` in `getPuppeteer()`
  - Properly handles both ESM default exports and CJS module.exports
  - Cleaner error messages with proper newlines

### Changed

- Better code organization in `getPuppeteer()` with loop-based package detection
- Cleaner logging with package labels
- Improved TypeScript types with better documentation

### Types

- Added `GenerateFingerprintOptions` and `GeneratedFingerprint` types
- Added `StandaloneLaunchOptions` and `StandaloneLaunchResult` types
- Added `PatchPageOptions`, `CreateSessionOptions`, and `SessionResult` types

## [0.1.1] - 2026-01-07

### Fixed
- Minor bug fixes and stability improvements

## [0.1.0] - 2026-01-06

### Added
- Initial release
- `BrowserProfiles` class for profile management
- `withPuppeteer()` and `quickLaunch()` for Puppeteer integration
- `withPlaywright()` for Playwright integration
- Anti-detect features: WebRTC, Canvas, WebGL, Audio fingerprint protection
- Proxy support with auto timezone detection
- ExTower integration

[0.2.0]: https://github.com/aitofy-dev/browser-profiles/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/aitofy-dev/browser-profiles/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aitofy-dev/browser-profiles/releases/tag/v0.1.0
