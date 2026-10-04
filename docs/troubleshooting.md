# Troubleshooting

The failures people actually hit, with the exact message and the fix. Turn on logging first: every
diagnostic goes to stderr and is silent by default.

```bash
DEBUG=browser-profiles* browser-profiles browser open acme-main
browser-profiles browser open acme-main --verbose
```

## Chrome not found

```
Failed to open browser for "acme-main": Chrome/Chromium not found. Please install Chrome or set CHROME_PATH environment variable.
```

Error code `CHROME_NOT_FOUND`. The launcher looks at an explicit `chromePath`, then `CHROMIUM_PATH`
or `CHROME_PATH`, then a fingerprint-chromium kernel, then the platform's usual install locations,
and each candidate must exist on disk.

Install Google Chrome, or point at the binary you have:

```bash
CHROME_PATH=/opt/google/chrome/chrome browser-profiles open acme-main
```

From the library, pass it instead: `new BrowserProfiles({ chromePath })` or
`profiles.launch(id, { chromePath })`.

## Kernel mode on stock Chrome

```
Failed to open browser for "acme-main": Kernel mode needs a fingerprint-chromium binary (engine-level spoof). This executable has no --fingerprint-platform switch, so the only spoof left would be JavaScript hooks, and those hooks are what browserscan and creepjs flag. Set CHROMIUM_PATH to a fingerprint-chromium build, or install the app at ~/.aitofy/browser-profiles/kernel/Chromium.app (macOS), ~/.aitofy/browser-profiles/kernel/chrome (Linux), or %USERPROFILE%\.aitofy\browser-profiles\kernel\chrome.exe (Windows). Builds: https://github.com/adryfish/fingerprint-chromium/releases
```

Error code `LAUNCH_FAILED`. `engine: "kernel"` was asked for, and the resolved executable is stock
Chrome. `engine: "auto"` (the default) does not throw: it falls back to JavaScript injection.

Install a fingerprint-chromium build and point at it:

```bash
CHROMIUM_PATH=/path/to/Chromium.app/Contents/MacOS/Chromium browser-profiles open acme-main --engine kernel
```

## Proxy failed

```
Failed to open browser for "acme-main": Failed to configure proxy: <reason from the relay>
```

Error code `LAUNCH_FAILED`. The local relay that answers the proxy challenge for Chrome could not
start. Check the host, the port and the credentials, and that the proxy is reachable from this
machine.

A malformed proxy URL fails earlier, with `INVALID_CONFIG` and a message that names the problem:

```
Proxy URL "http://gate.provider.net" has no port. A port is required, e.g. "http://gate.provider.net:8080".
Unsupported proxy scheme "ftp" in "ftp://host:21". Supported schemes: http, https, socks5 (aliases: socks, socks5h).
Proxy password is not valid percent-encoding. Encode reserved characters, e.g. "p@ss" as "p%40ss".
```

A proxy URL is always `<scheme>://[user:pass@]host:port` with an explicit port, no path, no query.

A detached launch with an authenticated proxy is refused before Chrome starts, with
`INVALID_CONFIG`:

```
detached=true cannot be combined with an authenticated proxy: Chrome cannot send the credentials itself, and the local relay that does dies with this process, leaving the browser unable to reach the network. Drop detached, or use a proxy without a username and password.
```

Drop `--detached`, or use a proxy with no username and password.

## WebSocket endpoint failed

```
Failed to open browser for "acme-main": Failed to get browser WebSocket endpoint after multiple retries
```

Error code `LAUNCH_FAILED`. Chrome started but never answered on its DevTools port. Usually Chrome
died during startup: run with `--verbose` to see the launcher's own log lines, check that the
profile's user-data directory is writable, and try `--headless` on a machine with no display.

## Stale lock

A browser that crashed leaves `.browser-lock.json` behind in the profile's user-data directory.
That is handled: `browser status` and `browser close` probe the recorded port, find nothing
answering, delete the lock and report `closed: false`. Nothing is killed, because the recorded PID
may have been recycled onto an unrelated process.

Two messages mean a lock that is *not* stale:

```
Could not take the lock for profile "Acme Main": another process keeps claiming /Users/me/.aitofy/browser-profiles/profiles/acme-main/data/.browser-lock.json. Close it with browser.close or delete that file.
```

Another process is repeatedly mid-launch for the same profile. Close it with
`browser-profiles close acme-main`, or delete that file if you are sure nothing is running.

```
Another Chrome still holds /Users/me/.aitofy/browser-profiles/profiles/acme-main/data. Close it before opening this profile.
```

A live Chrome outside this tool holds the user-data directory's singleton lock. Two Chromes on one
user-data dir corrupt it, so the launch refuses. Quit that Chrome and retry.

## Port already in use

Ports are assigned by the launcher, so a clash is not normally possible. What looks like one is a
browser already running for the profile: `browser open` returns the existing endpoint with
`reused: true` rather than starting a second Chrome. `browser-profiles status` lists every running
browser for the storage path with its port and endpoint; `browser-profiles close-all` closes them
all.

If a *stale* lock points at a port some other program has since taken, the launcher detects that the
port answers as a different browser, treats the lock as stale and relaunches.

## Profile not found

```
Profile not found: "acme". Did you mean: Acme Main (acme-main)?
```

Error code `PROFILE_NOT_FOUND`. `<idOrName>` is an id or the exact name, case-insensitive, ids
first. The message suggests close matches; `browser-profiles profile list` shows everything. Check
`--storage-path` / `BROWSER_PROFILES_HOME` too — profiles are scoped to one storage path.

## Puppeteer not found

```
Puppeteer not found. Please install one of the following:
  npm install rebrowser-puppeteer-core  (recommended for anti-detect)
  npm install puppeteer-core
  npm install puppeteer
```

The library calls are peer-dependent on a Puppeteer build; install one. Playwright users get the
equivalent message asking for `playwright` plus `npx playwright install chromium`.

## MCP client shows no tools

Something wrote to stdout, which belongs to the JSON-RPC stream. Run `browser-profiles mcp` by hand
and look for any non-JSON line. In your own command code, diagnostics go through `ctx.log`
(stderr), never `console.log`.

## `--json` output has extra lines in it

It should not: stdout carries exactly the command's output object, and everything else goes to
stderr. If you are seeing more, you are capturing stderr too — use `2>/dev/null` or keep the streams
apart.

## See also

[cli.md](./cli.md) · [configuration.md](./configuration.md) ·
[browser-lifecycle.md](./browser-lifecycle.md) · [mcp.md](./mcp.md) ·
[`../CONTRIBUTING.md`](../CONTRIBUTING.md)
