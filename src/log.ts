// ============================================================================
// @aitofy/browser-profiles - Logger (stderr only)
// ============================================================================

/** Package tag matched against DEBUG patterns. */
const PACKAGE_TAG = 'browser-profiles';
const DEBUG_AT_STARTUP = process.env.DEBUG;

export interface Logger {
    /** Verbose tracing, silent unless enabled. */
    debug(message: string, ...details: unknown[]): void;
    /** Progress information, silent unless enabled. */
    info(message: string, ...details: unknown[]): void;
    /** Always printed. */
    warn(message: string, ...details: unknown[]): void;
    /** Always printed. */
    error(message: string, ...details: unknown[]): void;
}

export interface CreateLoggerOptions {
    /** Force debug/info output on, regardless of DEBUG. */
    verbose?: boolean;
}

/**
 * True when a DEBUG pattern list enables the package tag.
 * Supports `browser-profiles`, `browser-profiles*`, `*` and comma/space lists.
 */
export function isDebugEnabled(debugEnv: string | undefined): boolean {
    if (!debugEnv) return false;
    return debugEnv
        .split(/[\s,]+/)
        .filter(Boolean)
        .some((pattern) => {
            if (pattern.startsWith('-')) return false;
            if (pattern === '*') return true;
            if (pattern.endsWith('*')) return PACKAGE_TAG.startsWith(pattern.slice(0, -1));
            return pattern === PACKAGE_TAG;
        });
}

function formatDetail(detail: unknown): string {
    if (typeof detail === 'string') return detail;
    if (detail instanceof Error) return detail.stack ?? detail.message;
    try {
        return JSON.stringify(detail);
    } catch {
        return String(detail);
    }
}

/**
 * Create a logger that writes to stderr only.
 * stdout stays free for protocol output (MCP stdio, CLI `--json`).
 */
export function createLogger(namespace: string, opts: CreateLoggerOptions = {}): Logger {
    const prefix = `[${PACKAGE_TAG}:${namespace}]`;

    const write = (level: string, message: string, details: unknown[]): void => {
        const tail = details.length > 0 ? ` ${details.map(formatDetail).join(' ')}` : '';
        process.stderr.write(`${prefix} ${level} ${message}${tail}\n`);
    };

    // chrome-launcher rewrites process.env.DEBUG on launch, so the value seen at
    // startup counts too; call-time is still read so late env changes are honoured.
    const enabled = (): boolean =>
        opts.verbose === true || isDebugEnabled(process.env.DEBUG) || isDebugEnabled(DEBUG_AT_STARTUP);

    return {
        debug: (message, ...details) => {
            if (enabled()) write('debug', message, details);
        },
        info: (message, ...details) => {
            if (enabled()) write('info', message, details);
        },
        warn: (message, ...details) => write('warn', message, details),
        error: (message, ...details) => write('error', message, details),
    };
}
