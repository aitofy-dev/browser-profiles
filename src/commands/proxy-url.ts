// ============================================================================
// @aitofy/browser-profiles - Proxy URL <-> ProxyConfig (pure)
// ============================================================================

import { Err, Ok } from '../types';
import type { BrowserError, ProxyConfig, Result } from '../types';

/** Wire scheme -> canonical ProxyConfig type. */
const SCHEME_ALIASES: Readonly<Record<string, ProxyConfig['type']>> = {
    http: 'http',
    https: 'https',
    socks: 'socks5',
    socks5: 'socks5',
    socks5h: 'socks5',
};

const SUPPORTED_SCHEMES = 'http, https, socks5 (aliases: socks, socks5h)';

function invalid(message: string): Result<ProxyConfig, BrowserError> {
    return Err<BrowserError>({ code: 'INVALID_CONFIG', message });
}

function decodeUserInfo(value: string, field: string): string | Error {
    try {
        return decodeURIComponent(value);
    } catch {
        return new Error(
            `Proxy ${field} is not valid percent-encoding. ` +
            `Encode reserved characters, e.g. "p@ss" as "p%40ss".`
        );
    }
}

/**
 * WHATWG drops a port equal to the scheme default (http:80, https:443),
 * so read it back off the raw authority to tell "no port" from ":80".
 */
function explicitPortOf(raw: string): string | null {
    const afterScheme = raw.slice(raw.indexOf('://') + 3);
    const authority = afterScheme.split(/[/?#]/, 1)[0];
    const hostPart = authority.slice(authority.lastIndexOf('@') + 1);
    const match = /:(\d+)$/.exec(hostPart);
    return match ? match[1] : null;
}

/**
 * Parse a proxy URL into a ProxyConfig.
 * Accepts `scheme://[user[:pass]@]host:port` with an explicit port.
 */
export function parseProxyUrl(url: string): Result<ProxyConfig, BrowserError> {
    const raw = url.trim();
    if (raw.length === 0) {
        return invalid(`Proxy URL is empty. Expected "http://user:pass@host:port".`);
    }

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return invalid(
            `Invalid proxy URL: "${raw}". Expected "scheme://[user:pass@]host:port", ` +
            `e.g. "http://user:pass@127.0.0.1:8080". Supported schemes: ${SUPPORTED_SCHEMES}.`
        );
    }

    const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
    const type = SCHEME_ALIASES[scheme];
    if (!type) {
        return invalid(
            `Unsupported proxy scheme "${scheme}" in "${raw}". Supported schemes: ${SUPPORTED_SCHEMES}.`
        );
    }

    if (!parsed.hostname) {
        return invalid(`Proxy URL "${raw}" has no host. Expected "${scheme}://host:port".`);
    }

    const portText = parsed.port !== '' ? parsed.port : explicitPortOf(raw);
    if (portText === null) {
        return invalid(
            `Proxy URL "${raw}" has no port. A port is required, e.g. "${scheme}://${parsed.hostname}:8080".`
        );
    }

    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return invalid(`Proxy port "${portText}" in "${raw}" is out of range. Use 1-65535.`);
    }

    if (parsed.pathname !== '' && parsed.pathname !== '/') {
        return invalid(
            `Proxy URL "${raw}" must not contain a path. Expected "${scheme}://host:${port}".`
        );
    }
    if (parsed.search !== '' || parsed.hash !== '') {
        return invalid(
            `Proxy URL "${raw}" must not contain a query string or fragment. ` +
            `Expected "${scheme}://host:${port}".`
        );
    }
    if (parsed.password !== '' && parsed.username === '') {
        return invalid(`Proxy URL "${raw}" has a password but no username.`);
    }

    // WHATWG keeps user info percent-encoded; proxies need the decoded value.
    const username = parsed.username === '' ? undefined : decodeUserInfo(parsed.username, 'username');
    if (username instanceof Error) return invalid(username.message);
    const password = parsed.password === '' ? undefined : decodeUserInfo(parsed.password, 'password');
    if (password instanceof Error) return invalid(password.message);

    // IPv6 hosts come back bracketed; ProxyConfig stores the bare address.
    const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');

    return Ok<ProxyConfig>({
        type,
        host,
        port,
        ...(username === undefined ? {} : { username }),
        ...(password === undefined ? {} : { password }),
    });
}

/** Render a ProxyConfig back to a URL. Inverse of parseProxyUrl. */
export function formatProxyUrl(proxy: ProxyConfig): string {
    const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
    const authority = `${host}:${proxy.port}`;
    if (!proxy.username) return `${proxy.type}://${authority}`;
    const user = encodeURIComponent(proxy.username);
    const pass = proxy.password ? `:${encodeURIComponent(proxy.password)}` : '';
    return `${proxy.type}://${user}${pass}@${authority}`;
}
