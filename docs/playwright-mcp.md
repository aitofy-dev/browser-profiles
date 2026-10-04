# Drive a profile with Playwright MCP

`browser_open` (and `browser open` on the CLI) returns a `wsEndpoint`: a plain CDP WebSocket URL.
Hand it to anything that speaks CDP and the profile's proxy, timezone and fingerprint protection
stay in effect.

## The flow

1. Open the profile. The CLI prints the endpoint and stays in the foreground until Ctrl+C.

   ```bash
   browser-profiles browser open acme-main --json
   # {"profileId":"acme-main","wsEndpoint":"ws://127.0.0.1:9222/devtools/browser/ab12...","port":9222,"pid":51234,"reused":false,"detached":false}
   ```

   An agent does the same with the `browser_open` MCP tool and reads `wsEndpoint` off the result.

2. Point Playwright MCP at that endpoint, in another terminal:

   ```bash
   npx -y @playwright/mcp@latest --cdp-endpoint ws://127.0.0.1:9222/devtools/browser/ab12...
   ```

3. Drive the browser through Playwright MCP as usual. When you are done:

   ```bash
   browser-profiles browser close acme-main
   ```

Both MCP servers can be registered at once: one to manage profiles, one to drive pages. The agent
calls `browser_open`, then starts or reconfigures Playwright MCP with the returned endpoint.

## A fixed port: configure Playwright MCP once

With `--port`, the endpoint is known before the browser starts, so Playwright MCP can sit in an
MCP config file instead of being started per session:

```bash
browser-profiles browser open acme-main --port 9301
npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9301
```

Pick one port per profile. A browser that is already running keeps the port it started with.

## From code

The same endpoint works with any CDP client.

```typescript
// Puppeteer
const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });

// Playwright
const browser = await chromium.connectOverCDP(wsEndpoint);
```

`connectPuppeteer(wsEndpoint)` and `connectPlaywright(wsEndpoint)` are exported as thin wrappers
over exactly those two calls — see [library.md](./library.md).

## Why every new tab stays protected

Connecting over CDP does not weaken the protections. While the process that launched Chrome is
still running, it holds its own CDP connection with auto-attach enabled: new page and iframe
targets are paused on creation, the per-tab protections are applied to them, and only then are they
allowed to run.

So a tab opened by Playwright MCP, by a `window.open` in the page, or by you clicking a link gets
the same user agent and Client Hints, the same `Page.addScriptToEvaluateOnNewDocument` injections
(WebRTC, canvas, WebGL, audio, navigator) and the same timezone override as the first tab, before
any page script runs.

Two things break that guarantee:

- `detached: true` / `--detached`, where nothing holds the CDP connection and only the first tab is
  injected. See [browser-lifecycle.md](./browser-lifecycle.md).
- Closing the owner process. The browser then keeps running only if it was detached; otherwise it
  is closed with its owner.

## See also

[mcp.md](./mcp.md) · [browser-lifecycle.md](./browser-lifecycle.md) ·
[anti-detect.md](./anti-detect.md) · [library.md](./library.md) ·
[`../examples/playwright-connect.ts`](../examples/playwright-connect.ts)
