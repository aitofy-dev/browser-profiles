// ============================================================================
// @aitofy/browser-profiles - ExTower API Client
// ============================================================================

import type {
    ProxyConfig,
    ProfileCookie,
    ExTowerCreateOptions,
    ExTowerProfile,
    ExTowerLaunchResult,
    ProfileGroup,
} from '../types';

/**
 * ExTower API response wrapper
 */
interface ExTowerResponse<T = any> {
    code: number;
    msg: string;
    data: T;
}

/**
 * ExTower client options
 */
export interface ExTowerClientOptions {
    /**
     * ExTower API base URL (default: http://localhost:50325)
     */
    baseUrl?: string;

    /**
     * Request timeout in ms (default: 30000)
     */
    timeout?: number;
}

/**
 * ExTower API Client
 *
 * Provides a clean TypeScript interface to the ExTower Local API.
 *
 * @example
 * ```typescript
 * import { ExTowerClient } from '@aitofy/browser-profiles/extower';
 *
 * const client = new ExTowerClient();
 *
 * // Create profile
 * const profile = await client.createProfile({
 *   name: 'My Profile',
 *   proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
 * });
 *
 * // Launch browser
 * const { puppeteer } = await client.launchBrowser(profile.userId);
 *
 * // Connect Puppeteer
 * const browser = await puppeteer.connect({ browserWSEndpoint: puppeteer });
 * ```
 */
export class ExTowerClient {
    private baseUrl: string;
    private timeout: number;

    constructor(options: ExTowerClientOptions = {}) {
        this.baseUrl = options.baseUrl || 'http://localhost:50325';
        this.timeout = options.timeout || 30000;
    }

    /**
     * Make API request
     */
    private async request<T>(
        method: 'GET' | 'POST',
        endpoint: string,
        data?: Record<string, any>
    ): Promise<T> {
        const url = new URL(endpoint, this.baseUrl);

        const options: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(this.timeout),
        };

        if (method === 'GET' && data) {
            Object.entries(data).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    url.searchParams.append(key, String(value));
                }
            });
        } else if (method === 'POST' && data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(url.toString(), options);

        if (!response.ok) {
            throw new Error(`ExTower API error: ${response.status} ${response.statusText}`);
        }

        const result = (await response.json()) as ExTowerResponse<T>;

        if (result.code !== 0) {
            throw new Error(`ExTower API error: ${result.msg} (code: ${result.code})`);
        }

        return result.data;
    }

    // ============================================================================
    // Profile Management
    // ============================================================================

    /**
     * Create a new browser profile
     */
    async createProfile(options: ExTowerCreateOptions): Promise<{ id: string }> {
        const proxyConfig = options.proxy
            ? {
                proxy_type: options.proxy.type,
                proxy_host: options.proxy.host,
                proxy_port: String(options.proxy.port),
                proxy_user: options.proxy.username || '',
                proxy_password: options.proxy.password || '',
                proxy_soft: 'other',
            }
            : undefined;

        const data = {
            name: options.name,
            group_id: options.groupId || '0',
            user_proxy_config: proxyConfig,
            open_urls: options.openUrls || [],
            cookie: options.cookies ? JSON.stringify(options.cookies) : '',
            ...(options.userAgent ? { user_agent: options.userAgent } : {}),
        };

        const result = await this.request<{ id: string }>('POST', '/api/v1/user/create', data);
        return result;
    }

    /**
     * Update profile settings
     */
    async updateProfile(
        userId: string,
        updates: Partial<ExTowerCreateOptions>
    ): Promise<void> {
        const data: Record<string, any> = {
            user_id: userId,
        };

        if (updates.name) {
            data.name = updates.name;
        }

        if (updates.proxy) {
            data.user_proxy_config = {
                proxy_type: updates.proxy.type,
                proxy_host: updates.proxy.host,
                proxy_port: String(updates.proxy.port),
                proxy_user: updates.proxy.username || '',
                proxy_password: updates.proxy.password || '',
                proxy_soft: 'other',
            };
        }

        if (updates.openUrls) {
            data.open_urls = updates.openUrls;
        }

        await this.request<void>('POST', '/api/v1/user/update', data);
    }

    /**
     * Delete a profile
     */
    async deleteProfile(userId: string): Promise<void> {
        await this.request<void>('POST', '/api/v1/user/delete', {
            user_ids: [userId],
        });
    }

    /**
     * Delete multiple profiles
     */
    async deleteProfiles(userIds: string[]): Promise<void> {
        await this.request<void>('POST', '/api/v1/user/delete', {
            user_ids: userIds,
        });
    }

    /**
     * List profiles
     */
    async listProfiles(options?: {
        groupId?: string;
        page?: number;
        pageSize?: number;
    }): Promise<{ list: ExTowerProfile[]; count: number }> {
        const result = await this.request<{ list: any[]; page: { count: number } }>(
            'GET',
            '/api/v1/user/list',
            {
                group_id: options?.groupId,
                page: options?.page || 1,
                page_size: options?.pageSize || 100,
            }
        );

        return {
            list: result.list.map((item) => ({
                userId: item.user_id,
                name: item.name,
                groupId: item.group_id,
                createdTime: item.created_time,
            })),
            count: result.page.count,
        };
    }

    /**
     * Get profile by ID
     */
    async getProfile(userId: string): Promise<ExTowerProfile | null> {
        try {
            const result = await this.request<{ list: any[] }>('GET', '/api/v1/user/list', {
                user_id: userId,
            });

            if (result.list.length === 0) {
                return null;
            }

            const item = result.list[0];
            return {
                userId: item.user_id,
                name: item.name,
                groupId: item.group_id,
                createdTime: item.created_time,
            };
        } catch {
            return null;
        }
    }

    // ============================================================================
    // Browser Control
    // ============================================================================

    /**
     * Launch browser for a profile
     */
    async launchBrowser(userId: string): Promise<ExTowerLaunchResult> {
        const result = await this.request<{ ws: ExTowerLaunchResult }>('GET', '/api/v1/browser/start', {
            user_id: userId,
        });

        return result.ws;
    }

    /**
     * Close browser for a profile
     */
    async closeBrowser(userId: string): Promise<void> {
        await this.request<void>('GET', '/api/v1/browser/stop', {
            user_id: userId,
        });
    }

    /**
     * Check if browser is running
     */
    async isBrowserActive(userId: string): Promise<boolean> {
        try {
            const result = await this.request<{ status: string }>('GET', '/api/v1/browser/active', {
                user_id: userId,
            });
            return result.status === 'Active';
        } catch {
            return false;
        }
    }

    // ============================================================================
    // Group Management
    // ============================================================================

    /**
     * List groups
     */
    async listGroups(): Promise<ProfileGroup[]> {
        const result = await this.request<{ list: any[] }>('GET', '/api/v1/group/list', {
            page: 1,
            page_size: 1000,
        });

        return result.list.map((item) => ({
            id: item.group_id,
            name: item.group_name,
            profileCount: item.count || 0,
        }));
    }

    /**
     * Create a group
     */
    async createGroup(name: string): Promise<{ id: string }> {
        const result = await this.request<{ group_id: string }>('POST', '/api/v1/group/create', {
            group_name: name,
        });

        return { id: result.group_id };
    }

    /**
     * Move profiles to a group
     */
    async moveToGroup(userIds: string[], groupId: string): Promise<void> {
        await this.request<void>('POST', '/api/v1/user/regroup', {
            user_ids: userIds,
            group_id: groupId,
        });
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    /**
     * Update proxy for a profile
     */
    async updateProxy(userId: string, proxy: ProxyConfig): Promise<void> {
        await this.updateProfile(userId, { proxy });
    }

    /**
     * Set cookies for a profile
     */
    async setCookies(userId: string, cookies: ProfileCookie[]): Promise<void> {
        await this.request<void>('POST', '/api/v1/user/update', {
            user_id: userId,
            cookie: JSON.stringify(cookies),
        });
    }

    /**
     * Health check - verify ExTower is running
     */
    async healthCheck(): Promise<boolean> {
        try {
            await this.request<any>('GET', '/api/v1/group/list', {
                page: 1,
                page_size: 1,
            });
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Create ExTower client with default options
 */
export function createExTowerClient(options?: ExTowerClientOptions): ExTowerClient {
    return new ExTowerClient(options);
}
