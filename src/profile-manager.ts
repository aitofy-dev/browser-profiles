// ============================================================================
// @aitofy/browser-profiles - Profile Manager
// ============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
    ProfileConfig,
    StoredProfile,
    ProfileGroup,
    BrowserProfilesOptions,
    LaunchOptions,
    LaunchResult,
} from './types';
import { launchChrome, closeBrowser } from './chrome-launcher';
import os from 'os';

/**
 * Default storage path for profiles
 * Uses ~/.aitofy/browser-profiles to avoid bloating project directories
 */
const DEFAULT_STORAGE_PATH = path.join(os.homedir(), '.aitofy', 'browser-profiles');

/**
 * Generate a unique profile ID
 */
function generateId(): string {
    return crypto.randomBytes(8).toString('hex');
}

/**
 * BrowserProfiles - Manage anti-detect browser profiles
 *
 * @example
 * ```typescript
 * import { BrowserProfiles } from '@aitofy/browser-profiles';
 *
 * const profiles = new BrowserProfiles({
 *   storagePath: './my-profiles',
 * });
 *
 * // Create a profile
 * const profile = await profiles.create({
 *   name: 'My Profile',
 *   proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
 *   timezone: 'America/New_York',
 * });
 *
 * // Launch browser
 * const { wsEndpoint, close } = await profiles.launch(profile.id);
 *
 * // Connect with Puppeteer
 * const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
 * ```
 */
export class BrowserProfiles {
    private storagePath: string;
    private profilesPath: string;
    private groupsPath: string;
    private options: BrowserProfilesOptions;
    private runningBrowsers: Map<string, LaunchResult> = new Map();

    constructor(options: BrowserProfilesOptions = {}) {
        this.options = options;
        this.storagePath = options.storagePath || DEFAULT_STORAGE_PATH;
        this.profilesPath = path.join(this.storagePath, 'profiles');
        this.groupsPath = path.join(this.storagePath, 'groups');

        this.ensureDirectories();
    }

    /**
     * Ensure storage directories exist
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
        if (!fs.existsSync(this.profilesPath)) {
            fs.mkdirSync(this.profilesPath, { recursive: true });
        }
        if (!fs.existsSync(this.groupsPath)) {
            fs.mkdirSync(this.groupsPath, { recursive: true });
        }
    }

    /**
     * Get path to profile data directory
     */
    private getProfileDataPath(profileId: string): string {
        return path.join(this.profilesPath, profileId, 'data');
    }

    /**
     * Get path to profile config file
     */
    private getProfileConfigPath(profileId: string): string {
        return path.join(this.profilesPath, profileId, 'config.json');
    }

    /**
     * Create a new browser profile
     */
    async create(config: ProfileConfig): Promise<StoredProfile> {
        const id = config.id || generateId();
        const now = Date.now();

        const profile: StoredProfile = {
            ...config,
            id,
            name: config.name || `Profile ${id.slice(0, 6)}`,
            timezone: config.timezone || this.options.defaultTimezone || 'America/New_York',
            proxy: config.proxy || this.options.defaultProxy || null,
            cookies: config.cookies || [],
            fingerprint: config.fingerprint || {},
            startUrls: config.startUrls || [],
            tags: config.tags || [],
            createdAt: now,
            updatedAt: now,
        };

        // Create profile directory
        const profileDir = path.join(this.profilesPath, id);
        if (!fs.existsSync(profileDir)) {
            fs.mkdirSync(profileDir, { recursive: true });
        }

        // Create data directory for Chrome user data
        const dataDir = this.getProfileDataPath(id);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Save config
        const configPath = this.getProfileConfigPath(id);
        fs.writeFileSync(configPath, JSON.stringify(profile, null, 2));

        return profile;
    }

    /**
     * Get a profile by ID
     */
    async get(profileId: string): Promise<StoredProfile | null> {
        const configPath = this.getProfileConfigPath(profileId);

        if (!fs.existsSync(configPath)) {
            return null;
        }

        try {
            const data = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(data) as StoredProfile;
        } catch {
            return null;
        }
    }

    /**
     * List all profiles
     */
    async list(options?: {
        groupId?: string;
        tags?: string[];
        limit?: number;
        offset?: number;
    }): Promise<StoredProfile[]> {
        const profiles: StoredProfile[] = [];

        if (!fs.existsSync(this.profilesPath)) {
            return profiles;
        }

        const dirs = fs.readdirSync(this.profilesPath);

        for (const dir of dirs) {
            const configPath = path.join(this.profilesPath, dir, 'config.json');
            if (fs.existsSync(configPath)) {
                try {
                    const data = fs.readFileSync(configPath, 'utf-8');
                    const profile = JSON.parse(data) as StoredProfile;

                    // Apply filters
                    if (options?.groupId && profile.groupId !== options.groupId) {
                        continue;
                    }
                    if (options?.tags && options.tags.length > 0) {
                        const hasTag = options.tags.some((tag) => profile.tags?.includes(tag));
                        if (!hasTag) continue;
                    }

                    profiles.push(profile);
                } catch {
                    // Skip invalid profiles
                }
            }
        }

        // Sort by creation time (newest first)
        profiles.sort((a, b) => b.createdAt - a.createdAt);

        // Apply pagination
        const offset = options?.offset || 0;
        const limit = options?.limit || profiles.length;

        return profiles.slice(offset, offset + limit);
    }

    /**
     * Update a profile
     */
    async update(profileId: string, updates: Partial<ProfileConfig>): Promise<StoredProfile | null> {
        const existing = await this.get(profileId);
        if (!existing) {
            return null;
        }

        const updated: StoredProfile = {
            ...existing,
            ...updates,
            id: existing.id, // Prevent ID change
            createdAt: existing.createdAt, // Preserve creation time
            updatedAt: Date.now(),
        };

        const configPath = this.getProfileConfigPath(profileId);
        fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));

        return updated;
    }

    /**
     * Delete a profile
     */
    async delete(profileId: string): Promise<boolean> {
        const profileDir = path.join(this.profilesPath, profileId);

        if (!fs.existsSync(profileDir)) {
            return false;
        }

        // Close browser if running
        if (this.runningBrowsers.has(profileId)) {
            const browser = this.runningBrowsers.get(profileId)!;
            await browser.close();
            this.runningBrowsers.delete(profileId);
        }

        // Remove directory recursively
        fs.rmSync(profileDir, { recursive: true, force: true });

        return true;
    }

    /**
     * Launch a browser with the specified profile
     */
    async launch(profileId: string, options?: LaunchOptions): Promise<LaunchResult> {
        const profile = await this.get(profileId);
        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }

        // Close existing browser for this profile if any
        if (this.runningBrowsers.has(profileId)) {
            const existing = this.runningBrowsers.get(profileId)!;
            await existing.close();
            this.runningBrowsers.delete(profileId);
        }

        // Get user data directory
        const userDataDir = this.getProfileDataPath(profileId);

        // Launch Chrome
        const result = await launchChrome({
            profile,
            userDataDir,
            chromePath: options?.chromePath || this.options.chromePath,
            headless: options?.headless ?? false,
            args: options?.args,
            extensions: options?.extensions,
            defaultViewport: options?.defaultViewport,
            slowMo: options?.slowMo,
            timeout: options?.timeout,
        });

        // Update last launched time
        await this.update(profileId, {});
        const updated = await this.get(profileId);
        if (updated) {
            updated.lastLaunchedAt = Date.now();
            const configPath = this.getProfileConfigPath(profileId);
            fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
        }

        // Track running browser
        this.runningBrowsers.set(profileId, result);

        return result;
    }

    /**
     * Close a running browser
     */
    async close(profileId: string): Promise<boolean> {
        const browser = this.runningBrowsers.get(profileId);
        if (!browser) {
            return false;
        }

        await browser.close();
        this.runningBrowsers.delete(profileId);
        return true;
    }

    /**
     * Close all running browsers
     */
    async closeAll(): Promise<void> {
        const promises = Array.from(this.runningBrowsers.values()).map((b) => b.close());
        await Promise.allSettled(promises);
        this.runningBrowsers.clear();
    }

    /**
     * Get running browsers
     */
    getRunning(): Map<string, LaunchResult> {
        return new Map(this.runningBrowsers);
    }

    /**
     * Create a profile group
     */
    async createGroup(name: string, description?: string): Promise<ProfileGroup> {
        const id = generateId();
        const group: ProfileGroup = {
            id,
            name,
            description,
            profileCount: 0,
        };

        const groupPath = path.join(this.groupsPath, `${id}.json`);
        fs.writeFileSync(groupPath, JSON.stringify(group, null, 2));

        return group;
    }

    /**
     * List all groups
     */
    async listGroups(): Promise<ProfileGroup[]> {
        const groups: ProfileGroup[] = [];

        if (!fs.existsSync(this.groupsPath)) {
            return groups;
        }

        const files = fs.readdirSync(this.groupsPath);

        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const data = fs.readFileSync(path.join(this.groupsPath, file), 'utf-8');
                    const group = JSON.parse(data) as ProfileGroup;

                    // Count profiles in this group
                    const profiles = await this.list({ groupId: group.id });
                    group.profileCount = profiles.length;

                    groups.push(group);
                } catch {
                    // Skip invalid files
                }
            }
        }

        return groups;
    }

    /**
     * Delete a group (does not delete profiles in the group)
     */
    async deleteGroup(groupId: string): Promise<boolean> {
        const groupPath = path.join(this.groupsPath, `${groupId}.json`);

        if (!fs.existsSync(groupPath)) {
            return false;
        }

        fs.unlinkSync(groupPath);
        return true;
    }

    /**
     * Move profile to a group
     */
    async moveToGroup(profileId: string, groupId: string | null): Promise<boolean> {
        const result = await this.update(profileId, { groupId: groupId || undefined });
        return result !== null;
    }

    /**
     * Duplicate a profile
     */
    async duplicate(profileId: string, newName?: string): Promise<StoredProfile | null> {
        const existing = await this.get(profileId);
        if (!existing) {
            return null;
        }

        // Create new profile with same config but new ID
        const newProfile = await this.create({
            ...existing,
            id: undefined, // Generate new ID
            name: newName || `${existing.name} (Copy)`,
        });

        return newProfile;
    }

    /**
     * Export profile to JSON
     */
    async export(profileId: string): Promise<string | null> {
        const profile = await this.get(profileId);
        if (!profile) {
            return null;
        }

        return JSON.stringify(profile, null, 2);
    }

    /**
     * Import profile from JSON
     */
    async import(json: string): Promise<StoredProfile> {
        const config = JSON.parse(json) as ProfileConfig;

        // Create with new ID to avoid conflicts
        return this.create({
            ...config,
            id: undefined,
        });
    }
}

export { closeBrowser };
