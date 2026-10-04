# Benchmark

Every engine of this library next to the anti-detect browsers people pay for, on the same machine,
the same proxy and the same pages. Measured 2026-10-04 with [`scripts/measure.mjs`](../scripts/measure.mjs).

## Setup

- Host: macOS on Apple Silicon. Every profile claims Windows, so a mismatch with the real machine is
  something each engine has to hide.
- Proxy: one US residential proxy for all engines (Multilogin excepted, see the notes).
- Profile: `Win32`, `en-US`, timezone from the proxy.
- Method: the site is opened in a new tab while no automation client is attached. After 30–40 s the
  script reconnects only to read the page and take a screenshot. IP addresses are masked before capture.

| Engine | Browser |
|--------|---------|
| `kernel` (this library) | fingerprint-chromium 148 |
| `inject` (this library) | Google Chrome 154 |
| AdsPower | SunBrowser 153 |
| GPM Login | Chromium 149 |
| Multilogin | Mimic 153 |
| Stock Chrome | Google Chrome 154 driven by Puppeteer, no spoofing (the control) |

## Results

| Engine | browserscan | Cloudflare challenge | fingerprint.com bot | fingerprint.com tampering | fingerprint.com suspect score | pixelscan | deviceandbrowserinfo | rebrowser |
|--------|-------------|----------------------|---------------------|---------------------------|-------------------------------|-----------|----------------------|-----------|
| `kernel` | 100% | passed | not detected | detected | 38 | inconsistent, masking | human | clean |
| AdsPower | 100% | passed | not detected | detected | 30 | consistent | human | clean |
| GPM Login | 100% | passed | not detected | detected | 16 | did not finish | human | clean |
| Multilogin | 90% | passed | not detected | detected | 39 | inconsistent | human | clean |
| `inject` | 85% | blocked | bot | detected | 45 | did not finish | human | clean |
| Stock Chrome | 75% | blocked | bot | not detected | 18 | inconsistent | bot | `navigator.webdriver` |

creepjs: `kernel`, AdsPower, GPM Login and Multilogin all show 0% stealth and no extension; `inject`
shows 20% stealth and its hooks are reported as an extension.

Sites: [browserscan](https://www.browserscan.net/),
[Cloudflare challenge](https://www.scrapingcourse.com/antibot-challenge),
[fingerprint.com playground](https://demo.fingerprint.com/playground),
[pixelscan](https://pixelscan.net/fingerprint-check),
[deviceandbrowserinfo](https://deviceandbrowserinfo.com/are_you_a_bot),
[rebrowser bot detector](https://bot-detector.rebrowser.net/),
[creepjs](https://abrahamjuliot.github.io/creepjs/).

## What it shows

- No engine hides from fingerprint.com. Every anti-detect browser here, paid or not, is reported as
  `anti_detect_browser: true`.
- `kernel` matches the paid browsers on Cloudflare, bot detection, deviceandbrowserinfo and rebrowser.
  It loses to AdsPower on pixelscan.
- `inject` is the fallback for when no kernel binary is installed. JavaScript hooks are visible to
  creepjs and fingerprint.com, and Cloudflare blocks it.

## Limits of this run

- One run, one machine, one proxy. Scores move between runs and between site versions.
- `inject` was measured again after its navigator overrides moved to `Navigator.prototype`: that
  removed the browserscan bot flag and the rebrowser `navigator.webdriver` finding. Its pixelscan and
  deviceandbrowserinfo cells are from the run before.
- Multilogin ran on its free plan, which has no automation API. Its own profile and proxy were used,
  opened by hand with remote debugging allowed. Its 90% on browserscan is a timezone that did not
  match that proxy, a profile setting rather than the engine.
- GPM Login kept the host's language for the whole profile. That is consistent, so browserscan did
  not deduct for it.
- pixelscan did not finish its fingerprint step for GPM Login and `inject` within the wait.
- The fingerprint-chromium build is six Chrome majors behind stable; its user agent says so.
- iphey reported every engine, stock Chrome included, as unreliable, so it is left out.
- Gologin was not measured: no active plan was available.

## Reproduce

```bash
npm run build
export PROXY_URL=http://user:pass@host:port
KERNEL_PATH=/path/to/fingerprint-chromium node scripts/measure.mjs
```

The header of the script lists the variables that add AdsPower, GPM Login, Multilogin or any
browser that is already open. Screenshots and page text land in `measurements/`.
