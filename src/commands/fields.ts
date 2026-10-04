// ============================================================================
// @aitofy/browser-profiles - Input fields shared by several commands
// ============================================================================
// Descriptions become CLI flag help and MCP schema docs, so they are written
// for an agent reading them with no other context.

import { z } from 'zod';

/** Ids and names become path segments, so anything that could walk the filesystem is out. */
const PATH_SAFE = /^[^/\\]+$/;

export const idOrNameField = z
    .string()
    .min(1)
    .regex(PATH_SAFE, 'Must not contain a path separator ("/" or "\\").')
    .refine((value) => !value.includes('..'), 'Must not contain "..".')
    .describe(
        'Profile identifier: either the profile id (e.g. "a1b2c3d4e5f60718") or its exact name ' +
        '(case-insensitive, e.g. "Google Main"). Ids are tried first. Use profile.list to discover both.'
    );

export const PROXY_URL_DESCRIPTION =
    'Proxy as a URL with an explicit port: "<scheme>://[user:pass@]host:port". ' +
    'Schemes: http, https, socks5 (socks and socks5h are accepted and normalised to socks5). ' +
    'Percent-encode reserved characters in credentials, e.g. "http://bob:p%40ss@10.0.0.1:8080". ' +
    'Example: "socks5://gate.provider.net:1080".';

export const proxyUrlField = z.string().min(1).describe(PROXY_URL_DESCRIPTION);

/** `.optional()` wraps the schema, so the description has to be re-applied. */
export const optionalProxyUrlField = proxyUrlField.optional().describe(PROXY_URL_DESCRIPTION);

export const headlessField = z
    .boolean()
    .optional()
    .describe(
        'Run Chrome without a visible window. Default false (a real window is far less detectable). ' +
        'Set true only on machines with no display.'
    );

export const timezoneField = z
    .string()
    .min(1)
    .optional()
    .describe(
        'IANA timezone id used for the browser clock and Intl output, e.g. "America/New_York" or "Asia/Ho_Chi_Minh". ' +
        'Match it to the proxy exit country or the profile becomes trivially detectable.'
    );

export const languageField = z
    .string()
    .min(2)
    .optional()
    .describe(
        'BCP 47 language tag for navigator.language and the Accept-Language header, e.g. "en-US", "vi-VN", "de-DE". ' +
        'Default "en-US".'
    );

export const platformField = z
    .string()
    .min(1)
    .optional()
    .describe(
        'navigator.platform value to report. Use exactly one of "Win32", "MacIntel" or "Linux x86_64"; ' +
        'it must agree with the user agent.'
    );

export const tagsField = z
    .array(z.string().min(1))
    .optional()
    .describe('Free-form labels for filtering, e.g. ["facebook", "client-acme"]. Pass an array of strings.');

export const notesField = z
    .string()
    .optional()
    .describe('Free-form note stored with the profile, e.g. the account it belongs to. Not sent to the browser.');

export const detachedField = z
    .boolean()
    .optional()
    .describe(
        'Let Chrome outlive the process that opened it. Default false: the opener keeps the browser ' +
        'protected (per-tab fingerprint injection, authenticated proxy relay) and closes it on exit. ' +
        'Set true only for scripts that must exit immediately; then only flag-level protections remain ' +
        'and an authenticated proxy will not work. Kernel mode is the exception: its spoof is in the ' +
        'Chrome flags, so later tabs stay spoofed after the opener exits.'
    );

export const engineField = z
    .enum(['auto', 'kernel', 'inject'])
    .optional()
    .describe(
        'Where the fingerprint is applied. "kernel" needs a fingerprint-chromium binary and spoofs ' +
        'canvas, WebGL, audio, fonts and client rects inside Chromium, with no JavaScript hooks. ' +
        '"inject" patches stock Chrome from JavaScript over CDP. "auto" (default) uses kernel when the ' +
        'binary has the fingerprint-platform switch, otherwise inject. Install ' +
        'the kernel at ~/.aitofy/browser-profiles/kernel/ or set CHROMIUM_PATH. ' +
        'Builds: https://github.com/adryfish/fingerprint-chromium/releases'
    );
