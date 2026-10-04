# MCP server

Every CLI command is also an MCP tool over stdio, so an AI agent can create profiles and open
anti-detect browsers itself. Tools are generated from the same registry as the CLI, so the two
cannot drift.

## Start command

```bash
browser-profiles mcp
```

The server is also installed as its own bin, `browser-profiles-mcp`, which takes the same flags and
skips loading the CLI. Transport is stdio: stdout carries JSON-RPC only, every diagnostic goes to
stderr.

| Flag | Meaning |
|------|---------|
| `--storage-path <dir>` | Directory holding profiles. Overrides `BROWSER_PROFILES_HOME`. Also accepted as `--storage-path=<dir>`. |
| `--verbose` | Log progress and debug detail to stderr (`-v` also works for `browser-profiles-mcp`). |

## Setup

### Claude Code

```bash
claude mcp add browser-profiles -- npx -y @aitofy/browser-profiles mcp
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "browser-profiles": {
      "command": "npx",
      "args": ["-y", "@aitofy/browser-profiles", "mcp"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in the project, or the global Cursor MCP settings:

```json
{
  "mcpServers": {
    "browser-profiles": {
      "command": "npx",
      "args": ["-y", "@aitofy/browser-profiles", "mcp"]
    }
  }
}
```

### Windsurf

Windsurf's MCP config file uses the same shape:

```json
{
  "mcpServers": {
    "browser-profiles": {
      "command": "npx",
      "args": ["-y", "@aitofy/browser-profiles", "mcp"]
    }
  }
}
```

### Any other MCP client

Anything that can spawn a command works. To pin the profile store, add the flag:

```json
{
  "mcpServers": {
    "browser-profiles": {
      "command": "npx",
      "args": ["-y", "@aitofy/browser-profiles", "mcp", "--storage-path", "/data/profiles"]
    }
  }
}
```

## Tools

Tool names are the command names with `_` instead of the dot: `profile.list` becomes
`profile_list`.

| Tool | Purpose | Arguments |
|------|---------|-----------|
| `profile_list` | List stored browser profiles, optionally filtered by group or tag. | `groupId?`, `tag?` |
| `profile_get` | Show one profile by id or name, including its proxy and fingerprint. | `idOrName` |
| `profile_create` | Create a new browser profile with its own storage, proxy and fingerprint. | `name`, `id?`, `proxy?`, `timezone?`, `fingerprint?` (`generated` or `real`), `language?`, `platform?`, `tags?`, `notes?` |
| `profile_update` | Change fields of an existing profile. Omitted fields are left untouched. | `idOrName`, `name?`, `proxy?` (null removes it), `timezone?`, `fingerprint?`, `language?`, `platform?`, `tags?`, `notes?` |
| `profile_delete` | Delete a profile and all of its browser data. Irreversible. | `idOrName`, `force?` |
| `profile_duplicate` | Copy a profile settings (proxy, timezone, fingerprint) into a new profile with a new id. | `idOrName`, `name?` |
| `browser_open` | Open Chrome with a stored profile and return its CDP wsEndpoint. | `idOrName`, `headless?`, `startUrl?`, `detached?`, `engine?` |
| `browser_launch` | Launch a throwaway Chrome with a random fingerprint and no saved profile. | `proxy?`, `headless?`, `randomFingerprint?` (default true), `detached?` |
| `browser_close` | Close the browser running for a profile, from any process. | `idOrName` |
| `browser_close_all` | Close every browser started from this storage path, including temporary sessions. | none |
| `browser_status` | List browsers currently running for this storage path, with their CDP endpoints. | none |
| `storage_path` | Print the directory where profiles and browser data are stored. | none |

Argument formats (id/name rules, proxy URLs, timezone, fingerprint, language, platform) are the
flag descriptions in [cli.md](./cli.md); the MCP input schemas carry the same text.

`fingerprint: "real"` is for your own accounts signed in by hand: the browser keeps Chrome's own
identity and `browser_open` reports `engine: "real"`, so an agent can check that nothing was
spoofed before it touches the account. See [anti-detect.md](./anti-detect.md#real-mode).

Outputs:

- `browser_open` → `{ profileId, wsEndpoint, port, pid, reused, detached, engine }` (`kernel`, `inject` or `real`)
- `browser_launch` → `{ profileId, wsEndpoint, port, pid, temporary: true, detached, engine }`
- `browser_close` → `{ profileId, closed }`
- `browser_close_all` → `{ closed: string[] }`
- `browser_status` → `{ running: [{ profileId, pid, port, wsEndpoint, startedAt, temporary, engine }] }`
- `storage_path` → `{ path }`
- `profile_delete` → `{ id, deleted: true }`
- the `profile_*` tools otherwise return the stored profile object

Read-only, destructive and idempotent hints are set per tool, so a client can decide what needs
confirmation: `profile_list`, `profile_get`, `browser_status` and `storage_path` are read-only;
`profile_delete`, `browser_close` and `browser_close_all` are destructive.

## Errors

Tools never throw. A failure comes back as a tool result with `isError: true` and one text content
block holding JSON:

```json
{ "code": "PROFILE_NOT_FOUND", "message": "Profile not found: \"acme\". Did you mean: Acme Main (acme-main)?", "profileId": "acme" }
```

`profileId` is present only when the failure is about one profile. Codes: `CHROME_NOT_FOUND`,
`LAUNCH_FAILED`, `PROFILE_NOT_FOUND`, `PROXY_ERROR`, `NETWORK`, `TIMEOUT`, `CDP_ERROR`,
`INVALID_CONFIG`, `STORAGE_ERROR`, `GEO_LOOKUP_FAILED`, `INTERNAL`.

## Ownership and lifecycle

The server owns the browsers it starts. The anti-detect injections and the authenticated-proxy
relay live in the server process and stay active for every tab, including tabs the client opens
later, for as long as the server runs.

- Every browser this server started is closed when the server exits — on `SIGINT`, `SIGTERM`,
  `SIGHUP`, when stdin ends, when the transport closes, or after an uncaught exception. Shutdown
  gives itself 8 seconds before forcing an exit.
- A browser returned with `reused: true` was already running when `browser_open` was called. It
  belongs to another process, so the server leaves it running on exit.
- `detached: true` opts out of ownership: Chrome outlives the server with flag-level protections
  only and no authenticated-proxy relay, and the agent must close it itself with `browser_close`.
- `browser_close` and `browser_close_all` also remove the profile from the owned set.

Calling `browser_open` twice for the same profile does not start a second Chrome: it returns the
running endpoint with `reused: true`.

## A worked conversation

> **You:** Create a profile called Acme Main on a US proxy and open it.

1. The agent calls `profile_create` with
   `{ "name": "Acme Main", "id": "acme-main", "proxy": "http://user:pass@gate.provider.net:8080", "timezone": "America/New_York" }`
   and gets back the stored profile.
2. It calls `browser_open` with `{ "idOrName": "acme-main" }` and gets
   `{ "profileId": "acme-main", "wsEndpoint": "ws://127.0.0.1:9222/devtools/browser/ab12...", "port": 9222, "pid": 51234, "reused": false, "detached": false }`.

> **You:** Log in to the account and take a screenshot.

3. The agent drives the returned `wsEndpoint` instead of starting a browser of its own: Playwright
   MCP with `--cdp-endpoint <wsEndpoint>`, or a CDP client in code. See
   [playwright-mcp.md](./playwright-mcp.md).

> **You:** Done, close it.

4. The agent calls `browser_close` with `{ "idOrName": "acme-main" }` and gets
   `{ "profileId": "acme-main", "closed": true }`.

If the agent forgets step 4, the browser is still closed when the MCP server exits.

## See also

[playwright-mcp.md](./playwright-mcp.md) · [cli.md](./cli.md) ·
[browser-lifecycle.md](./browser-lifecycle.md) · [configuration.md](./configuration.md) ·
[troubleshooting.md](./troubleshooting.md) · [`../examples/mcp-claude-code.md`](../examples/mcp-claude-code.md)
