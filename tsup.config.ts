import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        cli: 'src/cli.ts',
        puppeteer: 'src/integrations/puppeteer.ts',
        playwright: 'src/integrations/playwright.ts',
        'extower': 'src/integrations/extower.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: false,
    external: ['puppeteer', 'puppeteer-core', 'rebrowser-puppeteer-core', 'playwright', 'playwright-core'],
});
