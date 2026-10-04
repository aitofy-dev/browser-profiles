import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { detectExitLocation } from './proxy';

let server: http.Server | null = null;

afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
});

/** A forward proxy stand-in: records what it was asked for and answers like ip-api.com. */
async function fakeRelay(body: string): Promise<{ url: string; requested: () => string | undefined }> {
    let requested: string | undefined;
    server = http.createServer((request, response) => {
        requested = request.url;
        response.end(body);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return { url: `http://127.0.0.1:${port}`, requested: () => requested };
}

describe('detectExitLocation', () => {
    it('asks through the relay for the caller IP, not for the proxy host', async () => {
        const relay = await fakeRelay(JSON.stringify({
            status: 'success', country: 'United States', regionName: 'New Jersey', city: 'Verona',
            timezone: 'America/New_York',
        }));

        const geo = await detectExitLocation(relay.url);

        expect(relay.requested()).toMatch(/^http:\/\/ip-api\.com\/json\/\?fields=/);
        expect(geo).toEqual({
            timezone: 'America/New_York', country: 'United States', city: 'Verona', region: 'New Jersey',
        });
    });

    it('returns null when the lookup fails or answers garbage', async () => {
        const failed = await fakeRelay(JSON.stringify({ status: 'fail' }));
        expect(await detectExitLocation(failed.url)).toBeNull();
        await new Promise<void>((resolve) => server?.close(() => resolve()));

        const garbage = await fakeRelay('<html>blocked</html>');
        expect(await detectExitLocation(garbage.url)).toBeNull();
    });

    it('returns null when the relay is unreachable', async () => {
        expect(await detectExitLocation('http://127.0.0.1:9', 2000)).toBeNull();
    });
});
