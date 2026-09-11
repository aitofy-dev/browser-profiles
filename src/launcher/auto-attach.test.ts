import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import type { StoredProfile } from '../types';
import { createLogger } from '../log';
import { startAutoAttach } from './auto-attach';
import type { CdpClient, CdpEventListener, CdpParams, CdpResult } from './deps';
import { buildProtectionPlan } from './protections';

const log = createLogger('auto-attach-test');

const profile: StoredProfile = {
    id: 'p1',
    name: 'Test',
    createdAt: 0,
    updatedAt: 0,
    timezone: 'Europe/Paris',
    fingerprint: { userAgent: 'UA/1.0', platform: 'MacIntel', language: 'fr-FR' },
    // Cookies are installed once at the browser level, so no tab session may carry them.
    cookies: [{ name: 'sid', value: 'abc', domain: 'example.com' }],
};

interface SentCommand {
    method: string;
    params?: CdpParams;
    sessionId?: string;
}

class FakeClient implements CdpClient {
    readonly sent: SentCommand[] = [];
    closed = false;
    targetInfos: CdpParams[] = [];
    rejectMethod?: string;
    /** Never answers this command, like a paused renderer. */
    hangMethod?: string;

    private readonly events = new EventEmitter();

    async send(method: string, params?: CdpParams, sessionId?: string): Promise<CdpResult> {
        this.sent.push({ method, params, sessionId });
        if (method === this.hangMethod) return new Promise<CdpResult>(() => undefined);
        if (method === this.rejectMethod) throw new Error(`${method} failed`);
        if (method === 'Target.getTargets') return { targetInfos: this.targetInfos };
        return {};
    }

    on(event: string, listener: CdpEventListener): void {
        this.events.on(event, listener);
    }

    async close(): Promise<void> {
        this.closed = true;
    }

    attach(sessionId: string, targetId: string, type = 'page'): void {
        this.events.emit('Target.attachedToTarget', {
            sessionId,
            targetInfo: { targetId, type },
            waitingForDebugger: true,
        });
    }

    detach(sessionId: string): void {
        this.events.emit('Target.detachedFromTarget', { sessionId });
    }

    disconnect(): void {
        this.events.emit('disconnect', {});
    }

    methods(sessionId: string): string[] {
        return this.sent.filter((call) => call.sessionId === sessionId).map((call) => call.method);
    }
}

async function start(client: FakeClient, onDisconnect?: () => void) {
    return startAutoAttach({ client, plan: buildProtectionPlan(profile), log, onDisconnect });
}

describe('startAutoAttach', () => {
    it('turns on auto attach with the target paused until we injected', async () => {
        const client = new FakeClient();
        await start(client);

        expect(client.sent[0]).toEqual({
            method: 'Target.setAutoAttach',
            params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
            sessionId: undefined,
        });
        expect(client.sent.map((call) => call.method)).toContain('Target.setDiscoverTargets');
    });

    it('attaches by hand when no target was auto attached', async () => {
        const client = new FakeClient();
        client.targetInfos = [
            { targetId: 't1', type: 'page' },
            { targetId: 't2', type: 'service_worker' },
        ];

        await start(client);

        const attached = client.sent.filter((call) => call.method === 'Target.attachToTarget');
        expect(attached).toEqual([
            { method: 'Target.attachToTarget', params: { targetId: 't1', flatten: true }, sessionId: undefined },
        ]);
    });

    it('protects every page target the browser opens', async () => {
        const client = new FakeClient();
        const handle = await start(client);

        client.attach('s1', 't1');
        await handle.settled();

        expect(client.methods('s1')).toEqual([
            'Network.enable',
            'Network.setUserAgentOverride',
            'Page.enable',
            'Page.addScriptToEvaluateOnNewDocument',
            'Emulation.setTimezoneOverride',
            'Runtime.evaluate',
            'Target.setAutoAttach',
            'Runtime.runIfWaitingForDebugger',
        ]);
        expect(handle.protectedTargets()).toEqual(['t1']);
    });

    it('patches a document that already committed, so popups are spoofed too', async () => {
        const client = new FakeClient();
        const handle = await start(client);

        client.attach('s1', 'popup');
        await handle.settled();

        const evaluated = client.sent.find((call) => call.method === 'Runtime.evaluate');
        expect(evaluated?.sessionId).toBe('s1');
        expect(evaluated?.params).toEqual({ expression: buildProtectionPlan(profile).initScript });
    });

    it('resumes the target before waiting on the in-page evaluation', async () => {
        const client = new FakeClient();
        // A target paused at start cannot answer Runtime.evaluate until it is resumed.
        client.hangMethod = 'Runtime.evaluate';
        const handle = await start(client);

        client.attach('s1', 'popup');
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(client.methods('s1')).toContain('Runtime.runIfWaitingForDebugger');
    });

    it('still resumes a target whose in-page evaluation rejects', async () => {
        const client = new FakeClient();
        client.rejectMethod = 'Runtime.evaluate';
        const handle = await start(client);

        client.attach('s1', 't1');
        await handle.settled();

        expect(client.methods('s1')).toContain('Runtime.runIfWaitingForDebugger');
        expect(handle.protectedTargets()).toEqual(['t1']);
    });

    it('resumes the target even when an injection rejects', async () => {
        const client = new FakeClient();
        client.rejectMethod = 'Page.addScriptToEvaluateOnNewDocument';
        const handle = await start(client);

        client.attach('s1', 't1');
        await handle.settled();

        expect(client.methods('s1')).toContain('Runtime.runIfWaitingForDebugger');
    });

    it('resumes targets it does not protect', async () => {
        const client = new FakeClient();
        const handle = await start(client);

        client.attach('s1', 't1', 'service_worker');
        await handle.settled();

        expect(client.methods('s1')).toEqual(['Runtime.runIfWaitingForDebugger']);
        expect(handle.protectedTargets()).toEqual([]);
    });

    it('injects once per target', async () => {
        const client = new FakeClient();
        const handle = await start(client);

        client.attach('s1', 't1');
        await handle.settled();
        client.attach('s2', 't1');
        await handle.settled();

        expect(client.methods('s2')).toEqual(['Runtime.runIfWaitingForDebugger']);
    });

    it('forgets a detached target so a later attach is protected again', async () => {
        const client = new FakeClient();
        const handle = await start(client);

        client.attach('s1', 't1');
        await handle.settled();
        client.detach('s1');
        expect(handle.protectedTargets()).toEqual([]);

        client.attach('s2', 't1');
        await handle.settled();
        expect(client.methods('s2')).toContain('Page.addScriptToEvaluateOnNewDocument');
    });

    it('clears state once and reports a dead browser', async () => {
        const client = new FakeClient();
        let disconnects = 0;
        const handle = await start(client, () => {
            disconnects += 1;
        });

        client.attach('s1', 't1');
        await handle.settled();
        client.disconnect();
        client.disconnect();

        expect(disconnects).toBe(1);
        expect(handle.protectedTargets()).toEqual([]);
    });

    it('stops protecting new targets after stop', async () => {
        const client = new FakeClient();
        const handle = await start(client);
        await handle.stop();

        client.attach('s1', 't1');
        await handle.settled();

        expect(client.methods('s1')).toEqual(['Runtime.runIfWaitingForDebugger']);
        expect(client.sent.at(-2)).toEqual({
            method: 'Target.setAutoAttach',
            params: { autoAttach: false, waitForDebuggerOnStart: false, flatten: true },
            sessionId: undefined,
        });
    });

    it('survives a command that rejects on a dead session', async () => {
        const client = new FakeClient();
        client.rejectMethod = 'Runtime.runIfWaitingForDebugger';
        const handle = await start(client);

        client.attach('s1', 't1');
        await expect(handle.settled()).resolves.toBeUndefined();
    });
});
