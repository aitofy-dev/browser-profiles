import { describe, expect, it } from 'vitest';
import { createClientHintsScript, generateFingerprint, getFingerprintScripts } from './fingerprint';
import { FALLBACK_CHROME_MAJOR, parseChromeVersion } from './user-agent';

const chromiumBrand = (fp: ReturnType<typeof generateFingerprint>) =>
    fp.clientHints.brands.find(b => b.brand === 'Chromium')?.version;

describe('generateFingerprint', () => {
    it('UA major and Client Hints brands agree', () => {
        for (let i = 0; i < 20; i++) {
            const fp = generateFingerprint();
            const parsed = parseChromeVersion(fp.userAgent);
            expect(parsed).not.toBeNull();
            expect(String(parsed!.major)).toBe(chromiumBrand(fp));
        }
    });

    it('honours an explicit version', () => {
        const fp = generateFingerprint({ version: 141 });
        expect(fp.userAgent).toContain('Chrome/141.0.0.0');
        expect(chromiumBrand(fp)).toBe('141');
    });

    it('defaults to the fallback major, never a stale pinned one', () => {
        const fp = generateFingerprint({ platform: 'windows' });
        expect(parseChromeVersion(fp.userAgent)?.major).toBe(FALLBACK_CHROME_MAJOR);
        expect(fp.userAgent).not.toMatch(/Chrome\/1(19|20|21)\./);
    });

    it('UA OS token matches the selected platform', () => {
        expect(generateFingerprint({ platform: 'windows' }).userAgent).toContain('Windows NT 10.0; Win64; x64');
        expect(generateFingerprint({ platform: 'macos' }).userAgent).toContain('Macintosh; Intel Mac OS X 10_15_7');
        expect(generateFingerprint({ platform: 'linux' }).userAgent).toContain('X11; Linux x86_64');
    });

    it('navigator.platform and Client Hints platform agree', () => {
        const win = generateFingerprint({ platform: 'windows' });
        expect(win.platform).toBe('Win32');
        expect(win.clientHints.platform).toBe('Windows');

        const mac = generateFingerprint({ platform: 'macos' });
        expect(mac.platform).toBe('MacIntel');
        expect(mac.clientHints.platform).toBe('macOS');
    });

    it('applies overrides last', () => {
        const fp = generateFingerprint({ overrides: { hardwareConcurrency: 64 } });
        expect(fp.hardwareConcurrency).toBe(64);
    });
});

describe('createClientHintsScript', () => {
    it('derives uaFullVersion from the brands it was given', () => {
        const script = createClientHintsScript({
            brands: [{ brand: 'Chromium', version: '147' }, { brand: 'Google Chrome', version: '147' }],
        });
        expect(script).toContain("uaFullVersion: '147.0.0.0'");
        expect(script).not.toContain('120.0.6099.71');
    });

    it('uses an explicit fullVersion when provided', () => {
        const script = createClientHintsScript({ fullVersion: '152.0.7977.83' });
        expect(script).toContain("uaFullVersion: '152.0.7977.83'");
    });

    it('defaults brands to the fallback major', () => {
        expect(createClientHintsScript({})).toContain(`"version":"${FALLBACK_CHROME_MAJOR}"`);
    });
});

describe('getFingerprintScripts', () => {
    it('embeds the generated brands, so the injected script matches the UA', () => {
        const fp = generateFingerprint({ version: 150 });
        const scripts = getFingerprintScripts(fp);
        expect(scripts).toContain('"brand":"Chromium","version":"150"');
        expect(scripts).toContain("uaFullVersion: '150.0.0.0'");
    });
});
