# @aitofy/browser-profiles

> 🔒 **Self-hosted anti-detect browser profiles.** The open-source alternative to AdsPower & Multilogin.
> Use it as a library, as a CLI, or as an MCP server your AI agent drives.

[![npm version](https://img.shields.io/npm/v/@aitofy/browser-profiles.svg)](https://www.npmjs.com/package/@aitofy/browser-profiles)
[![CI](https://github.com/aitofy-dev/browser-profiles/actions/workflows/ci.yml/badge.svg)](https://github.com/aitofy-dev/browser-profiles/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-✓-green.svg)](https://github.com/aitofy-dev/browser-profiles)

<!-- demo gif -->

## 🎯 Why browser-profiles?

Like **n8n** for automation or **Affine** for notes, this is **AdsPower for developers** — self-hosted, open-source, and privacy-first.

| ❌ AdsPower/Multilogin | ✅ browser-profiles |
|------------------------|---------------------|
| $99+/month | **Free forever** |
| Cloud storage (data not yours) | **Local storage** (your data) |
| GUI only | **Code-first** (Puppeteer/Playwright) |
| Vendor lock-in | **Open source** (MIT) |
| No customization | **Full control** |

Kernel mode drives fingerprint-chromium, which spoofs inside Chromium and installs no JavaScript hooks. It scores 100% on browserscan and passes a Cloudflare challenge, next to AdsPower, GPM Login and Multilogin on the same machine and proxy; none of them, paid or not, hides from fingerprint.com. Every number and how to reproduce it: [docs/benchmark.md](./docs/benchmark.md). What is protected, how each engine applies it, and the honest limits: [docs/anti-detect.md](./docs/anti-detect.md).

## Quick start

### 1. Library

```bash
npm install @aitofy/browser-profiles rebrowser-puppeteer-core
```

```typescript
import { quickLaunch } from '@aitofy/browser-profiles';

const { page, close } = await quickLaunch({
  proxy: { type: 'http', host: 'your-proxy.com', port: 8080 },
});

await page.goto('https://browserscan.net');
await close({ terminate: true });
```

Full API: [docs/library.md](./docs/library.md).

### 2. CLI

```bash
npm install -g @aitofy/browser-profiles

browser-profiles create "Acme Main" --id acme-main --proxy http://user:pass@proxy.com:8080
browser-profiles open acme-main
```

Every command, flag and the `--json` contract: [docs/cli.md](./docs/cli.md).

### 3. MCP, for AI agents

```bash
claude mcp add browser-profiles -- npx -y @aitofy/browser-profiles mcp
```

Then ask your agent:

> Create a profile called Acme Main on my US proxy.
> Open it and give me the CDP endpoint.
> Drive it with Playwright MCP and log in to the account.

Other clients, the tool list and the lifecycle rules: [docs/mcp.md](./docs/mcp.md).

## 📚 Documentation

| Page | What is in it |
|------|---------------|
| [Library](./docs/library.md) | `quickLaunch`, `BrowserProfiles`, Puppeteer and Playwright, the command registry, `Result` |
| [CLI](./docs/cli.md) | Command tree, aliases, every flag, `--json` contract, `--detached` |
| [MCP server](./docs/mcp.md) | Setup per client, the tools table, error shape, browser ownership |
| [Playwright MCP](./docs/playwright-mcp.md) | Hand a `wsEndpoint` to Playwright MCP or any CDP client |
| [Configuration](./docs/configuration.md) | Storage path, `BROWSER_PROFILES_HOME`, Chrome path, logging, disk layout |
| [Anti-detect](./docs/anti-detect.md) | What is protected, per-tab injection, scores, limits |
| [Browser lifecycle](./docs/browser-lifecycle.md) | Who owns the browser, reuse, closing across processes, `detached` |
| [Troubleshooting](./docs/troubleshooting.md) | Every common error with its exact text and the fix |
| [ADR 0001](./docs/adr/0001-command-registry.md) | Architecture: one registry generates the CLI, MCP and library API |
| [Examples](./examples) | Runnable files: quick launch, proxy profile, Playwright, JSON pipeline, MCP |

## 🤝 Contributing

Contributions are welcome — start with the [Contributing Guide](./CONTRIBUTING.md).

To report a vulnerability privately, see [SECURITY.md](./SECURITY.md).

## 📄 License

MIT © [Aitofy](https://aitofy.dev)
