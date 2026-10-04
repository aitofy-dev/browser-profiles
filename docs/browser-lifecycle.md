# Browser lifecycle

Who owns a Chrome process, what happens when that owner dies, and what `detached` gives up.

## The rule

The process that launches Chrome owns it. The authenticated-proxy relay and the per-tab anti-detect
injections live in that process, so Chrome must not silently outlive it: a browser whose owner is
gone keeps running with no relay and no injection for new tabs, which is worse than no browser at
all.

## Ownership per mode

**Library.** `profiles.launch(id)` returns a `LaunchResult` with a `close()`. Your process owns the
browser for as long as it holds that CDP connection. `profiles.closeAll()` closes everything that
instance launched.

**CLI.** `browser open` and `browser launch` print their output and then stay in the foreground,
with `Browser is open. Press Ctrl+C to close it and exit.` on stderr. They close the browser and
exit on `SIGINT`, `SIGTERM`, `SIGHUP`, or when stdin closes. As a last resort the CLI sends one
`SIGTERM` to Chrome from its `exit` handler. Every other CLI command exits immediately.

**MCP server.** `browser_open` returns immediately with the `wsEndpoint`; the server keeps the
browser protected while it runs and closes every browser it opened when it exits — on `SIGINT`,
`SIGTERM`, `SIGHUP`, when stdin ends, when the stdio transport closes, or after an uncaught
exception or unhandled rejection. Shutdown gives itself 8 seconds before forcing an exit.

## Reuse

Opening a profile that is already running does not start a second Chrome. The launcher reads the
profile's lock file, probes the recorded DevTools port, and returns the running endpoint with
`reused: true`.

A reused browser belongs to whoever started it. The MCP server therefore does not close a browser it
merely reused, and neither does anything else: the owner closes it.

Two processes racing to open the same profile are serialised by a claim written into the lock file
before Chrome starts. The loser waits and then reuses the winner's browser.

## Closing from another process

`browser close` (and `browser_close`) works from any process. It reads `.browser-lock.json` in the
profile's user-data directory, confirms the recorded port still answers and is the same browser,
then sends `SIGTERM`, waits up to 5 seconds, and escalates to `SIGKILL`. The local proxy relay, if
any, is torn down and the lock file removed.

If the port does not answer, or answers as a different browser, the lock is stale: it is deleted and
nothing is killed. The recorded PID may have been recycled by the OS onto an unrelated process, so
killing it blindly is not safe. The command returns `closed: false`, which is not an error.

`browser status` cleans up stale locks the same way while it scans.

## detached: the trade-offs

`--detached` on the CLI, `detached: true` on the MCP tools, or `profiles.launch(id, { detached: true })`
in the library lets Chrome outlive the process that started it. That is the whole point, and it costs:

- **No authenticated-proxy relay.** Chrome cannot send proxy credentials itself and the local relay
  that does dies with its process. A detached launch with a proxy that has a username fails before
  Chrome starts, with an `INVALID_CONFIG` error, rather than leaving a browser that can never reach
  the network. A proxy without credentials is fine.
- **First-tab-only injection** on the inject engine. Nothing holds a CDP connection, so no new
  target can be paused and injected. The first tab is protected; tabs opened later get only the
  flag-level protections. Kernel mode keeps the spoof on later tabs, because it is a process flag,
  except the `Intl` locale on macOS.
- **You close it yourself**, with `browser close` or `browser_close`, from any process.

Use it for one-shot scripts that must exit immediately:

```bash
browser-profiles open acme-main --detached --json
```

Without `detached`, a script reads the endpoint from `browser status`, or backgrounds the keepAlive
command behind a stdin that stays open — see
[`../examples/cli-json-pipeline.sh`](../examples/cli-json-pipeline.sh).

## See also

[cli.md](./cli.md) · [mcp.md](./mcp.md) · [library.md](./library.md) ·
[anti-detect.md](./anti-detect.md) · [configuration.md](./configuration.md) ·
[troubleshooting.md](./troubleshooting.md)
