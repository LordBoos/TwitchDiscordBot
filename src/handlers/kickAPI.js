const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class KickAPI {
    constructor(models) {
        this.models = models;
        this.publicApiBase = 'https://api.kick.com/public/v1';
        this.unofficialApiBase = 'https://kick.com/api';
        this.oauthUrl = 'https://id.kick.com';
        this.clientId = process.env.KICK_CLIENT_ID;
        this.clientSecret = process.env.KICK_CLIENT_SECRET;
        this.accessToken = null;
        this.tokenExpiresAt = null;
        this.publicKey = null;
        this.hasCredentials = !!(this.clientId && this.clientSecret);
    }

    async initialize() {
        if (this.hasCredentials) {
            try {
                await this.loadOrRefreshToken();
                await this.fetchPublicKey();
                logger.info('KickAPI initialized with official credentials');
            } catch (error) {
                logger.warn('KickAPI: Failed to initialize official API, falling back to polling-only mode:', error.message);
                this.hasCredentials = false;
            }
        } else {
            logger.info('KickAPI initialized in polling-only mode (no KICK_CLIENT_ID/KICK_CLIENT_SECRET configured)');
        }
    }

    async loadOrRefreshToken() {
        const stored = await this.models.getKickToken();
        if (stored) {
            const expiresAt = new Date(stored.expires_at);
            const now = new Date();
            // Use stored token if valid for more than 5 minutes
            if ((expiresAt - now) > 5 * 60 * 1000) {
                this.accessToken = stored.access_token;
                this.tokenExpiresAt = expiresAt;
                logger.info('Loaded Kick access token from database');
                return;
            }
        }
        await this.fetchNewToken();
    }

    async fetchNewToken() {
        const response = await axios.post(
            `${this.oauthUrl}/oauth/token`,
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: this.clientId,
                client_secret: this.clientSecret,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, expires_in } = response.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        this.accessToken = access_token;
        this.tokenExpiresAt = expiresAt;
        await this.models.saveKickToken(access_token, expiresAt);
        logger.info('Fetched new Kick access token');
    }

    async ensureToken() {
        if (!this.accessToken || (this.tokenExpiresAt && (this.tokenExpiresAt - new Date()) < 5 * 60 * 1000)) {
            await this.fetchNewToken();
        }
    }

    async fetchPublicKey() {
        try {
            const response = await axios.get(`${this.publicApiBase}/public-key`, { timeout: 10000 });
            // Response may be the key string directly or nested in an object
            this.publicKey = response.data?.public_key || response.data;
            logger.info('Fetched Kick RSA public key for webhook verification');
        } catch (error) {
            logger.warn('Could not fetch Kick public key (webhook signatures unverified):', error.message);
        }
    }

    // Verify RSA-SHA256 webhook signature from Kick
    verifyWebhookSignature(messageId, timestamp, rawBody, signatureB64) {
        if (!this.publicKey) {
            logger.error('No Kick public key available, rejecting webhook');
            return false;
        }
        if (!signatureB64) {
            logger.warn('No Kick webhook signature provided');
            return false;
        }
        try {
            const message = `${messageId}.${timestamp}.${rawBody.toString()}`;
            const signature = Buffer.from(signatureB64, 'base64');
            return crypto.verify('RSA-SHA256', Buffer.from(message), this.publicKey, signature);
        } catch (error) {
            logger.error('Kick webhook signature verification error:', error.message);
            return false;
        }
    }

    // Get channel info by slug - uses official API if credentials available, unofficial as fallback.
    // Returns null if channel definitively not found (404), or a stub with _unverified:true if
    // lookup failed due to API unavailability (403/network) so callers can still proceed.
    async getChannelBySlug(slug) {
        if (this.hasCredentials) {
            try {
                const result = await this.getChannelBySlugOfficial(slug);
                if (result) return result;
                logger.warn(`KickAPI: official channel lookup returned null for ${slug}, trying unofficial`);
            } catch (error) {
                logger.warn(`KickAPI: official channel lookup failed for ${slug}, trying unofficial:`, error.message);
            }
        }

        try {
            return await this.getChannelBySlugUnofficial(slug);
        } catch (error) {
            if (error.response?.status === 404) return null;
            // 403/network block — can't verify, but don't block the follow
            logger.warn(`KickAPI: unofficial lookup failed for ${slug} (HTTP ${error.response?.status ?? 'network'}), proceeding unverified`);
            return { id: null, slug, user: { id: null, username: slug }, _unverified: true };
        }
    }

    async getChannelBySlugOfficial(slug) {
        await this.ensureToken();
        const response = await axios.get(`${this.publicApiBase}/channels`, {
            params: { slug },
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                Accept: 'application/json',
            },
            timeout: 10000,
        });
        const data = response.data?.data?.[0];
        if (!data) return null;
        return {
            id: data.broadcaster_user_id,
            slug: data.slug ?? slug,
            user: {
                id: data.broadcaster_user_id,
                username: data.broadcaster_user_name ?? data.slug ?? slug,
            },
            livestream: null,
        };
    }

    async getChannelBySlugUnofficial(slug) {
        const response = await axios.get(`${this.unofficialApiBase}/v1/channels/${encodeURIComponent(slug)}`, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                Referer: 'https://kick.com/',
            },
            timeout: 10000,
        });
        return response.data;
    }

    // Returns current livestream object if the channel is live, null otherwise.
    // Tries official API first (by broadcaster_user_id) when credentials are available,
    // falls back to unofficial channel endpoint.
    async getLivestream(slug, broadcasterUserId = null) {
        // Try official API first if we have credentials and a broadcaster ID
        if (this.hasCredentials && broadcasterUserId) {
            try {
                const livestream = await this.getLivestreamOfficial(broadcasterUserId, slug);
                if (livestream !== undefined) return livestream; // null = not live, object = live
            } catch (error) {
                logger.warn(`Kick: official livestream check failed for ${slug}, trying unofficial:`, error.message);
            }
        }

        // Fallback to unofficial API
        try {
            const channel = await this.getChannelBySlugUnofficial(slug);
            if (!channel || !channel.livestream || !channel.livestream.is_live) {
                return null;
            }
            return {
                ...channel.livestream,
                slug: channel.slug,
                user: channel.user,
                channel_id: channel.id,
            };
        } catch (error) {
            const status = error.response?.status;
            const level = status === 403 ? 'warn' : 'error';
            logger[level](`Kick: unofficial livestream check failed for ${slug} (HTTP ${status ?? 'network'}):`, error.message);
            return null;
        }
    }

    // Official API: check if a broadcaster is currently live
    async getLivestreamOfficial(broadcasterUserId, slug) {
        await this.ensureToken();
        const response = await axios.get(`${this.publicApiBase}/livestreams`, {
            params: { broadcaster_user_id: Number(broadcasterUserId) },
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                Accept: 'application/json',
            },
            timeout: 10000,
        });
        const data = response.data?.data?.[0];
        if (!data || !data.is_live) return null;
        return {
            session_title: data.session_title,
            is_live: true,
            viewer_count: data.viewers ?? 0,
            slug: data.slug || slug,
            categories: data.categories || [],
            user: {
                username: slug,
                profile_pic: data.thumbnail || null,
            },
            channel_id: data.channel_id,
            broadcaster_user_id: data.broadcaster_user_id,
        };
    }

    // Get recent clips for a channel — tries official API first, unofficial as fallback
    async getRecentClips(slug, broadcasterUserId = null) {
        if (this.hasCredentials && broadcasterUserId) {
            try {
                const clips = await this.getClipsOfficial(broadcasterUserId);
                if (clips) return clips;
            } catch (error) {
                // 404 means the official /clips endpoint doesn't exist yet — expected, no need to warn
                if (error.response?.status !== 404) {
                    const detail = error.response
                        ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
                        : error.message;
                    logger.warn(`Kick: official clips fetch failed for ${slug}: ${detail}`);
                }
            }
        }
        return this.getClipsUnofficial(slug);
    }

    async getClipsOfficial(broadcasterUserId) {
        await this.ensureToken();
        const response = await axios.get(`${this.publicApiBase}/clips`, {
            params: { broadcaster_user_id: Number(broadcasterUserId), sort: 'date' },
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                Accept: 'application/json',
            },
            timeout: 10000,
        });
        // Normalize to match unofficial API shape: array of { id, clip_url, title, ... }
        const data = response.data?.data;
        if (!Array.isArray(data)) return null;
        return data.map(c => ({
            id: c.id ?? c.clip_id,
            clip_url: c.clip_url ?? c.url,
            title: c.title,
            thumbnail_url: c.thumbnail_url,
            ...c,
        }));
    }

    async getClipsUnofficial(slug) {
        try {
            const response = await axios.get(`${this.unofficialApiBase}/v2/channels/${encodeURIComponent(slug)}/clips`, {
                params: { sort: 'date', time: 'all' },
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    Referer: 'https://kick.com/',
                },
                timeout: 10000,
            });
            return response.data?.clips || [];
        } catch (error) {
            const detail = error.response
                ? `HTTP ${error.response.status}`
                : error.message;
            // 403 is a known issue (Kick blocks server-side requests to unofficial API)
            const level = error.response?.status === 403 ? 'warn' : 'error';
            logger[level](`Kick clips unavailable for ${slug} via unofficial API: ${detail}`);
            return [];
        }
    }

    // Official API: subscribe to livestream.status.updated event
    // Note: webhook URL is NOT sent per-request — it must be pre-registered in the
    // Kick developer portal under your app settings.
    async subscribeToLivestreamStatus(broadcasterId) {
        if (!this.hasCredentials) throw new Error('No Kick credentials configured');
        await this.ensureToken();

        const body = {
            event: 'livestream.status.updated',
            broadcaster_user_id: Number(broadcasterId),
        };
        logger.info(`Kick: subscribing to livestream.status.updated for broadcaster ${body.broadcaster_user_id}`);
        const response = await axios.post(
            `${this.publicApiBase}/events/subscriptions`,
            body,
            {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        return response.data;
    }

    // Official API: delete a subscription by ID
    async unsubscribeFromEvent(subscriptionId) {
        if (!this.hasCredentials) return;
        await this.ensureToken();

        await axios.delete(`${this.publicApiBase}/events/subscriptions`, {
            data: { subscription_id: subscriptionId },
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
            },
        });
    }

    // Official API: list all active subscriptions
    async getAllSubscriptions() {
        if (!this.hasCredentials) return [];
        await this.ensureToken();

        const response = await axios.get(`${this.publicApiBase}/events/subscriptions`, {
            headers: { Authorization: `Bearer ${this.accessToken}` },
        });
        return response.data?.data || [];
    }
}

module.exports = KickAPI;
