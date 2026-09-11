// ============================================================================
// @aitofy/browser-profiles - MCP server generated from the command registry
// ============================================================================
// No business logic here: every tool is one entry of `commands`. See
// docs/adr/0001-command-registry.md. stdout carries JSON-RPC only; every
// diagnostic goes through ctx.log to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { browserClose } from './commands/browser-close';
import { commands, createCommandContext, mcpToolNameFor, runCommand } from './commands/registry';
import type { AnyCommandDef, CommandContext, CreateCommandContextOptions } from './commands/registry';
import { VERSION } from './index';

const READ_ONLY = new Set(['profile.list', 'profile.get', 'browser.status', 'storage.path']);
const DESTRUCTIVE = new Set(['profile.delete', 'browser.close', 'browser.close_all']);
const IDEMPOTENT = new Set([
    'profile.list',
    'profile.get',
    'profile.update',
    'profile.delete',
    'browser.open',
    'browser.close',
    'browser.close_all',
    'browser.status',
    'storage.path',
]);

/** Commands whose output hands a live browser to the caller. */
const OWNING = new Set(['browser.open', 'browser.launch']);

const CONNECT_GUIDANCE =
    'Drive the returned wsEndpoint instead of starting your own browser: Playwright MCP with ' +
    '`--cdp-endpoint <wsEndpoint>`, Puppeteer with `puppeteer.connect({ browserWSEndpoint: wsEndpoint })`, ' +
    'or Playwright with `chromium.connectOverCDP(wsEndpoint)`.';

const OWNERSHIP_GUIDANCE =
    'This MCP server owns the browsers it starts: the anti-detect injections and the authenticated-proxy ' +
    'relay stay active for every tab, including tabs your client opens later, for as long as this server ' +
    'runs. Every browser started here is closed when this server exits.';

const DETACHED_GUIDANCE =
    'detached=true opts out of that ownership: Chrome outlives this server with flag-level protections ' +
    'only and no authenticated proxy relay, and you must close it yourself with browser_close.';

/** The one place MCP-only wording lives; command files stay generator-agnostic. */
const TOOL_GUIDANCE: Record<string, string> = {
    browser_open:
        `${CONNECT_GUIDANCE} ${OWNERSHIP_GUIDANCE} Calling browser_open again for the same profile is ` +
        'safe: it returns the endpoint of the running browser with reused=true instead of starting a ' +
        'second one. A reused browser was started by someone else, so this server leaves it running.',
    browser_launch:
        `${CONNECT_GUIDANCE} ${OWNERSHIP_GUIDANCE} The session is temporary and its data is deleted on ` +
        'close, so use browser_open when logins or cookies must survive.',
};

function titleFor(def: AnyCommandDef): string {
    const words = def.name.replace(/[._]/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function descriptionFor(def: AnyCommandDef): string {
    const guidance = TOOL_GUIDANCE[mcpToolNameFor(def)];
    if (!guidance) return def.description;
    const detached = 'detached' in def.input.shape ? `\n\n${DETACHED_GUIDANCE}` : '';
    return `${def.description}\n\n${guidance}${detached}`;
}

function annotationsFor(def: AnyCommandDef): ToolAnnotations {
    const annotations: ToolAnnotations = {};
    if (READ_ONLY.has(def.name)) annotations.readOnlyHint = true;
    else annotations.destructiveHint = DESTRUCTIVE.has(def.name);
    if (IDEMPOTENT.has(def.name)) annotations.idempotentHint = true;
    return annotations;
}

function errorResult(error: { code: string; message: string; profileId?: string }): CallToolResult {
    const { code, message, profileId } = error;
    return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ code, message, profileId }) }],
    };
}

/**
 * Remember browsers this server started, forget the ones it closed. Exported for tests.
 * `reused: true` means the browser was already running, so it is not ours to close.
 */
export function trackLifecycle(name: string, data: unknown, owned: Set<string>): void {
    const output = data as { profileId?: unknown; reused?: unknown; detached?: unknown };

    if (OWNING.has(name)) {
        if (typeof output.profileId !== 'string') return;
        if (output.reused === true || output.detached === true) return;
        owned.add(output.profileId);
        return;
    }
    if (name === 'browser.close' && typeof output.profileId === 'string') owned.delete(output.profileId);
    if (name === 'browser.close_all') owned.clear();
}

function buildServer(ctx: CommandContext): { server: McpServer; owned: Set<string> } {
    const server = new McpServer({ name: 'browser-profiles', version: VERSION });
    const owned = new Set<string>();

    for (const def of commands) {
        server.registerTool(
            mcpToolNameFor(def),
            {
                title: titleFor(def),
                description: descriptionFor(def),
                inputSchema: def.input.shape,
                annotations: annotationsFor(def),
            },
            async (args: Record<string, unknown>): Promise<CallToolResult> => {
                const result = await runCommand(ctx, def, args);
                if (!result.ok) return errorResult(result.error);
                trackLifecycle(def.name, result.data, owned);
                return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] };
            }
        );
    }

    return { server, owned };
}

/** Build the MCP server for a context. Connect it to any transport. */
export function createMcpServer(ctx: CommandContext): McpServer {
    return buildServer(ctx).server;
}

const SHUTDOWN_TIMEOUT_MS = 8000;

async function closeOwned(ctx: CommandContext, owned: Set<string>): Promise<void> {
    const ids = [...owned];
    owned.clear();
    for (const profileId of ids) {
        const result = await runCommand(ctx, browserClose, { idOrName: profileId });
        if (!result.ok) ctx.log.warn(`Could not close browser ${profileId}: ${result.error.message}`);
    }
}

/** Serve the registry over stdio until the transport closes or a signal arrives. */
export async function startMcpServer(opts: CreateCommandContextOptions = {}): Promise<void> {
    const ctx = createCommandContext(opts);
    const { server, owned } = buildServer(ctx);

    let shuttingDown = false;
    const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        ctx.log.info(`Shutting down (${reason}); closing ${owned.size} browser(s)`);

        const forceExit = setTimeout(() => process.exit(exitCode), SHUTDOWN_TIMEOUT_MS);
        forceExit.unref();
        try {
            await closeOwned(ctx, owned);
            await server.close();
        } catch (error) {
            ctx.log.warn('Shutdown did not complete cleanly', error);
        }
        clearTimeout(forceExit);
        process.exit(exitCode);
    };

    server.server.onclose = () => void shutdown('transport closed');
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[]) {
        process.once(signal, () => void shutdown(signal));
    }
    process.stdin.once('end', () => void shutdown('stdin end'));
    // Chrome must not outlive this server, whatever kills it.
    process.once('uncaughtException', (error) => {
        ctx.log.error('Uncaught exception', error);
        void shutdown('uncaughtException', 1);
    });
    process.once('unhandledRejection', (reason) => {
        ctx.log.error('Unhandled rejection', reason);
        void shutdown('unhandledRejection', 1);
    });

    await server.connect(new StdioServerTransport());
    ctx.log.info(`MCP server ready: ${commands.length} tools, storage ${ctx.storagePath}`);
}
