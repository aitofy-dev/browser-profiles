import { describe, expect, it } from 'vitest';
import type { StoredProfile } from '../types';
import { applyProtections, buildProtectionPlan, sessionOf } from './protections';
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
    it('maps the profile fingerprint into the user agent override', () => {
        const plan = buildProtectionPlan(profile);
        expect(plan.userAgentOverride).toMatchObject({
            userAgent: 'UA/1.0',
            platform: 'MacIntel',
            acceptLanguage: 'fr-FR',
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

describe('applyProtections', () => {
    it('sends user agent, script, timezone and cookies in order', async () => {
        const session = fakeSession();
        const plan = buildProtectionPlan(profile);

        await applyProtections(session, plan);

        expect(session.calls.map((call) => call.method)).toEqual([
            'Network.enable',
            'Network.setUserAgentOverride',
            'Page.enable',
            'Page.addScriptToEvaluateOnNewDocument',
            'Emulation.setTimezoneOverride',
            'Network.setCookie',
        ]);
        expect(session.calls[1].params).toEqual(plan.userAgentOverride);
        expect(session.calls[3].params).toEqual({ source: plan.initScript });
        expect(session.calls[4].params).toEqual({ timezoneId: 'Europe/Paris' });
        expect(session.calls[5].params).toEqual(plan.cookies[0]);
    });

    it('ignores a rejected cookie', async () => {
        const session = fakeSession('Network.setCookie');
        await expect(applyProtections(session, buildProtectionPlan(profile))).resolves.toBeUndefined();
    });

    it('propagates a failure of a protection that matters', async () => {
        const session = fakeSession('Network.setUserAgentOverride');
        await expect(applyProtections(session, buildProtectionPlan(profile))).rejects.toThrow(
            'Network.setUserAgentOverride rejected'
        );
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
