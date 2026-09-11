#!/usr/bin/env node
// ============================================================================
// @aitofy/browser-profiles - MCP stdio entry point
// ============================================================================
// Argv is parsed by hand: commander writes help and errors to stdout, which
// belongs to the JSON-RPC stream.

import { startMcpServer } from './mcp';
import type { CreateCommandContextOptions } from './commands/registry';

function parseArgs(argv: string[]): CreateCommandContextOptions {
    const opts: CreateCommandContextOptions = {};

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--verbose' || arg === '-v') opts.verbose = true;
        else if (arg === '--storage-path') opts.storagePath = argv[++i];
        else if (arg.startsWith('--storage-path=')) opts.storagePath = arg.slice('--storage-path='.length);
    }

    return opts;
}

startMcpServer(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[browser-profiles:mcp] failed to start: ${message}\n`);
    process.exit(1);
});
