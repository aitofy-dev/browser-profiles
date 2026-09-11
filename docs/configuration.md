# Configuration

Where profiles are stored, how to point at a different store, and how to turn logging on. There is
no config file: everything is a flag, an environment variable, or a constructor option.

## Storage path

Precedence, highest first:

1. An explicit path — `--storage-path <dir>` on any CLI command or on `browser-profiles mcp`,
   `new BrowserProfiles({ storagePath })`, `createCommandContext({ storagePath })`.
2. The `BROWSER_PROFILES_HOME` environment variable.
3. The default: `~/.aitofy/browser-profiles` (on Windows, `C:\Users\<user>\.aitofy\browser-profiles`).

The resolved path is always absolute; a relative one is resolved against the working directory.

```bash
BROWSER_PROFILES_HOME=/data/profiles browser-profiles path
browser-profiles --storage-path /data/profiles path
```

`resolveStoragePath(explicit?)` is exported if a program needs to know which path it would use, and
`browser-profiles storage path` prints it.

Every command is scoped to one storage path. `browser status` and `browser close-all` only see
browsers started from the same store, so two stores can be used side by side without interference.

## Chrome executable

Precedence, highest first:

1. `chromePath` — `new BrowserProfiles({ chromePath })` or `LaunchOptions.chromePath`. Used only if
   the file exists.
2. `CHROMIUM_PATH` or `CHROME_PATH` in the environment, again only if the file exists.
3. The platform's usual install locations.

If none of them resolves, the launch fails with `CHROME_NOT_FOUND`. See
[troubleshooting.md](./troubleshooting.md).

## Diagnostics

All logs go to stderr, so they never corrupt `--json` output or the MCP stdio protocol. They are
silent unless asked for:

```bash
DEBUG=browser-profiles* browser-profiles browser status
browser-profiles browser status --verbose
```

`DEBUG` accepts a comma- or space-separated pattern list; `browser-profiles`, `browser-profiles*`
and `*` all enable this package. `--verbose` (and `createCommandContext({ verbose: true })`) turns
debug and info output on regardless of `DEBUG`. Warnings and errors are always printed. Proxy
credentials are never logged.

## Storage layout on disk

```
<storagePath>/
├── profiles/
│   └── <profileId>/
│       ├── config.json          # the profile: proxy, timezone, fingerprint, tags, notes
│       └── data/                # Chrome user-data dir: cookies, logins, cache
│           └── .browser-lock.json
└── tmp/
    └── tmp-<timestamp>-<hex>/   # one browser.launch session, deleted on close
        └── .browser-lock.json
```

`config.json` is written atomically (temp file plus rename), so a reader never sees half a file.

`.browser-lock.json` is the cross-process record of a running Chrome: `pid`, `port`, `wsEndpoint`,
`startedAt`, and optionally the local relay `proxyUrl`, `detached`, and `claiming` while a launch is
in flight. It is what lets `browser close` and `browser status` work from a different process, and
what gets cleaned up when a browser crashed. See [browser-lifecycle.md](./browser-lifecycle.md).

## See also

[cli.md](./cli.md) · [mcp.md](./mcp.md) · [library.md](./library.md) ·
[browser-lifecycle.md](./browser-lifecycle.md) · [troubleshooting.md](./troubleshooting.md)
