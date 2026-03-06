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
            logger.warn('No Kick public key available, skipping signature verification');
            return true;
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
        // Try both known parameter names; Kick API docs have used both at different times
        const response = await axios.get(`${this.publicApiBase}/channels`, {
            params: { broadcaster_user_login: slug },
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                Accept: 'application/json',
            },
            timeout: 10000,
        });
        logger.debug(`KickAPI official /channels response for ${slug}:`, JSON.stringify(response.data).slice(0, 300));
        const data = response.data?.data?.[0];
        if (!data) return null;
        // Normalize to match shape expected by callers
        return {
            id: data.broadcaster_user_id,
            slug: data.broadcaster_user_login,
            user: {
                id: data.broadcaster_user_id,
                username: data.broadcaster_user_name,
            },
            livestream: null, // official channel endpoint doesn't return livestream info
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

    // Returns current livestream object if the channel is live, null otherwise
    async getLivestream(slug) {
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
    }

    // Unofficial API: get recent clips for a channel
    async getRecentClips(slug) {
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
            logger.error(`Error fetching Kick clips for ${slug}:`, error.message);
            return [];
        }
    }

    // Official API: subscribe to livestream.status.updated event
    async subscribeToLivestreamStatus(broadcasterId) {
        if (!this.hasCredentials) throw new Error('No Kick credentials configured');
        await this.ensureToken();

        const webhookUrl = process.env.KICK_WEBHOOK_URL ||
            (process.env.WEBHOOK_URL ? `${process.env.WEBHOOK_URL}/kick-webhook` : null);

        if (!webhookUrl) throw new Error('No KICK_WEBHOOK_URL or WEBHOOK_URL configured');

        const response = await axios.post(
            `${this.publicApiBase}/events/subscriptions`,
            {
                event: 'livestream.status.updated',
                broadcaster_user_id: broadcasterId,
                webhook_url: webhookUrl,
            },
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
            params: { id: subscriptionId },
            headers: { Authorization: `Bearer ${this.accessToken}` },
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
