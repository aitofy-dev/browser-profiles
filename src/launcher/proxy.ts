// ============================================================================
// @aitofy/browser-profiles - Proxy relay and IP-based timezone detection
// ============================================================================

import http from 'http';
import type { ProxyConfig, StoredProfile } from '../types';
import { createLogger } from '../log';
import { loadProxyChain } from './deps';

const log = createLogger('launcher-proxy');

/** Timezone used when neither the profile nor the proxy IP tells us one. */
export const FALLBACK_TIMEZONE = 'America/New_York';

/** Matched by the command layer to report a configuration mistake, not a launch failure. */
export const DETACHED_PROXY_MESSAGE =
    'detached=true cannot be combined with an authenticated proxy: Chrome cannot send the credentials ' +
    'itself, and the local relay that does dies with this process, leaving the browser unable to reach ' +
    'the network. Drop detached, or use a proxy without a username and password.';

/**
 * Fail before Chrome exists rather than leave a browser that can never load a page.
 * @throws when a detached launch would outlive the relay it depends on.
 */
export function assertDetachedLaunchAllowed(proxy: ProxyConfig | null | undefined, detached: boolean): void {
    if (detached && proxy?.username) throw new Error(DETACHED_PROXY_MESSAGE);
}

/**
 * Build the upstream proxy URL, credentials included.
 * Chrome cannot authenticate itself, so this URL is only ever handed to the relay.
 */
export function buildProxyUrl(proxy: ProxyConfig): string {
    const { type, host, port, username, password } = proxy;
    const protocol = type === 'socks5' ? 'socks5' : 'http';

    if (username && password) {
        return `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    }

    return `${protocol}://${host}:${port}`;
}

export interface GeoLocation {
    timezone: string;
    country: string;
    city: string;
    region: string;
}

/**
 * Look up a timezone for an IP with a free GeoIP API.
 * @returns Geo info, or null when the lookup fails.
 */
export async function detectTimezoneFromIP(ip: string): Promise<GeoLocation | null> {
    try {
        // ip-api.com: free, no API key, 45 requests/minute.
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=${GEO_FIELDS}`);
        return parseGeo(await response.text());
    } catch {
        return null;
    }
}

const GEO_FIELDS = 'status,country,regionName,city,timezone';

function parseGeo(body: string): GeoLocation | null {
    const data = JSON.parse(body) as {
        status?: string;
        country?: string;
        regionName?: string;
        city?: string;
        timezone?: string;
    };
    if (data.status !== 'success' || !data.timezone) return null;
    return {
        timezone: data.timezone,
        country: data.country ?? '',
        city: data.city ?? '',
        region: data.regionName ?? '',
    };
}

/**
 * Locate the IP a site actually sees by asking through the relay. A gateway proxy's
 * host is not its exit IP, so looking the host up can return another country.
 * @returns Geo info, or null when the lookup fails.
 */
export function detectExitLocation(relayUrl: string, timeoutMs = 10_000): Promise<GeoLocation | null> {
    const relay = new URL(relayUrl);
    return new Promise((resolve) => {
        const request = http.get({
            host: relay.hostname,
            port: relay.port,
            path: `http://ip-api.com/json/?fields=${GEO_FIELDS}`,
            headers: { host: 'ip-api.com' },
            timeout: timeoutMs,
        }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => { body += chunk; });
            response.on('end', () => {
                try {
                    resolve(parseGeo(body));
                } catch {
                    resolve(null);
                }
            });
        });
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(null));
    });
}

/** Timezone of the proxy exit node, or the fallback when it cannot be resolved. */
export async function autoDetectTimezone(proxy: ProxyConfig): Promise<string> {
    const geo = await detectTimezoneFromIP(proxy.host);
    if (geo) {
        log.info(`Detected location: ${geo.city}, ${geo.country} (${geo.timezone})`);
        return geo.timezone;
    }
    return FALLBACK_TIMEZONE;
}

/** Timezone for Chrome's TZ, from the profile, else the proxy exit IP, else this host. */
export async function resolveTimezone(profile: StoredProfile, relayUrl: string | undefined): Promise<string> {
    if (profile.timezone) return profile.timezone;

    if (profile.proxy) {
        const exit = relayUrl ? await detectExitLocation(relayUrl) : null;
        const geo = exit ?? await detectTimezoneFromIP(profile.proxy.host);
        if (geo) {
            log.info(`Auto-detected timezone: ${geo.timezone} (${geo.city}, ${geo.country})`);
            return geo.timezone;
        }
    }

    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    log.debug(`Using system timezone: ${systemTimezone}`);
    return systemTimezone;
}

/**
 * Start a local relay that answers the proxy challenge for Chrome.
 * @returns The local URL to hand to `--proxy-server`.
 */
export async function startProxyRelay(proxy: ProxyConfig): Promise<string> {
    const proxyChain = await loadProxyChain();
    try {
        return await proxyChain.anonymizeProxy(buildProxyUrl(proxy));
    } catch (error) {
        log.error('Proxy setup failed', error);
        throw new Error(`Failed to configure proxy: ${(error as Error).message}`);
    }
}

/** Tear down a relay started by `startProxyRelay`. Never throws. */
export async function closeProxyRelay(relayUrl: string | undefined): Promise<void> {
    if (!relayUrl) return;
    try {
        const proxyChain = await loadProxyChain();
        await proxyChain.closeAnonymizedProxy(relayUrl, true);
    } catch (error) {
        // The relay dies with the process that created it; failing here is expected.
        log.debug('Could not close proxy relay', error);
    }
}
