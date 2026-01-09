#!/usr/bin/env node
// ============================================================================
// @aitofy/browser-profiles CLI
// ============================================================================

import { Command } from 'commander';
import { BrowserProfiles } from './profile-manager';
import { VERSION } from './index';

const program = new Command();

// Initialize profiles manager
const profiles = new BrowserProfiles();

program
    .name('browser-profiles')
    .description('Self-hosted anti-detect browser profiles CLI')
    .version(VERSION);

// ============================================================================
// List profiles
// ============================================================================
program
    .command('list')
    .alias('ls')
    .description('List all browser profiles')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
        try {
            const allProfiles = await profiles.list();

            if (options.json) {
                console.log(JSON.stringify(allProfiles, null, 2));
                return;
            }

            if (allProfiles.length === 0) {
                console.log('No profiles found. Create one with: browser-profiles create <name>');
                return;
            }

            console.log('\n📋 Browser Profiles:\n');
            console.log('ID                                    | Name              | Proxy              | Created');
            console.log('--------------------------------------|-------------------|--------------------|-----------------');

            for (const profile of allProfiles) {
                const id = profile.id.substring(0, 36).padEnd(36);
                const name = (profile.name || 'Unnamed').substring(0, 17).padEnd(17);
                const proxy = profile.proxy
                    ? `${profile.proxy.host}:${profile.proxy.port}`.substring(0, 18).padEnd(18)
                    : 'No proxy'.padEnd(18);
                const created = new Date(profile.createdAt).toLocaleDateString();

                console.log(`${id} | ${name} | ${proxy} | ${created}`);
            }

            console.log(`\nTotal: ${allProfiles.length} profile(s)\n`);
        } catch (error) {
            console.error('Error listing profiles:', (error as Error).message);
            process.exit(1);
        }
    });

// ============================================================================
// Create profile
// ============================================================================
interface CreateOptions {
    proxy?: string;
    timezone?: string;
    language?: string;
    platform?: string;
}

program
    .command('create <name>')
    .description('Create a new browser profile')
    .option('-p, --proxy <url>', 'Proxy URL (e.g., http://user:pass@host:port)')
    .option('-t, --timezone <tz>', 'Timezone (e.g., America/New_York)')
    .option('-l, --language <lang>', 'Language (e.g., en-US)')
    .option('--platform <platform>', 'Platform (Win32, MacIntel, Linux x86_64)')
    .action(async (name: string, options: CreateOptions) => {
        try {
            // Parse proxy URL if provided
            let proxy;
            if (options.proxy) {
                const url = new URL(options.proxy);
                proxy = {
                    type: url.protocol.replace(':', '') as 'http' | 'https' | 'socks5',
                    host: url.hostname,
                    port: parseInt(url.port) || 8080,
                    username: url.username || undefined,
                    password: url.password || undefined,
                };
            }

            const profile = await profiles.create({
                name,
                proxy,
                timezone: options.timezone,
                fingerprint: {
                    language: options.language,
                    platform: options.platform,
                },
            });

            console.log('\n✅ Profile created successfully!\n');
            console.log(`ID:       ${profile.id}`);
            console.log(`Name:     ${profile.name}`);
            if (proxy) {
                console.log(`Proxy:    ${proxy.host}:${proxy.port}`);
            }
            if (options.timezone) {
                console.log(`Timezone: ${options.timezone}`);
            }
            console.log(`\nLaunch with: browser-profiles open ${profile.id}\n`);
        } catch (error) {
            console.error('Error creating profile:', (error as Error).message);
            process.exit(1);
        }
    });

// ============================================================================
// Delete profile
// ============================================================================
program
    .command('delete <id>')
    .alias('rm')
    .description('Delete a browser profile')
    .option('-f, --force', 'Skip confirmation')
    .action(async (id: string) => {
        try {
            const profile = await profiles.get(id);
            if (!profile) {
                console.error(`Profile not found: ${id}`);
                process.exit(1);
            }

            const success = await profiles.delete(id);

            if (success) {
                console.log(`\n✅ Profile deleted: ${profile.name || id}\n`);
            } else {
                console.error('Failed to delete profile');
                process.exit(1);
            }
        } catch (error) {
            console.error('Error deleting profile:', (error as Error).message);
            process.exit(1);
        }
    });

// ============================================================================
// Show profile info
// ============================================================================
program
    .command('info <id>')
    .description('Show profile details')
    .option('-j, --json', 'Output as JSON')
    .action(async (id: string, options: { json?: boolean }) => {
        try {
            const profile = await profiles.get(id);
            if (!profile) {
                console.error(`Profile not found: ${id}`);
                process.exit(1);
            }

            if (options.json) {
                console.log(JSON.stringify(profile, null, 2));
                return;
            }

            console.log('\n📋 Profile Details:\n');
            console.log(`ID:         ${profile.id}`);
            console.log(`Name:       ${profile.name || 'Unnamed'}`);
            console.log(`Created:    ${new Date(profile.createdAt).toLocaleString()}`);
            console.log(`Updated:    ${new Date(profile.updatedAt).toLocaleString()}`);

            if (profile.proxy) {
                console.log(`\nProxy:`);
                console.log(`  Type:     ${profile.proxy.type}`);
                console.log(`  Host:     ${profile.proxy.host}`);
                console.log(`  Port:     ${profile.proxy.port}`);
                if (profile.proxy.username) {
                    console.log(`  Username: ${profile.proxy.username}`);
                }
            }

            if (profile.timezone) {
                console.log(`\nTimezone:   ${profile.timezone}`);
            }

            if (profile.fingerprint) {
                console.log(`\nFingerprint:`);
                if (profile.fingerprint.language) console.log(`  Language: ${profile.fingerprint.language}`);
                if (profile.fingerprint.platform) console.log(`  Platform: ${profile.fingerprint.platform}`);
                if (profile.fingerprint.userAgent) console.log(`  UA:       ${profile.fingerprint.userAgent.substring(0, 50)}...`);
            }

            console.log('');
        } catch (error) {
            console.error('Error getting profile:', (error as Error).message);
            process.exit(1);
        }
    });

// ============================================================================
// Open browser with profile
// ============================================================================
program
    .command('open <id>')
    .description('Open browser with a profile')
    .option('-h, --headless', 'Run in headless mode')
    .action(async (id: string, options: { headless?: boolean }) => {
        try {
            const profile = await profiles.get(id);
            if (!profile) {
                console.error(`Profile not found: ${id}`);
                process.exit(1);
            }

            console.log(`\n🚀 Launching browser for: ${profile.name || id}`);

            const result = await profiles.launch(id, {
                headless: options.headless || false,
            });

            console.log(`\n✅ Browser launched!`);
            console.log(`   WebSocket: ${result.wsEndpoint}`);
            console.log(`   PID: ${result.pid}`);
            console.log(`\nPress Ctrl+C to close the browser.\n`);

            // Keep process alive
            process.on('SIGINT', async () => {
                console.log('\nClosing browser...');
                await result.close();
                process.exit(0);
            });

            // Prevent exit
            await new Promise(() => { });
        } catch (error) {
            console.error('Error launching browser:', (error as Error).message);
            process.exit(1);
        }
    });

// ============================================================================
// Quick launch
// ============================================================================
interface LaunchOptions {
    proxy?: string;
    headless?: boolean;
    random?: boolean;
}

program
    .command('launch')
    .description('Quick launch browser without saving profile')
    .option('-p, --proxy <url>', 'Proxy URL')
    .option('-h, --headless', 'Run in headless mode')
    .option('--random', 'Use random fingerprint')
    .action(async (options: LaunchOptions) => {
        try {
            // Dynamic import to avoid loading puppeteer at startup
            const { createSession } = await import('./integrations/puppeteer');

            let proxy;
            if (options.proxy) {
                const url = new URL(options.proxy);
                proxy = {
                    type: url.protocol.replace(':', '') as 'http' | 'https' | 'socks5',
                    host: url.hostname,
                    port: parseInt(url.port) || 8080,
                    username: url.username || undefined,
                    password: url.password || undefined,
                };
            }

            console.log('\n🚀 Quick launching browser...');

            const session = await createSession({
                proxy,
                headless: options.headless || false,
                randomFingerprint: options.random !== false,
            });

            console.log(`\n✅ Browser launched!`);
            console.log(`   Session: ${session.session.id}`);
            console.log(`\nPress Ctrl+C to close the browser.\n`);

            // Keep process alive
            process.on('SIGINT', async () => {
                console.log('\nClosing browser...');
                await session.close();
                process.exit(0);
            });

            // Prevent exit
            await new Promise(() => { });
        } catch (error) {
            console.error('Error launching browser:', (error as Error).message);
            process.exit(1);
        }
    });

// ============================================================================
// Show storage path
// ============================================================================
program
    .command('path')
    .description('Show profiles storage path')
    .action(() => {
        const storagePath = process.env.HOME + '/.aitofy/browser-profiles';
        console.log(`\n📁 Profiles stored at: ${storagePath}\n`);
    });

// Parse and run
program.parse();
