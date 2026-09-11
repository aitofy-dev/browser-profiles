#!/usr/bin/env bash
# Create a profile, open it, and hand its CDP endpoint to Playwright.
# Needs: npm i -g @aitofy/browser-profiles, plus jq and playwright.
set -euo pipefail

PROFILE_ID="pipeline-demo"
OUT=$(mktemp)

browser-profiles profile create "Pipeline Demo" --id "$PROFILE_ID" --json >/dev/null 2>&1 || true

# `browser open` holds the browser for as long as it runs and closes it when its stdin ends,
# so background it behind a `sleep` that keeps stdin open. --json puts only the command output
# on stdout (logs go to stderr), so jq gets clean input.
sleep 300 | browser-profiles browser open "$PROFILE_ID" --json >"$OUT" &
CLI_PID=$!

WS=""
for _ in $(seq 1 30); do
    WS=$(jq -r '.wsEndpoint // empty' "$OUT" 2>/dev/null || true)
    [ -n "$WS" ] && break
    sleep 1
done
[ -n "$WS" ] || { echo "browser did not open" >&2; exit 1; }
echo "wsEndpoint: $WS"

# Option A: let an AI agent drive it.
#   npx -y @playwright/mcp@latest --cdp-endpoint "$WS"

# Option B: drive it from a script.
cat >/tmp/connect.mjs <<'SCRIPT'
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP(process.argv[2]);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://example.com');
console.log(await page.title());
await browser.close();
SCRIPT

node /tmp/connect.mjs "$WS"

kill "$CLI_PID" 2>/dev/null || true   # SIGTERM: the CLI closes the browser and exits
wait "$CLI_PID" 2>/dev/null || true
