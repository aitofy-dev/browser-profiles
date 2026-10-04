import { describe, expect, it } from 'vitest';
import type { StoredProfile } from '../types';
import { applyCookies, applyProtections, buildProtectionPlan, sessionOf } from './protections';
import type { CdpParams, CdpResult } from './deps';

interface RecordedCall {
    method: string;
    params?: CdpParams;
    sessionId?: string;
}

function fakeSession(failing?: string) {
    const calls: RecordedCall[] = [];
    return {
        calls,
        send: async (method: string, params?: CdpParams): Promise<CdpResult> => {
            calls.push({ method, params });
            if (method === failing) throw new Error(`${method} rejected`);
            return {};
        },
    };
}

const profile: StoredProfile = {
    id: 'p1',
    name: 'Test',
    createdAt: 0,
    updatedAt: 0,
    timezone: 'Europe/Paris',
    fingerprint: {
        userAgent: 'UA/1.0',
        platform: 'MacIntel',
        language: 'fr-FR',
        hardwareConcurrency: 12,
        deviceMemory: 16,
    },
    cookies: [{ name: 'sid', value: 'abc', domain: 'example.com' }],
};

describe('buildProtectionPlan', () => {
    it('builds the user agent from the running Chrome when the profile pins none', () => {
        const plan = buildProtectionPlan(
            { id: 'p3', name: 'Bare', createdAt: 0, updatedAt: 0, fingerprint: { platform: 'Win32' } },
            'Europe/Paris',
            { major: 152, full: '152.0.7977.83' }
        );
        expect(plan.userAgentOverride.userAgent).toContain('Chrome/152.0.0.0');
        const metadata = plan.userAgentOverride.userAgentMetadata as { fullVersion: string };
        expect(metadata.fullVersion).toBe('152.0.7977.83');
        expect(plan.userAgentMismatch).toBeNull();
    });

    it('reports a pinned user agent that claims another Chrome major', () => {
        const pinned: StoredProfile = {
            id: 'p4',
            name: 'Pinned',
            createdAt: 0,
            updatedAt: 0,
            fingerprint: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36', platform: 'Win32' },
        };
        const plan = buildProtectionPlan(pinned, 'Europe/Paris', { major: 152, full: '152.0.7977.83' });
        expect(plan.userAgentOverride.userAgent).toContain('Chrome/120.0.0.0');
        expect(plan.userAgentMismatch).toEqual({ claimed: 120, running: 152 });
    });

    it('maps the profile fingerprint into the user agent override', () => {
        const plan = buildProtectionPlan(profile);
        expect(plan.userAgentOverride).toMatchObject({
            userAgent: 'UA/1.0',
            platform: 'MacIntel',
            acceptLanguage: 'fr-FR,fr',
        });
        const metadata = plan.userAgentOverride.userAgentMetadata as { platform: string };
        expect(metadata.platform).toBe('macOS');
    });

    it('falls back to a Windows fingerprint and America/New_York', () => {
        const plan = buildProtectionPlan({ id: 'p2', name: 'Bare', createdAt: 0, updatedAt: 0 });
        expect(plan.userAgentOverride.platform).toBe('Win32');
        expect(plan.timezoneId).toBe('America/New_York');
        expect(plan.cookies).toEqual([]);
    });

    it('carries the fingerprint values into the injected script', () => {
        const plan = buildProtectionPlan(profile);
        expect(plan.initScript).toContain('fr-FR');
        expect(plan.initScript).toContain('MacIntel');
        expect(plan.initScript).toContain('12');
        expect(plan.initScript).toContain('webdriver');
    });

    it('carries the WebGL and worker spoof', () => {
        const plan = buildProtectionPlan(profile);
        expect(plan.initScript).toContain('UNMASKED_RENDERER_WEBGL');
        expect(plan.initScript).toContain('wrapWorker');
    });

    it('builds one cookie payload per profile cookie', () => {
        const plan = buildProtectionPlan(profile);
        expect(plan.cookies).toEqual([
            {
                url: 'https://example.com',
                name: 'sid',
                value: 'abc',
                domain: 'example.com',
                path: '/',
                httpOnly: false,
                secure: false,
                sameSite: 'Lax',
            },
        ]);
    });
});

describe('kernel protection plan', () => {
    it('installs no script and overrides only the locale', async () => {
        const plan = buildProtectionPlan(profile, 'Europe/Paris', { major: 152, full: '152.0.0.0' }, 'kernel');
        expect(plan.engine).toBe('kernel');
        expect(plan.initScript).toBe('');
        expect(plan.userAgentMismatch).toBeNull();

        const session = fakeSession();
        await applyProtections(session, plan);
        expect(session.calls).toEqual([{ method: 'Emulation.setLocaleOverride', params: { locale: 'fr-FR' } }]);
    });
});

describe('applyProtections', () => {
    it('sends user agent, script, timezone and locale in order', async () => {
        const session = fakeSession();
        const plan = buildProtectionPlan(profile);

        await applyProtections(session, plan);

        expect(session.calls.map((call) => call.method)).toEqual([
            'Network.enable',
            'Network.setUserAgentOverride',
            'Page.enable',
            'Page.addScriptToEvaluateOnNewDocument',
            'Emulation.setTimezoneOverride',
            'Emulation.setLocaleOverride',
        ]);
        expect(session.calls[1].params).toEqual(plan.userAgentOverride);
        expect(session.calls[3].params).toEqual({ source: plan.initScript });
        expect(session.calls[4].params).toEqual({ timezoneId: 'Europe/Paris' });
        expect(session.calls[5].params).toEqual({ locale: 'fr-FR' });
    });

    it('propagates a failure of a protection that matters', async () => {
        const session = fakeSession('Network.setUserAgentOverride');
        await expect(applyProtections(session, buildProtectionPlan(profile))).rejects.toThrow(
            'Network.setUserAgentOverride rejected'
        );
    });
});

describe('applyCookies', () => {
    it('installs every cookie once, at the browser level', async () => {
        const session = fakeSession();
        const plan = buildProtectionPlan(profile);

        await applyCookies(session, plan);

        expect(session.calls).toEqual([
            { method: 'Storage.setCookies', params: { cookies: plan.cookies } },
        ]);
    });

    it('sends nothing when the profile has no cookies', async () => {
        const session = fakeSession();
        await applyCookies(session, buildProtectionPlan({ id: 'p2', name: 'Bare', createdAt: 0, updatedAt: 0 }));
        expect(session.calls).toEqual([]);
    });

    it('ignores a rejected cookie store', async () => {
        const session = fakeSession('Storage.setCookies');
        await expect(applyCookies(session, buildProtectionPlan(profile))).resolves.toBeUndefined();
    });
});

describe('sessionOf', () => {
    it('binds every command to the session id', async () => {
        const calls: RecordedCall[] = [];
        const client = {
            send: async (method: string, params?: CdpParams, sessionId?: string): Promise<CdpResult> => {
                calls.push({ method, params, sessionId });
                return {};
            },
            on: () => undefined,
            close: async () => undefined,
        };

        await sessionOf(client, 'session-1').send('Network.enable');
        await sessionOf(client).send('Target.getTargets');

        expect(calls).toEqual([
            { method: 'Network.enable', params: undefined, sessionId: 'session-1' },
            { method: 'Target.getTargets', params: undefined, sessionId: undefined },
        ]);
    });
});
