# Anti-detect

What a profile actually hides, how it is applied, and where the limits are. No extension is
installed and no Chromium is patched: everything is applied over CDP when the browser launches.

## What is protected

| Surface | What happens |
|---------|--------------|
| User agent and Client Hints | The user agent is built from the major version of the Chrome that is actually running, read over CDP with `Browser.getVersion` at launch. `Network.setUserAgentOverride` sets it together with the platform, the Accept-Language header, and a matching `userAgentMetadata` (brands, full version list, platform, platform version, architecture, mobile) so `navigator.userAgentData` agrees with the string. |
| navigator and automation traces | CDP and webdriver bindings removed, `navigator.webdriver` hidden, `window.chrome` with `runtime`, `csi()` and `loadTimes()`, faked `plugins`, `connection`, `getBattery()` and `permissions.query`, plus `language`, `platform`, `hardwareConcurrency` and `deviceMemory` from the profile. |
| WebRTC | Local and public IP leaks blocked, including behind a proxy. |
| Canvas | A small random channel shift, fixed for the lifetime of the page, added to canvas readbacks (`getImageData`, `toDataURL`, `toBlob`). |
| WebGL | Vendor and renderer strings and GPU parameters spoofed, noise added to buffer reads. The pair is picked once when the profile is created, consistent with its platform, and stored in `fingerprint.webgl`, so the same GPU is reported on every page and every launch. |
| Workers | `Worker` and `SharedWorker` are wrapped so the navigator and WebGL spoof runs before the worker script: a worker reports the same values as the main thread. |
| Audio | Tiny noise added to AudioContext output, inaudible but enough to break the fingerprint. |
| Timezone | Chrome is started with `TZ` set and `Emulation.setTimezoneOverride` is applied, so the clock and `Intl` agree. With a proxy and no explicit timezone, it is detected from the proxy exit IP. |
| Language | `navigator.language` and the Accept-Language header come from the same profile field. |
| Cookies | Cookies stored on the profile are installed once per launch with `Storage.setCookies`, so every tab and every browser context sees them. |

Defaults when a profile does not say: a Windows user agent for the running Chrome's version,
platform `Win32`, language `en-US`, 8 cores, 8 GB of device memory, and `America/New_York` when no
timezone can be resolved.

Setting `fingerprint.userAgent` pins the user agent instead. It then wins over the detected version,
and a warning is logged when its Chrome major differs from the running browser, because detectors
compare the two.

## Per-tab injection

The protections are not applied once to the first tab. The process that launched Chrome keeps a CDP
connection with auto-attach enabled: every new page or iframe target is paused before its first
script runs, gets the user agent override, the init script and the timezone override, and is only
then resumed.

That is why tabs opened later — by your automation, by Playwright MCP, by a `window.open`, or by a
click — are protected exactly like the first one.

The exception is `detached`, which has no owning process and therefore injects into the first tab
only. See [browser-lifecycle.md](./browser-lifecycle.md).

## Score

| Site | Score | Note |
|------|-------|------|
| browserleaks.com | 100% | All checks passed |
| pixelscan.net | 100% | Hardware fingerprint passed |
| browserscan.net | 95% | Bot Control -5% (Puppeteer limitation) |
| creepjs | 85% | Minor deductions |

95% is the best achievable with Puppeteer or Playwright. The remaining 5% is the Puppeteer ceiling:
AdsPower and Multilogin reach 100% by shipping a modified Chromium binary, while this library drives
standard Chrome with JS injection over CDP. For social media, e-commerce and scraping work, 95% is
sufficient.

## Honest limits

- Detection is an arms race. The scores above were measured against those sites at a point in time,
  not a guarantee about any particular site today.
- `headless: true` is more detectable than a real window, whatever is injected. The default is
  false for that reason.
- A fingerprint that contradicts itself defeats the point: a `MacIntel` platform with a Windows user
  agent, or a `Europe/Berlin` timezone behind a US proxy, is more suspicious than no spoofing at
  all. Match `timezone`, `language` and `platform` to the proxy exit country.
- `detached: true` drops to flag-level protection only, and cannot use an authenticated proxy.
- Nothing here hides behaviour. Request rate, mouse movement and login patterns are not part of a
  fingerprint, and they are what most account bans are based on.
- Chrome's own crash reporting and update channels are unchanged; this library adds zero telemetry
  of its own.
- With an external CDP client attached (Playwright MCP, `puppeteer.connect`), a popup opened by
  `window.open` may escape injection: the other client can resume the popup before our session
  injects into it. Tabs created through `newPage` are protected. Through the library's own
  Puppeteer and Playwright integrations the gap is closed, because they re-inject the same bundle
  with `evaluateOnNewDocument` / `addInitScript`.
- Module workers and service workers are passed through untouched; only `Worker` and `SharedWorker`
  are wrapped.

## See also

[library.md](./library.md) · [browser-lifecycle.md](./browser-lifecycle.md) ·
[playwright-mcp.md](./playwright-mcp.md) · [configuration.md](./configuration.md)
