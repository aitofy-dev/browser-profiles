# Security Policy

## Reporting a vulnerability

Report privately to **hello@aitofy.dev**. Do not open a public issue for a vulnerability.

Include:

- the version of `@aitofy/browser-profiles`, Node version and OS
- what an attacker can do, and the steps to reproduce it
- any proof-of-concept code or output (with credentials removed)

You get an acknowledgement within 48 hours and an assessment within 7 days. Fixes ship in a patch
release; the advisory credits you unless you ask otherwise.

## Supported versions

The latest minor release receives security fixes. Older minors do not — upgrade to the latest
minor first.

| Version | Supported |
|---------|-----------|
| 0.3.x | ✅ |
| < 0.3 | ❌ |

## In scope

- Leaking proxy credentials, profile data or Chrome user data to stdout, logs, disk outside the
  storage path, or the network
- Command or argument injection through profile fields, proxy URLs, or CLI and MCP inputs
- Path traversal through a profile id, name or `--storage-path`
- An MCP tool performing an operation outside the configured storage path, or a tool description
  that misleads an agent into a destructive action
- Anti-detect protections silently failing to apply (for example on tabs opened by a connected
  client), which exposes the real IP or fingerprint
- Insecure file permissions on profile data or lock files
- A dependency vulnerability that is reachable from this package's code

## Out of scope

- A website detecting an automated browser. The README states the measured limit; 95% is not a
  vulnerability.
- Vulnerabilities in Chrome, Puppeteer, Playwright or a proxy provider. Report those upstream.
- Anything that requires an attacker to already have write access to the storage path or to the
  machine.
- Whatever you do with the browser. This tool automates a browser you control; using it to break
  another service's terms is your responsibility.

## Notes on the threat model

Everything runs locally. Profiles, cookies and proxy credentials are stored under the storage path
(`--storage-path`, `BROWSER_PROFILES_HOME`, or `~/.aitofy/browser-profiles`) in plain JSON, so
protect that directory as you would an SSH key. There is no telemetry and no network call the
package did not need for a proxy, a timezone lookup, or the browser itself.
