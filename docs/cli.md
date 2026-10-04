# CLI

Every `browser-profiles` command, its flags, and the `--json` contract. The CLI is generated from
the command registry in `src/commands/`, so this page and `browser-profiles --help` cannot drift.

## Install

```bash
npm install -g @aitofy/browser-profiles
```

Two bins are installed: `browser-profiles` (this CLI) and `browser-profiles-mcp` (the MCP server,
see [mcp.md](./mcp.md)).

## Command tree

Each command has a nested path and one or more short top-level aliases. Both forms are the same
command.

```
browser-profiles profile list                  aliases: list, ls
browser-profiles profile get <idOrName>        aliases: info
browser-profiles profile create <name>         aliases: create
browser-profiles profile update <idOrName>     aliases: update
browser-profiles profile delete <idOrName>     aliases: delete, rm
browser-profiles profile duplicate <idOrName>  aliases: duplicate
browser-profiles browser open <idOrName>       aliases: open
browser-profiles browser launch                aliases: launch
browser-profiles browser close <idOrName>      aliases: close
browser-profiles browser close-all             aliases: close-all
browser-profiles browser status                aliases: status, ps
browser-profiles storage path                  aliases: path
browser-profiles mcp                           (no alias)
```

Per-command help is printed by the alias form: `browser-profiles create --help`,
`browser-profiles open --help`.

## Global flags

Accepted by every command, before or after the command name.

| Flag | Description |
|------|-------------|
| `--json` | Print the raw command output as one line of JSON. |
| `--verbose` | Log progress and debug detail to stderr. |
| `--storage-path <dir>` | Directory holding profiles. Overrides `BROWSER_PROFILES_HOME`. |

## Arguments used by several commands

`<idOrName>` — Profile identifier: either the profile id (e.g. `"a1b2c3d4e5f60718"`) or its exact
name (case-insensitive, e.g. `"Google Main"`). Ids are tried first. Use `profile.list` to discover
both. `browser close` additionally accepts a temporary session id from `browser.launch`, e.g.
`"tmp-1712345678901-a1b2c3"`.

## profile list

List stored browser profiles, optionally filtered by group or tag.

| Flag | Description |
|------|-------------|
| `--group-id <value>` | Return only profiles whose groupId equals this value exactly (case-sensitive). |
| `--tag <value>` | Return only profiles carrying this tag, e.g. `"facebook"`. Exact, case-sensitive match. |

```bash
browser-profiles ls --tag facebook
```

## profile get

Show one profile by id or name, including its proxy and fingerprint. No flags beyond the global
ones.

```bash
browser-profiles info acme-main
```

## profile create

Create a new browser profile with its own storage, proxy and fingerprint.

Positional: `<name>` — Display name, e.g. `"Facebook - Acme"`. Used by every command that takes
idOrName.

| Flag | Description |
|------|-------------|
| `--id <value>` | Optional stable id: 1-64 chars of letters, digits, hyphen or underscore, e.g. `"acme-fb-01"`. Must not start with `"tmp-"` (reserved for temporary `browser.launch` sessions). Omit to get a random 16-hex-character id. Must not already exist. |
| `--proxy <value>` | Proxy as a URL with an explicit port: `"<scheme>://[user:pass@]host:port"`. Schemes: http, https, socks5 (socks and socks5h are accepted and normalised to socks5). Percent-encode reserved characters in credentials, e.g. `"http://bob:p%40ss@10.0.0.1:8080"`. Example: `"socks5://gate.provider.net:1080"`. |
| `--timezone <value>` | IANA timezone id used for the browser clock and Intl output, e.g. `"America/New_York"` or `"Asia/Ho_Chi_Minh"`. Match it to the proxy exit country or the profile becomes trivially detectable. |
| `--language <value>` | BCP 47 language tag for navigator.language and the Accept-Language header, e.g. `"en-US"`, `"vi-VN"`, `"de-DE"`. Default `"en-US"`. |
| `--platform <value>` | navigator.platform value to report. Use exactly one of `"Win32"`, `"MacIntel"` or `"Linux x86_64"`; it must agree with the user agent. |
| `--tags <value...>` | Free-form labels for filtering, e.g. `["facebook", "client-acme"]`. Pass an array of strings. Repeat the flag or pass a comma-separated list. |
| `--notes <value>` | Free-form note stored with the profile, e.g. the account it belongs to. Not sent to the browser. |

```bash
browser-profiles create "Acme Main" --id acme-main \
  --proxy socks5://gate.provider.net:1080 --tags facebook,acme
```

## profile update

Change fields of an existing profile. Omitted fields are left untouched.

| Flag | Description |
|------|-------------|
| `--name <value>` | New display name. Omit to keep the current one. |
| `--proxy <value>` | Same format as `profile create`. Pass null to remove the proxy; omit to keep the current one. |
| `--no-proxy` | Clear proxy (sends null). |
| `--timezone <value>` | As in `profile create`. |
| `--language <value>` | As in `profile create`. |
| `--platform <value>` | As in `profile create`. |
| `--tags <value...>` | As in `profile create`. |
| `--notes <value>` | As in `profile create`. |

```bash
browser-profiles update acme-main --timezone America/New_York
browser-profiles update acme-main --no-proxy
```

## profile delete

Delete a profile and all of its browser data. Irreversible.

| Flag | Description |
|------|-------------|
| `--force` | Delete even while a browser is open for this profile (it is closed first). Default false, which fails with an error instead. |

## profile duplicate

Copy a profile settings (proxy, timezone, fingerprint) into a new profile with a new id.

| Flag | Description |
|------|-------------|
| `--name <value>` | Name for the copy. Defaults to the source name followed by `" (Copy)"`. |

## browser open

Open Chrome with a stored profile and return its CDP wsEndpoint. Calling it again for the same
profile returns the running browser with `reused=true`. Close it with `browser close`.

| Flag | Description |
|------|-------------|
| `--headless` | Run Chrome without a visible window. Default false (a real window is far less detectable). Set true only on machines with no display. |
| `--start-url <value>` | Absolute URL to open in the first tab, e.g. `"https://example.com"`. Omit for a blank tab. |
| `--detached` | Let Chrome outlive the process that opened it. Default false: the opener keeps the browser protected (per-tab fingerprint injection, authenticated proxy relay) and closes it on exit. Set true only for scripts that must exit immediately; then only flag-level protections remain and an authenticated proxy will not work. Kernel mode is the exception: its spoof is in the Chrome flags, so later tabs stay spoofed after the opener exits. |
| `--engine <auto\|kernel\|inject>` | Where the fingerprint is applied. `kernel` needs a fingerprint-chromium binary and spoofs inside Chromium with no JavaScript hooks. `inject` patches stock Chrome over CDP. `auto` (default) uses kernel when the executable contains `--fingerprint-platform`, otherwise inject. |

Output: `{ profileId, wsEndpoint, port, pid, reused, detached, engine }`. `engine` is `kernel` or
`inject`.

## browser launch

Launch a throwaway Chrome with a random fingerprint and no saved profile, and return its CDP
wsEndpoint. Nothing persists: `browser close` removes the session directory. Use `browser open`
when logins or cookies must survive.

| Flag | Description |
|------|-------------|
| `--proxy <value>` | Same format as `profile create`. |
| `--headless` | As in `browser open`. |
| `--no-random-fingerprint` | The schema defaults `randomFingerprint` to true (generate a random but internally consistent user agent, platform and hardware profile); this flag turns it off so Chrome's own fingerprint is used. |
| `--detached` | As in `browser open`. |
| `--engine <auto\|kernel\|inject>` | As in `browser open`. |

Output: `{ profileId, wsEndpoint, port, pid, temporary: true, detached, engine }`. The `profileId` is a
`tmp-...` id.

## browser close

Close the browser running for a profile, from any process. Reads the profile lock file, so it works
even if another process opened the browser. Returns `closed=false` when nothing was running (that is
not an error and the exit code stays 0). No flags beyond the global ones.

Output: `{ profileId, closed }`.

## browser close-all

Close every browser started from this storage path, including temporary sessions. No flags beyond
the global ones.

Output: `{ closed: string[] }`.

## browser status

List browsers that are currently running for this storage path, with their CDP endpoints. Lock
files left behind by crashed browsers are removed while scanning. No flags beyond the global ones.

Output: `{ running: [{ profileId, pid, port, wsEndpoint, startedAt, temporary }] }`.

## storage path

Print the directory where profiles and browser data are stored.

Output: `{ path }`.

## mcp

Serve every command as MCP tools over stdio. Accepts `--storage-path <dir>` and `--verbose`. See
[mcp.md](./mcp.md).

## keepAlive: open and launch stay in the foreground

`browser open` and `browser launch` are the two commands marked `keepAlive` in the registry. After
printing their output they write `Browser is open. Press Ctrl+C to close it and exit.` to stderr and
block. The process that launched Chrome owns it, so staying alive is what keeps the per-tab
injections and the authenticated-proxy relay running.

The browser is closed and the CLI exits on `SIGINT`, `SIGTERM`, `SIGHUP`, or when the CLI's stdin
closes. As a last resort the CLI sends one `SIGTERM` to Chrome from its `exit` handler.

Every other command prints and exits immediately.

## --detached for scripts

`--detached` opts out of that ownership: Chrome outlives the CLI, so the command exits right after
printing. The trade-offs are real and are listed in [browser-lifecycle.md](./browser-lifecycle.md):
no authenticated-proxy relay (a proxy with a username fails before Chrome starts) and injections on
the first tab only.

```bash
browser-profiles open acme-main --detached --json
# exits immediately; close it later with:
browser-profiles close acme-main
```

Without `--detached`, a script reads the endpoint from `browser status`, or backgrounds the command
behind a stdin that stays open — see [`../examples/cli-json-pipeline.sh`](../examples/cli-json-pipeline.sh).

## --json contract

- On success, stdout receives exactly the command's output object as one line of JSON, and nothing
  else. It is safe to pipe into `jq`.
- Diagnostics, warnings and the keepAlive notice go to stderr, never stdout.
- On failure, stderr receives `{"error":{"code":"...","message":"..."}}` and stdout stays empty.
- Exit code is 0 on success and 1 on any command error, `INTERNAL` included. Commander's own usage
  errors (unknown flag, missing argument) exit with commander's code.

```bash
$ browser-profiles storage path --json
{"path":"/Users/me/.aitofy/browser-profiles"}

$ browser-profiles info nope --json
{"error":{"code":"PROFILE_NOT_FOUND","message":"Profile not found: \"nope\". Run \"browser-profiles profile list\" to see the 0 stored profile(s)."}}
$ echo $?
1

$ WS=$(browser-profiles browser status --json | jq -r '.running[0].wsEndpoint')
```

Error codes: `CHROME_NOT_FOUND`, `LAUNCH_FAILED`, `PROFILE_NOT_FOUND`, `PROXY_ERROR`, `NETWORK`,
`TIMEOUT`, `CDP_ERROR`, `INVALID_CONFIG`, `STORAGE_ERROR`, `GEO_LOOKUP_FAILED`, `INTERNAL`.

## See also

[configuration.md](./configuration.md) · [browser-lifecycle.md](./browser-lifecycle.md) ·
[mcp.md](./mcp.md) · [troubleshooting.md](./troubleshooting.md) ·
[adr/0001-command-registry.md](./adr/0001-command-registry.md)
