import { describe, expect, it } from 'vitest';
import {
    buildBrands,
    buildUserAgent,
    buildUserAgentMetadata,
    osFamilyFromPlatform,
    parseChromeVersion,
    resolveUserAgent,
} from './user-agent';

describe('parseChromeVersion', () => {
    it('reads CDP Browser.getVersion product strings', () => {
        expect(parseChromeVersion('Chrome/152.0.7977.83')).toEqual({ major: 152, full: '152.0.7977.83' });
        expect(parseChromeVersion('HeadlessChrome/152.0.7977.83')).toEqual({ major: 152, full: '152.0.7977.83' });
    });

    it('reads `chrome --version` output', () => {
        expect(parseChromeVersion('Google Chrome 152.0.7977.83')).toEqual({ major: 152, full: '152.0.7977.83' });
        expect(parseChromeVersion('Chromium 131.0.6778.85 snap')).toEqual({ major: 131, full: '131.0.6778.85' });
    });

    it('reads a full User-Agent string', () => {
        const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
        expect(parseChromeVersion(ua)).toEqual({ major: 140, full: '140.0.0.0' });
    });

    it('accepts a bare major and pads the full version', () => {
        expect(parseChromeVersion('Chrome/150')).toEqual({ major: 150, full: '150.0.0.0' });
    });

    it('returns null when no version is present', () => {
        expect(parseChromeVersion('Mozilla/5.0 (Windows NT 10.0) Firefox/128.0')).toBeNull();
        expect(parseChromeVersion('')).toBeNull();
    });
});

describe('osFamilyFromPlatform', () => {
    it('maps navigator.platform values', () => {
        expect(osFamilyFromPlatform('Win32')).toBe('windows');
        expect(osFamilyFromPlatform('MacIntel')).toBe('macos');
        expect(osFamilyFromPlatform('Linux x86_64')).toBe('linux');
        expect(osFamilyFromPlatform('something-else')).toBe('linux');
    });
});

describe('buildUserAgent', () => {
    it('uses the frozen OS token per platform and the given major', () => {
        expect(buildUserAgent('Win32', 152)).toBe(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        );
        expect(buildUserAgent('MacIntel', 152)).toContain('(Macintosh; Intel Mac OS X 10_15_7)');
        expect(buildUserAgent('Linux x86_64', 152)).toContain('(X11; Linux x86_64)');
    });

    it('round-trips through parseChromeVersion', () => {
        expect(parseChromeVersion(buildUserAgent('Win32', 199))?.major).toBe(199);
    });
});

describe('buildBrands / buildUserAgentMetadata', () => {
    it('brands carry the same major as the UA', () => {
        const brands = buildBrands(152);
        expect(brands.find(b => b.brand === 'Chromium')?.version).toBe('152');
        expect(brands.find(b => b.brand === 'Google Chrome')?.version).toBe('152');
        expect(brands.some(b => b.brand === 'Not_A Brand')).toBe(true);
    });

    it('metadata platform fields agree with navigator.platform', () => {
        const meta = buildUserAgentMetadata('MacIntel', { major: 152, full: '152.0.7977.83' });
        expect(meta.platform).toBe('macOS');
        expect(meta.fullVersion).toBe('152.0.7977.83');
        expect(meta.fullVersionList.find(b => b.brand === 'Google Chrome')?.version).toBe('152.0.7977.83');
        expect(meta.brands).toEqual(buildBrands(152));
        expect(meta.mobile).toBe(false);

        expect(buildUserAgentMetadata('Win32', { major: 152, full: '152.0.0.0' }).platform).toBe('Windows');
        expect(buildUserAgentMetadata('Linux x86_64', { major: 152, full: '152.0.0.0' }).platform).toBe('Linux');
    });
});

describe('resolveUserAgent', () => {
    const running = { major: 152, full: '152.0.7977.83' };

    it('builds a UA matching the running browser when none is given', () => {
        const r = resolveUserAgent(undefined, 'Win32', running);
        expect(r.userAgent).toContain('Chrome/152.0.0.0');
        expect(r.version).toEqual(running);
        expect(r.mismatch).toBe(false);
    });

    it('keeps an explicit UA and derives Client Hints from it', () => {
        const explicit = buildUserAgent('MacIntel', 152);
        const r = resolveUserAgent(explicit, 'Win32', running);
        expect(r.userAgent).toBe(explicit);
        expect(r.version.major).toBe(152);
        expect(r.mismatch).toBe(false);
    });

    it('flags an explicit UA whose major differs from the running browser', () => {
        const r = resolveUserAgent(buildUserAgent('Win32', 120), 'Win32', running);
        expect(r.userAgent).toContain('Chrome/120.0.0.0');
        expect(r.version.major).toBe(120);
        expect(r.mismatch).toBe(true);
    });

    it('falls back to the running version for an unparsable explicit UA', () => {
        const r = resolveUserAgent('CustomBot/1.0', 'Win32', running);
        expect(r.userAgent).toBe('CustomBot/1.0');
        expect(r.version).toEqual(running);
        expect(r.mismatch).toBe(false);
    });
});
