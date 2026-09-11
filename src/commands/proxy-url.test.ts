import { describe, expect, it } from 'vitest';
import type { ProxyConfig } from '../types';
import { formatProxyUrl, parseProxyUrl } from './proxy-url';

describe('parseProxyUrl - accepted', () => {
    const cases: Array<[string, ProxyConfig]> = [
        ['http://1.2.3.4:8080', { type: 'http', host: '1.2.3.4', port: 8080 }],
        ['https://proxy.example.com:3128', { type: 'https', host: 'proxy.example.com', port: 3128 }],
        ['socks5://gate.net:1080', { type: 'socks5', host: 'gate.net', port: 1080 }],
        ['socks5h://gate.net:1080', { type: 'socks5', host: 'gate.net', port: 1080 }],
        ['socks://gate.net:1080', { type: 'socks5', host: 'gate.net', port: 1080 }],
        ['HTTP://Host.Example:80', { type: 'http', host: 'host.example', port: 80 }],
        ['http://1.2.3.4:8080/', { type: 'http', host: '1.2.3.4', port: 8080 }],
        [
            'http://bob:s3cr3t@1.2.3.4:8080',
            { type: 'http', host: '1.2.3.4', port: 8080, username: 'bob', password: 's3cr3t' },
        ],
        [
            'http://us%3Aer:p%40ss%2Fword@1.2.3.4:8080',
            { type: 'http', host: '1.2.3.4', port: 8080, username: 'us:er', password: 'p@ss/word' },
        ],
        ['http://bob@1.2.3.4:8080', { type: 'http', host: '1.2.3.4', port: 8080, username: 'bob' }],
        ['http://[::1]:8080', { type: 'http', host: '::1', port: 8080 }],
    ];

    it.each(cases)('parses %s', (url, expected) => {
        const result = parseProxyUrl(url);
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(expected);
    });
});

describe('parseProxyUrl - rejected', () => {
    const cases: Array<[string, string, RegExp]> = [
        ['', 'empty', /empty/i],
        ['   ', 'blank', /empty/i],
        ['1.2.3.4:8080', 'no scheme', /Invalid proxy URL|Unsupported proxy scheme/],
        ['not a url', 'garbage', /Invalid proxy URL/],
        ['ftp://host:21', 'unsupported scheme', /Unsupported proxy scheme "ftp"/],
        ['http://1.2.3.4', 'missing port', /no port/i],
        ['socks5://gate.net', 'missing port on socks', /no port/i],
        ['http://1.2.3.4:0', 'port 0', /out of range/i],
        ['http://1.2.3.4:8080/path', 'path present', /must not contain a path/i],
        ['http://1.2.3.4:8080?a=1', 'query present', /query string or fragment/i],
        ['http://:pass@1.2.3.4:8080', 'password without user', /password but no username/i],
    ];

    it.each(cases)('rejects %s (%s)', (url, _label, message) => {
        const result = parseProxyUrl(url);
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('INVALID_CONFIG');
        expect(result.error?.message).toMatch(message);
    });

    it('rejects a port above 65535', () => {
        // WHATWG refuses to parse an out-of-range port at all.
        expect(parseProxyUrl('http://1.2.3.4:70000').ok).toBe(false);
    });
});

describe('formatProxyUrl', () => {
    it('round-trips through parseProxyUrl', () => {
        const urls = [
            'http://1.2.3.4:8080',
            'socks5://gate.net:1080',
            'https://bob:s3cr3t@proxy.example.com:3128',
        ];
        for (const url of urls) {
            const parsed = parseProxyUrl(url);
            expect(parsed.ok).toBe(true);
            expect(formatProxyUrl(parsed.data!)).toBe(url);
        }
    });

    it('percent-encodes credentials', () => {
        expect(
            formatProxyUrl({ type: 'http', host: 'h', port: 1, username: 'us:er', password: 'p@ss' })
        ).toBe('http://us%3Aer:p%40ss@h:1');
    });

    it('brackets IPv6 hosts', () => {
        expect(formatProxyUrl({ type: 'http', host: '::1', port: 8080 })).toBe('http://[::1]:8080');
    });
});
