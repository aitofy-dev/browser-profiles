// ============================================================================
// @aitofy/browser-profiles - Lazily loaded launcher dependencies
// ============================================================================

/** chrome-launcher's handle on a started browser. */
export type LaunchedChrome = Awaited<ReturnType<typeof import('chrome-launcher').launch>>;

export type CdpParams = Record<string, unknown>;
export type CdpResult = Record<string, unknown>;
export type CdpEventListener = (params: CdpParams, sessionId?: string) => void;

/** The slice of chrome-remote-interface this package uses. */
export interface CdpClient {
    send(method: string, params?: CdpParams, sessionId?: string): Promise<CdpResult>;
    on(event: string, listener: CdpEventListener): void;
    close(): Promise<void>;
}

export interface CdpConnectOptions {
    /** DevTools port; connects to the default page target. */
    port?: number;
    /** Full WebSocket URL. Pass the browser endpoint for a browser-level connection. */
    target?: string;
}

export type CdpFactory = (options: CdpConnectOptions) => Promise<CdpClient>;

let chromeLauncher: typeof import('chrome-launcher') | undefined;
let cdpFactory: CdpFactory | undefined;
let proxyChain: typeof import('proxy-chain') | undefined;

export async function loadChromeLauncher(): Promise<typeof import('chrome-launcher')> {
    if (!chromeLauncher) chromeLauncher = await import('chrome-launcher');
    return chromeLauncher;
}

export async function loadCdp(): Promise<CdpFactory> {
    if (!cdpFactory) {
        const module = await import('chrome-remote-interface');
        // The package is CJS: under ESM interop the callable sits on `default`.
        const candidate = (module as { default?: unknown }).default ?? module;
        cdpFactory = candidate as unknown as CdpFactory;
    }
    return cdpFactory;
}

export async function loadProxyChain(): Promise<typeof import('proxy-chain')> {
    if (!proxyChain) proxyChain = await import('proxy-chain');
    return proxyChain;
}
