import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, isDebugEnabled } from './log';

function captureStderr(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        lines.push(String(chunk));
        return true;
    });
    return { lines, restore: () => spy.mockRestore() };
}

describe('isDebugEnabled', () => {
    it('matches the package tag and wildcards', () => {
        expect(isDebugEnabled('browser-profiles')).toBe(true);
        expect(isDebugEnabled('browser-profiles*')).toBe(true);
        expect(isDebugEnabled('browser-*')).toBe(true);
        expect(isDebugEnabled('*')).toBe(true);
        expect(isDebugEnabled('app:*,browser-profiles')).toBe(true);
    });

    it('ignores unrelated namespaces', () => {
        expect(isDebugEnabled(undefined)).toBe(false);
        expect(isDebugEnabled('')).toBe(false);
        expect(isDebugEnabled('something-else')).toBe(false);
        expect(isDebugEnabled('browser-profilesx')).toBe(false);
    });
});

describe('createLogger', () => {
    const originalDebug = process.env.DEBUG;

    afterEach(() => {
        if (originalDebug === undefined) delete process.env.DEBUG;
        else process.env.DEBUG = originalDebug;
    });

    it('stays silent for debug/info by default', () => {
        delete process.env.DEBUG;
        const out = captureStderr();
        const log = createLogger('test');
        log.debug('hidden');
        log.info('hidden');
        out.restore();
        expect(out.lines).toEqual([]);
    });

    it('always writes warn and error to stderr', () => {
        delete process.env.DEBUG;
        const out = captureStderr();
        createLogger('test').warn('careful');
        createLogger('test').error('broken');
        out.restore();
        expect(out.lines.join('')).toContain('[browser-profiles:test] warn careful');
        expect(out.lines.join('')).toContain('[browser-profiles:test] error broken');
    });

    it('enables debug/info with verbose', () => {
        delete process.env.DEBUG;
        const out = captureStderr();
        createLogger('test', { verbose: true }).debug('shown');
        out.restore();
        expect(out.lines.join('')).toContain('shown');
    });

    it('enables debug/info with DEBUG', () => {
        process.env.DEBUG = 'browser-profiles*';
        const out = captureStderr();
        createLogger('test').info('shown');
        out.restore();
        expect(out.lines.join('')).toContain('shown');
    });

    it('never writes to stdout', () => {
        process.env.DEBUG = 'browser-profiles';
        const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const err = captureStderr();
        const log = createLogger('test');
        log.debug('a');
        log.info('b');
        log.warn('c');
        log.error('d');
        err.restore();
        expect(stdout).not.toHaveBeenCalled();
        stdout.mockRestore();
    });
});
