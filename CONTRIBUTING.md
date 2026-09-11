# Contributing to browser-profiles

## Quick start

```bash
git clone https://github.com/aitofy-dev/browser-profiles.git
cd browser-profiles
npm install

npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run build     # tsup
```

All three must pass before you open a pull request. CI runs the same three on Node 20 and 22.

## Project structure

```
src/
├── index.ts              # Public API. Nothing is public unless it is exported here.
├── types.ts              # Shared types and the Result helpers
├── storage.ts            # Storage layout, atomic writes, browser lock files
├── log.ts                # The only way to print diagnostics (stderr)
├── profile-manager.ts    # Profile CRUD and launching
├── chrome-launcher.ts    # Chrome launch, proxy relay, anti-detect injection
├── fingerprint.ts        # WebRTC, Canvas, WebGL, Audio protection scripts
├── cli.ts                # CLI generator over the registry. No business logic.
├── mcp.ts                # MCP server generator over the registry. No business logic.
├── commands/             # The command registry: one file per command
│   ├── define.ts         # defineCommand, runCommand, resolveProfile, name mapping
│   ├── registry.ts       # The array every generator reads
│   ├── fields.ts         # Input fields shared by several commands
│   └── <group>-<verb>.ts # profile-create.ts, browser-open.ts, ...
└── integrations/
    ├── puppeteer.ts
    ├── playwright.ts
    └── extower.ts
```

## Adding a command: one file plus one registry line

A command is the single source for the CLI subcommand, the MCP tool and its validation. Write it
once and it appears everywhere.

1. Create `src/commands/<group>-<verb>.ts` and export a `defineCommand({...})`:

   ```ts
   export const profileArchive = defineCommand({
       name: 'profile.archive',              // CLI: profile archive, MCP tool: profile_archive
       description: 'One sentence, used verbatim by CLI help and the MCP tool description.',
       cli: { positional: ['idOrName'], aliases: ['archive'] },
       input: z.object({ idOrName: idOrNameField }),
       async run(ctx, input) { /* returns Ok(...) or Err(...), never throws */ },
       render(output) { /* human text for the CLI; --json and MCP use the raw output */ },
   });
   ```

2. Add it to the `commands` array in `src/commands/registry.ts`.
3. Add `src/commands/<group>-<verb>.test.ts`, or a case in `registry.test.ts`.

Rules the generators depend on, described in full in
[`docs/adr/0001-command-registry.md`](./docs/adr/0001-command-registry.md):

- Every zod field carries a `.describe()`. It becomes CLI flag help and the MCP schema doc, and it
  is read by an agent with no other context, so write it for one.
- Commands return `Result`, never throw.
- Never write to stdout. Diagnostics go through `ctx.log`, which writes to stderr. A single stray
  `console.log` breaks the MCP stdio transport and `--json`.
- Business logic belongs in the command file, never in `cli.ts` or `mcp.ts`.

## Tests

```bash
npm test               # unit tests, no Chrome required
npm run test:watch
```

Tests that launch a real Chrome are opt-in, because they need a display and a Chrome install:

```bash
BROWSER_PROFILES_E2E=1 npm test
```

Point them at a scratch directory instead of your real profiles:

```bash
BROWSER_PROFILES_HOME=/tmp/bp-e2e BROWSER_PROFILES_E2E=1 npm test
```

Test behavior, not implementation. Every bug fix ships with the test that would have caught it.

## Debugging

All logs go to stderr and are silent by default:

```bash
DEBUG=browser-profiles* browser-profiles browser status
browser-profiles browser open my-profile --verbose
```

Every common failure, with its exact message and the fix, is in
[`docs/troubleshooting.md`](./docs/troubleshooting.md).

## Code style

- TypeScript strict, no `any`. Prefer discriminated unions so illegal states cannot be expressed.
- 4-space indent, single quotes, ES modules.
- Comments explain *why*, in English, at most two lines. No dates, names or history.
- Function under 30 lines, file under 300 lines.

## Pull requests

- Branch from `main`: `feat/...`, `fix/...`, `chore/...`.
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Under 400 lines of diff, one idea per PR.
- Docs change with the code, in the same PR: `README.md`, `docs/`, `llms.txt`, `CHANGELOG.md`.
- CI must be green before merge.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
