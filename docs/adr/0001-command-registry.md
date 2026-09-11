# ADR 0001: One command registry drives CLI, MCP and library

## Context

The CLI re-implements logic that already exists in `BrowserProfiles` (proxy URL parsing twice, storage path hardcoded, ad-hoc error handling). Adding an MCP server would mean a third copy. AI agents increasingly drive tools through MCP, so the MCP surface must be first-class and must not drift from the CLI.

## Decision

Every user-facing operation is a `CommandDef` in `src/commands/`. CLI and MCP are thin generators over the same registry. Nothing user-facing lives only in `cli.ts` or `mcp.ts`.

```ts
// src/commands/registry.ts
interface CommandContext {
  profiles: BrowserProfiles;
  storagePath: string;
  log: Logger;              // writes to stderr only
}

interface CommandDef<I, O> {
  name: string;             // dotted: 'profile.list', 'browser.open'
  description: string;      // one sentence, used verbatim by CLI help and MCP tool description
  input: z.ZodObject<any>;  // single source for CLI flags, MCP inputSchema, validation
  cli?: {
    path?: string;          // override default ('profile.list' -> 'profile list'); top-level aliases allowed ('list', 'ls')
    positional?: string[];  // input keys mapped to positional args, in order
    keepAlive?: boolean;    // browser.open / browser.launch: CLI blocks until Ctrl+C, then runs onExit
  };
  run(ctx: CommandContext, input: I): Promise<Result<O, BrowserError>>;
  render(output: O): string; // human text for CLI; MCP and --json use the raw O
}
```

Name mapping is mechanical:

| name | CLI | MCP tool |
|------|-----|----------|
| `profile.list` | `browser-profiles profile list` (alias `list`, `ls`) | `profile_list` |
| `browser.open` | `browser-profiles browser open <idOrName>` (alias `open`) | `browser_open` |

## Command set (v0.3)

| name | input | output |
|------|-------|--------|
| `profile.list` | `{ groupId?, tag? }` | `StoredProfile[]` |
| `profile.get` | `{ idOrName }` | `StoredProfile` |
| `profile.create` | `{ name, id?, proxy?: string, timezone?, language?, platform?, tags?, notes? }` | `StoredProfile` |
| `profile.update` | `{ idOrName, name?, proxy?: string | null, timezone?, language?, platform?, tags?, notes? }` | `StoredProfile` |
| `profile.delete` | `{ idOrName, force?: boolean }` | `{ id, deleted: true }` |
| `profile.duplicate` | `{ idOrName, name? }` | `StoredProfile` |
| `browser.open` | `{ idOrName, headless?, startUrl? }` | `{ profileId, wsEndpoint, port, pid, reused: boolean }` |
| `browser.launch` | `{ proxy?: string, headless?, randomFingerprint? }` | `{ profileId, wsEndpoint, port, pid, temporary: true }` |
| `browser.close` | `{ idOrName }` | `{ profileId, closed: boolean }` |
| `browser.close_all` | `{}` | `{ closed: string[] }` |
| `browser.status` | `{}` | `{ running: { profileId, pid, port, wsEndpoint, startedAt }[] }` |
| `storage.path` | `{}` | `{ path }` |

`proxy` is always a URL string at the boundary (`http://user:pass@host:port`), parsed once by `parseProxyUrl()` into `ProxyConfig`. Object form stays available on the library API.

## Invariants the generators rely on

1. **stdout is protocol-only.** The library never writes to stdout. All diagnostics go through `Logger` to stderr, silent unless `DEBUG=browser-profiles*` or `--verbose`. MCP stdio transport breaks on a single stray `console.log`.
2. **Commands return `Result`, never throw.** CLI maps `Err` to stderr + exit code 1. MCP maps `Err` to `{ isError: true }` with `code` and `message`. Unexpected throws are caught at the generator and reported as `INTERNAL`.
3. **`idOrName` resolves in one place.** `resolveProfile(ctx, idOrName)` returns `Result<StoredProfile>` with `PROFILE_NOT_FOUND`, and suggests close matches in the message.
4. **The launching process owns the browser by default.** Anti-detect injections (UA override, new-document scripts, cookies) and the authenticated-proxy relay live in the Node process that launched Chrome, so Chrome must not outlive it silently. The MCP server is long-lived: `browser.open` returns immediately with `wsEndpoint` and the server keeps the browser protected until the server exits, at which point it closes every browser it launched. `detached: true` is an explicit opt-in that lets Chrome outlive the caller with only flag-level protections and no authenticated proxy; the tool description says so. `browser.close` works from any process by reading the profile's lock file. Opening an already-running profile returns the existing endpoint with `reused: true`.
4b. **Every tab is protected, not only the first.** External clients (Playwright MCP, Puppeteer `connect`) open new targets over `wsEndpoint`. The launcher auto-attaches to new page targets and re-applies the same injections before the page runs, so a profile opened once is protected for its whole life regardless of who drives it.
5. **Storage path resolves once.** Precedence: explicit option > `BROWSER_PROFILES_HOME` env > `~/.aitofy/browser-profiles`. Both CLI and MCP accept `--storage-path`.
6. **Every CLI command accepts `--json`.** Output is exactly the command's `O`, no wrapping, no logs on stdout.
7. **MCP tool descriptions teach the agent the flow.** `browser_open` description states that the returned `wsEndpoint` is a CDP endpoint usable by Playwright MCP (`--cdp-endpoint`), Puppeteer `connect`, or Playwright `connectOverCDP`.

## Consequences

- Adding a command means one new file in `src/commands/` and one line in the registry array. It appears in CLI, MCP and `--help` without further edits.
- `cli.ts` and `mcp.ts` contain no business logic and stay under 150 lines each.
- `createSession` in the Puppeteer integration stays as a library convenience but is no longer used by the CLI. `browser.launch` uses the core launcher so that it needs no Puppeteer peer dependency.
