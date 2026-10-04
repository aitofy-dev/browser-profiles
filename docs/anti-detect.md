# Anti-detect

What a profile actually hides, how it is applied, and where the limits are. No extension is
installed. Two engines, plus a real mode that uses neither:

| Engine | When | How |
|--------|------|-----|
| `kernel` | The executable is a [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) build, or `engine: "kernel"` | Chromium spoofs the fingerprint from a per-profile seed (`--fingerprint`). No JavaScript hooks are installed. |
| `inject` | Stock Google Chrome, or `engine: "inject"` | Scripts and CDP overrides, applied when the browser launches. |
| `real` | The profile has `fingerprint: { mode: "real" }` | Nothing. Chrome runs with its own identity. See [Real mode](#real-mode). |

`engine` defaults to `auto`: kernel when the binary's switch table (the framework on macOS,
`chrome.dll` on Windows) contains `fingerprint-platform`, inject otherwise. With no `chromePath` and no `CHROMIUM_PATH`/`CHROME_PATH`, a kernel build at
`~/.aitofy/browser-profiles/kernel/` or a `Chromium.app` that has the switch is preferred over
Google Chrome.

## Real mode

For your own accounts, signed in by hand once (Google Cloud, Firebase, Play Console, Cloudflare).
A spoofed fingerprint on such an account reads as a new device and triggers verification, so a
real profile spoofs nothing. Create it with `--fingerprint real` (CLI), `fingerprint: "real"`
(MCP) or `fingerprint: { mode: 'real' }` (library). `browser open` then reports `engine: "real"`,
and so does `browser status`.

What a real launch does not do:

- no generated fingerprint, user agent or Client Hints override, and no stored GPU
- no injected script, no per-tab CDP session, no auto-attach: the launcher's only CDP connection
  installs stored cookies, if any, and watches for the browser to exit
- no kernel flags and no anti-detect flags except `--disable-blink-features=AutomationControlled`,
  which keeps `navigator.webdriver` false as in a Chrome opened by hand
- no timezone and no locale: Chrome keeps the host's clock and language unless the profile sets
  `timezone` (sent as `TZ`) or `language` (sent as `--lang`, which Chrome on macOS ignores; change
  the language in Chrome's settings instead, it is stored in the profile)

What it keeps: the profile's own user-data directory, the CDP endpoint, lock and reuse, `close`,
the profile's proxy (with the WebRTC policy that stops UDP from bypassing it) and `chromePath`.

What it does not protect: anything. The browser is exactly as identifiable as your own Chrome on
this machine, and two real profiles on one machine look like the same device. Do not use it for
accounts that must not be linked. A real profile refuses `engine: "kernel"` or `"inject"` with
`INVALID_CONFIG`; open it with `auto`. Switching a profile to real drops its stored spoof settings
except the language, and its stored timezone (often the `America/New_York` default) unless the same
update sets one. A browser already running keeps its old mode until it is closed.

## Kernel engine

The seed is a hash of the profile id, so the same profile is the same machine and a duplicate is
a new one. Flags passed to the binary:

| Surface | Flag |
|---------|------|
| Seed | `--fingerprint=<seed>` |
| Platform | `--fingerprint-platform` from `Win32` / `MacIntel` / `Linux x86_64`. A profile with no platform claims this machine's OS: the CPU shows through, and Windows claimed on Apple Silicon reads as a virtual machine to fingerprint.com. |
| Display | `--force-color-profile=srgb` when another OS is claimed on a Mac, since only Mac displays report a P3 gamut and HDR. |
| Brand | `--fingerprint-brand=Chrome`. The brand version is the binary's own, so the UA matches the browser. `fingerprint.userAgent` is ignored and a warning is logged. |
| CPU cores | `--fingerprint-hardware-concurrency` when the profile sets it. Otherwise the seed decides. |
| Language | `--lang` and `--accept-lang` |
| Timezone | `--timezone` plus the `TZ` environment variable. With a proxy and no `timezone`, it comes from the IP the proxy exits from, looked up through the proxy itself. |
| WebRTC | `--disable-non-proxied-udp` |
| Canvas, audio | On, unless the profile sets that surface to `real` (`--disable-spoofing`) |
| WebGL, fonts, client rects, device memory, webdriver | Derived inside the binary from the seed. `fingerprint.webgl` is not applied; current kernels no longer accept a vendor string. |

### Which binary

The library drives whatever binary it is given and does not ship one. Any build can be chosen with
`chromePath`, `CHROMIUM_PATH` or `CHROME_PATH` ([configuration.md](./configuration.md#chrome-executable)).
The build the benchmark ran on:

| Build | Platform | SHA-256 |
|-------|----------|---------|
| [fingerprint-chromium 148.0.7778.215-1.1](https://github.com/adryfish/fingerprint-chromium/releases/tag/148.0.7778.215) | macOS arm64 (`…_macos.dmg`) | `b72f091e2e1a7583eed389c4b8e3534ed355e568af8c8bbf8fc30a25e23ca679` |

The binary is a third party's: its fingerprint quality, update pace and security fixes are not
something this library can promise. It trails Chrome stable, which ships a major every two weeks.

Cookies are still installed once with `Storage.setCookies`. The launcher keeps one CDP connection
that pauses each new page only to send `Emulation.setLocaleOverride`: Chrome on macOS ignores
`--lang`, so without it `Intl` reports the host's locale. No script and no other override is sent.
Puppeteer and Playwright integrations do not add an init script in this mode.

`engine: "kernel"` on stock Chrome fails before launch. Skipping the hooks without the binary
would open a browser that spoofs nothing.

## Inject engine

What the JavaScript path protects:

| Surface | What happens |
|---------|--------------|
| User agent and Client Hints | The user agent is built from the major version of the Chrome that is actually running, read over CDP with `Browser.getVersion` at launch. `Network.setUserAgentOverride` sets it together with the platform, the Accept-Language header, and a matching `userAgentMetadata` (brands, full version list, platform, platform version, architecture, mobile) so `navigator.userAgentData` agrees with the string. |
| navigator and automation traces | CDP and webdriver bindings removed, `navigator.webdriver` hidden, `window.chrome` with `runtime`, `csi()` and `loadTimes()`, faked `plugins`, `connection`, `getBattery()` and `permissions.query`, plus `language`, `platform`, `hardwareConcurrency` and `deviceMemory` from the profile. |
| WebRTC | Local and public IP leaks blocked, including behind a proxy. |
| Canvas | A small random channel shift, fixed for the lifetime of the page, added to canvas readbacks (`getImageData`, `toDataURL`, `toBlob`). |
| WebGL | Vendor and renderer strings and GPU parameters spoofed, noise added to buffer reads. The pair is picked once when the profile is created, consistent with its platform, and stored in `fingerprint.webgl`, so the same GPU is reported on every page and every launch. |
| Workers | Every worker target (dedicated, module, shared, service) is paused at start, gets the navigator, user agent and WebGL spoof, and is then resumed, so it reports the same values as the main thread. `Worker` and `SharedWorker` are also wrapped from the page, for clients that inject without the launcher. |
| Audio | Tiny noise added to AudioContext output, inaudible but enough to break the fingerprint. |
| Timezone | Chrome is started with `TZ` set and `Emulation.setTimezoneOverride` is applied, so the clock and `Intl` agree. With a proxy and no explicit timezone, it is detected from the proxy exit IP. |
| Language | `navigator.language`, the Accept-Language header and `Intl` (`Emulation.setLocaleOverride`) come from the same profile field. Chrome on macOS ignores `--lang`, so without the override `Intl` reports the host's locale. |
| Cookies | Cookies stored on the profile are installed once per launch with `Storage.setCookies`, so every tab and every browser context sees them. |

Defaults when a profile does not say: a Windows user agent for the running Chrome's version,
platform `Win32`, language `en-US`, 8 cores, 8 GB of device memory, and `America/New_York` when no
timezone can be resolved.

Setting `fingerprint.userAgent` pins the user agent instead. It then wins over the detected version,
and a warning is logged when its Chrome major differs from the running browser, because detectors
compare the two.

## Per-tab injection

Inject mode only. The protections are not applied once to the first tab. The process that launched
Chrome keeps a CDP
connection with auto-attach enabled: every new page or iframe target is paused before its first
script runs, gets the user agent override, the init script, the timezone and the locale override,
and is only then resumed. Worker targets get the worker spoof the same way.

That is why tabs opened later — by your automation, by Playwright MCP, by a `window.open`, or by a
click — are protected exactly like the first one.

The exception is `detached`, which has no owning process and therefore injects into the first tab
only. Kernel mode keeps the spoof on later tabs, because it is a process flag; only the locale
override is limited to the first tab. See
[browser-lifecycle.md](./browser-lifecycle.md).

## Score

Measured against AdsPower, GPM Login and Multilogin in [benchmark.md](./benchmark.md). The inject
engine hooks Canvas and WebGL from JavaScript, and creepjs flags those hooks whatever values they
return; kernel mode does not install them.

## Honest limits

- Detection is an arms race. A score is a measurement against one site at one point in time, not a
  guarantee about any particular site today.
- `headless: true` is more detectable than a real window, whatever is injected. The default is
  false for that reason.
- A fingerprint that contradicts itself defeats the point: a `MacIntel` platform with a Windows user
  agent, or a `Europe/Berlin` timezone behind a US proxy, is more suspicious than no spoofing at
  all. Match `timezone`, `language` and `platform` to the proxy exit country.
- `detached: true` on the inject engine drops to flag-level protection only, and cannot use an
  authenticated proxy. Kernel mode keeps the spoof, because it lives in the process flags, but
  later tabs report the host's `Intl` locale on macOS. The
  proxy limit is the same: the relay dies with the opener.
- Nothing here hides behaviour. Request rate, mouse movement and login patterns are not part of a
  fingerprint, and they are what most account bans are based on.
- Chrome's own crash reporting and update channels are unchanged; this library adds zero telemetry
  of its own.
- Inject mode, with an external CDP client attached (Playwright MCP, `puppeteer.connect`): a popup
  opened by `window.open` may escape injection, because the other client can resume the popup
  before our session injects into it. Tabs created through `newPage` are protected. Through the
  library's own Puppeteer and Playwright integrations the gap is closed, because they re-inject the
  same bundle with `evaluateOnNewDocument` / `addInitScript`. Kernel mode does not inject, so this
  race does not apply.
- Kernel mode claiming Windows on an Apple Silicon Mac is not well supported. The CPU shows
  through (fingerprint.com reports a virtual machine), and pixelscan reports masking because the
  binary lacks the full set of Windows core fonts. Claim the host's OS, which is the default, or run
  Windows profiles on a Windows machine.
- fingerprint-chromium builds ship without Widevine, which Google Chrome always has, so a page that
  asks for `com.widevine.alpha` can tell the kernel from Chrome, and DRM video does not play. The
  library does not add it: Widevine is licensed by Google and is not ours to copy or distribute.
- Worker targets are only spoofed while the launching process holds its CDP connection. With
  `detached: true`, module and service workers keep the real values; only `Worker` and
  `SharedWorker` are wrapped from the page.

## See also

[library.md](./library.md) · [browser-lifecycle.md](./browser-lifecycle.md) ·
[playwright-mcp.md](./playwright-mcp.md) · [configuration.md](./configuration.md)
