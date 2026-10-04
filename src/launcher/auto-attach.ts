// ============================================================================
// @aitofy/browser-profiles - Protect every target the browser opens (ADR 4b)
// ============================================================================

import type { Logger } from '../log';
import type { CdpClient, CdpParams } from './deps';
import { applyProtections, applyWorkerProtections, sessionOf } from './protections';
import type { ProtectionPlan } from './protections';

/** Pausing new targets is what lets us inject before their first script runs. */
const AUTO_ATTACH_PARAMS: CdpParams = {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
};

const PROTECTED_TYPES = new Set(['page', 'iframe']);
const WORKER_TYPES = new Set(['worker', 'shared_worker', 'service_worker']);

interface AttachedTarget {
    sessionId: string;
    targetId: string;
    type: string;
}

function parseAttached(params: CdpParams): AttachedTarget | null {
    const { sessionId, targetInfo } = params as {
        sessionId?: unknown;
        targetInfo?: { targetId?: unknown; type?: unknown };
    };
    if (typeof sessionId !== 'string' || !targetInfo) return null;
    if (typeof targetInfo.targetId !== 'string' || typeof targetInfo.type !== 'string') return null;
    return { sessionId, targetId: targetInfo.targetId, type: targetInfo.type };
}

export interface AutoAttachHandle {
    /** Target ids currently protected through this connection. */
    protectedTargets(): string[];
    /** Resolves once every in-flight attachment has finished. */
    settled(): Promise<void>;
    /** Stop protecting new targets. The client stays open. */
    stop(): Promise<void>;
}

export interface AutoAttachOptions {
    client: CdpClient;
    plan: ProtectionPlan;
    log: Logger;
    /** Called once when the browser goes away. */
    onDisconnect?: () => void;
}

/**
 * Keep a browser-level CDP connection auto-attaching to new targets so an
 * external client (Playwright MCP, `puppeteer.connect`) cannot open a naked tab.
 */
export async function startAutoAttach(options: AutoAttachOptions): Promise<AutoAttachHandle> {
    const { client, plan, log } = options;
    const sessions = new Map<string, string>(); // sessionId -> targetId
    const inFlight = new Set<Promise<void>>();
    let stopped = false;

    const isProtected = (targetId: string): boolean =>
        Array.from(sessions.values()).includes(targetId);

    const protect = async (target: AttachedTarget): Promise<void> => {
        let patched: Promise<unknown> = Promise.resolve();
        try {
            if (stopped || isProtected(target.targetId)) return;
            const session = sessionOf(client, target.sessionId);
            if (WORKER_TYPES.has(target.type)) {
                sessions.set(target.sessionId, target.targetId);
                await applyWorkerProtections(session, plan);
                log.debug(`Protected ${target.type} target ${target.targetId}`);
                return;
            }
            if (!PROTECTED_TYPES.has(target.type)) return;
            sessions.set(target.sessionId, target.targetId);
            await applyProtections(session, plan);
            // A popup's first document is already committed when we attach, so the
            // new-document script above would only reach its next navigation. This patches
            // the document that exists now; it is only awaited after the resume below,
            // because evaluating needs the renderer thread the pause is holding.
            if (plan.initScript) {
                patched = session.send('Runtime.evaluate', { expression: plan.initScript }).catch(() => undefined);
            }
            if (target.type === 'page') {
                // Out-of-process iframes are only reported to a session that asks for them.
                await client.send('Target.setAutoAttach', AUTO_ATTACH_PARAMS, target.sessionId);
            }
            log.debug(`Protected ${target.type} target ${target.targetId}`);
        } catch (error) {
            log.debug(`Could not protect target ${target.targetId}`, error);
        } finally {
            // A target held by waitForDebuggerOnStart stays frozen until it is resumed,
            // so this runs even when the injections above failed.
            await client
                .send('Runtime.runIfWaitingForDebugger', {}, target.sessionId)
                .catch(() => undefined);
            await patched;
        }
    };

    const track = (target: AttachedTarget): void => {
        const task = protect(target).finally(() => inFlight.delete(task));
        inFlight.add(task);
    };

    client.on('Target.attachedToTarget', (params) => {
        const target = parseAttached(params);
        if (target) track(target);
    });

    client.on('Target.detachedFromTarget', (params) => {
        const sessionId = params.sessionId;
        if (typeof sessionId === 'string') sessions.delete(sessionId);
    });

    client.on('disconnect', () => {
        if (stopped) return;
        stopped = true;
        sessions.clear();
        log.debug('Browser CDP connection closed');
        options.onDisconnect?.();
    });

    await client.send('Target.setAutoAttach', AUTO_ATTACH_PARAMS);
    // Discovery keeps getTargets usable as a fallback on builds that do not
    // auto-attach to targets that already exist.
    await client.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
    await settle();
    if (sessions.size === 0) {
        await attachExistingPages(client, log);
        await settle();
    }

    async function settle(): Promise<void> {
        while (inFlight.size > 0) await Promise.all(Array.from(inFlight));
    }

    return {
        protectedTargets: () => Array.from(sessions.values()),
        settled: settle,
        stop: async () => {
            stopped = true;
            sessions.clear();
            await client
                .send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })
                .catch(() => undefined);
        },
    };
}

/** Attach by hand when setAutoAttach reported no existing target. */
async function attachExistingPages(client: CdpClient, log: Logger): Promise<void> {
    try {
        const result = await client.send('Target.getTargets');
        const targets = (result.targetInfos ?? []) as { targetId?: unknown; type?: unknown }[];
        for (const target of targets) {
            if (target.type !== 'page' || typeof target.targetId !== 'string') continue;
            await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        }
    } catch (error) {
        log.debug('Could not attach to existing targets', error);
    }
}
