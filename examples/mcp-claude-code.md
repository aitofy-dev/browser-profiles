# Drive browser profiles from Claude Code

## 1. Add the server

```bash
claude mcp add browser-profiles -- npx -y @aitofy/browser-profiles mcp
```

Add `--storage-path /data/profiles` after `mcp` to keep profiles elsewhere. `/mcp` in Claude Code
should now list `profile_create`, `browser_open`, `browser_close` and the rest.

## 2. Ask Claude to create a profile and open it

> Create a browser profile named "Acme Main" with id `acme-main`, timezone `America/New_York` and
> the proxy `http://user:pass@proxy.example.com:8080`. Then open it and tell me the wsEndpoint.

Claude calls `profile_create` with
`{ "name": "Acme Main", "id": "acme-main", "timezone": "America/New_York", "proxy": "http://user:pass@proxy.example.com:8080" }`,
then `browser_open` with `{ "idOrName": "acme-main" }`, which returns
`{ "profileId": "acme-main", "wsEndpoint": "ws://127.0.0.1:9222/devtools/browser/…", "port": 9222, "pid": 51234, "reused": false }`.

A real Chrome window opens with the proxy, timezone and fingerprint protection applied. Asking
again returns the same endpoint with `reused: true` instead of a second browser.

## 3. Attach Playwright MCP to that browser

```bash
claude mcp add playwright -- npx -y @playwright/mcp@latest --cdp-endpoint ws://127.0.0.1:9222/devtools/browser/…
```

> Using Playwright, open browserleaks.com/javascript and tell me the reported platform and timezone.

Tabs Playwright opens are protected too: the launcher re-applies the injections to every new page
target.

## 4. Clean up

> Close the browser for acme-main.

Claude calls `browser_close`; `browser_close_all` closes everything started from this storage path.
The server also closes the browsers it opened when it exits. Cookies stay on disk for next time.

## Troubleshooting

- **No tools listed.** Run `npx -y @aitofy/browser-profiles mcp` by hand: stdout must stay empty.
- **See what it is doing.** Add `--verbose`, or set `DEBUG=browser-profiles*`; both write to stderr.
- **Wrong directory.** Ask Claude to call `storage_path`.
