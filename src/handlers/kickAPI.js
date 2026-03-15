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
        this.hasCredentials = !!(this.clientId && this.clientSecret);

        // App access token (client_credentials) — for public API calls
        this.accessToken = null;
        this.tokenExpiresAt = null;

        // User access token (authorization code + PKCE) — for event subscriptions
        this.userAccessToken = null;
        this.userRefreshToken = null;
        this.userTokenExpiresAt = null;
        this.hasUserToken = false;

        // Pending PKCE state for OAuth flow (in-memory, survives until bot restart)
        this.pendingPKCE = null;

        // RSA public key for webhook signature verification
        this.publicKey = null;

        // Derive redirect URI from WEBHOOK_URL or explicit env var
        const webhookBase = (process.env.WEBHOOK_URL || '').replace(/\/webhook\/?$/, '');
        this.redirectUri = process.env.KICK_REDIRECT_URI || (webhookBase ? `${webhookBase}/kick-auth/callback` : null);
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

            // Try to load a previously stored user token
            await this.loadUserToken();
        } else {
            logger.info('KickAPI initialized in polling-only mode (no KICK_CLIENT_ID/KICK_CLIENT_SECRET configured)');
        }
    }

    // =========================================================================
    // App access token (client_credentials) — for public API calls
    // =========================================================================

    async loadOrRefreshToken() {
        const stored = await this.models.getKickToken();
        if (stored) {
            const expiresAt = new Date(stored.expires_at);
            const now = new Date();
            // Use stored token if valid for more than 5 minutes
            if ((expiresAt - now) > 5 * 60 * 1000) {
                this.accessToken = stored.access_token;
                this.tokenExpiresAt = expiresAt;
                logger.info('Loaded Kick app access token from database');
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
        logger.info('Fetched new Kick app access token');
    }

    async ensureToken() {
        if (!this.accessToken || (this.tokenExpiresAt && (this.tokenExpiresAt - new Date()) < 5 * 60 * 1000)) {
            await this.fetchNewToken();
        }
    }

    // =========================================================================
    // User access token (OAuth Authorization Code + PKCE) — for subscriptions
    // =========================================================================

    /**
     * Generate PKCE parameters for the OAuth authorization code flow.
     * Returns { codeVerifier, codeChallenge, state }
     */
    generatePKCEParams() {
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto
            .createHash('sha256')
            .update(codeVerifier)
            .digest('base64url');
        const state = crypto.randomBytes(16).toString('hex');
        return { codeVerifier, codeChallenge, state };
    }

    /**
     * Generate the Kick OAuth authorization URL for the user to visit.
     * Stores PKCE state in memory for later code exchange.
     */
    getAuthorizationUrl(scopes = ['user:read', 'events:subscribe']) {
        if (!this.redirectUri) {
            throw new Error('No redirect URI configured. Set KICK_REDIRECT_URI or WEBHOOK_URL in .env');
        }

        const pkce = this.generatePKCEParams();
        this.pendingPKCE = {
            codeVerifier: pkce.codeVerifier,
            state: pkce.state,
            createdAt: Date.now(),
        };

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: scopes.join(' '),
            code_challenge: pkce.codeChallenge,
            code_challenge_method: 'S256',
            state: pkce.state,
        });

        return `${this.oauthUrl}/oauth/authorize?${params.toString()}`;
    }

    /**
     * Exchange an authorization code for user access + refresh tokens.
     * Called from the OAuth callback endpoint.
     */
    async exchangeCodeForToken(code, state) {
        if (!this.pendingPKCE) {
            throw new Error('No pending PKCE state. Run /kickauth first.');
        }
        if (this.pendingPKCE.state !== state) {
            throw new Error('OAuth state mismatch — possible CSRF attack.');
        }

        // Expire PKCE state after 10 minutes
        if (Date.now() - this.pendingPKCE.createdAt > 10 * 60 * 1000) {
            this.pendingPKCE = null;
            throw new Error('PKCE state expired. Run /kickauth again.');
        }

        const codeVerifier = this.pendingPKCE.codeVerifier;
        this.pendingPKCE = null; // Consume the PKCE state

        const response = await axios.post(
            `${this.oauthUrl}/oauth/token`,
            new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: this.clientId,
                client_secret: this.clientSecret,
                redirect_uri: this.redirectUri,
                code,
                code_verifier: codeVerifier,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_in, scope } = response.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        this.userAccessToken = access_token;
        this.userRefreshToken = refresh_token;
        this.userTokenExpiresAt = expiresAt;
        this.hasUserToken = true;

        await this.models.saveKickUserToken(access_token, refresh_token, expiresAt, scope || null);
        logger.info('Kick user access token obtained and stored');

        return { access_token, refresh_token, expires_in, scope };
    }

    /**
     * Load a previously stored user token from the database.
     */
    async loadUserToken() {
        try {
            const stored = await this.models.getKickUserToken();
            if (!stored) return;

            const expiresAt = new Date(stored.expires_at);
            const now = new Date();

            if ((expiresAt - now) > 5 * 60 * 1000) {
                // Token still valid
                this.userAccessToken = stored.access_token;
                this.userRefreshToken = stored.refresh_token;
                this.userTokenExpiresAt = expiresAt;
                this.hasUserToken = true;
                logger.info('Loaded Kick user access token from database');
            } else if (stored.refresh_token) {
                // Token expired but we have a refresh token — try refreshing
                logger.info('Kick user token expired, attempting refresh...');
                await this.refreshUserToken(stored.refresh_token);
            } else {
                logger.warn('Kick user token expired and no refresh token available. Run /kickauth to re-authorize.');
            }
        } catch (error) {
            logger.warn('Could not load Kick user token:', error.message);
        }
    }

    /**
     * Refresh the user access token using the refresh token.
     */
    async refreshUserToken(refreshToken = null) {
        const token = refreshToken || this.userRefreshToken;
        if (!token) {
            this.hasUserToken = false;
            throw new Error('No refresh token available. Run /kickauth to re-authorize.');
        }

        try {
            const response = await axios.post(
                `${this.oauthUrl}/oauth/token`,
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    refresh_token: token,
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const { access_token, refresh_token, expires_in, scope } = response.data;
            const expiresAt = new Date(Date.now() + expires_in * 1000);

            this.userAccessToken = access_token;
            this.userRefreshToken = refresh_token || token; // Some providers don't rotate refresh tokens
            this.userTokenExpiresAt = expiresAt;
            this.hasUserToken = true;

            await this.models.saveKickUserToken(this.userAccessToken, this.userRefreshToken, expiresAt, scope || null);
            logger.info('Kick user access token refreshed');
        } catch (error) {
            logger.error('Failed to refresh Kick user token:', error.message);
            this.hasUserToken = false;
            // Don't delete stored token — the refresh token might still work later
            throw error;
        }
    }

    /**
     * Ensure we have a valid user access token. Auto-refreshes if near expiry.
     */
    async ensureUserToken() {
        if (!this.userAccessToken) {
            throw new Error('No Kick user token. Run /kickauth to authorize.');
        }

        if (this.userTokenExpiresAt && (this.userTokenExpiresAt - new Date()) < 5 * 60 * 1000) {
            await this.refreshUserToken();
        }
    }

    // =========================================================================
    // Webhook signature verification
    // =========================================================================

    async fetchPublicKey() {
        try {
            const response = await axios.get(`${this.publicApiBase}/public-key`, { timeout: 10000 });
            // API returns { data: { public_key: "-----BEGIN PUBLIC KEY-----\n...", algorithm: "RS256" } }
            this.publicKey = response.data?.data?.public_key || response.data?.public_key || response.data;
            logger.info('Fetched Kick RSA public key for webhook verification');
        } catch (error) {
            logger.warn('Could not fetch Kick public key (webhook signatures unverified):', error.message);
        }
    }

    // Verify RSA-SHA256 webhook signature from Kick (PKCS1v15 with SHA-256)
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
            // Signature payload: messageId.timestamp.rawBody (per Kick docs)
            const message = `${messageId}.${timestamp}.${rawBody.toString()}`;
            const signature = Buffer.from(signatureB64, 'base64');
            const key = typeof this.publicKey === 'string' ? this.publicKey : JSON.stringify(this.publicKey);
            return crypto.verify('sha256', Buffer.from(message), { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
        } catch (error) {
            logger.error('Kick webhook signature verification error:', error.message);
            return false;
        }
    }

    // =========================================================================
    // Channel lookups (use app token)
    // =========================================================================

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
                profile_pic: data.user?.profile_pic || null,
            },
            livestream: data.livestream || null,
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

    // Returns follower count for a channel via the unofficial API.
    // The official API does not expose follower count.
    async getFollowerCount(slug) {
        try {
            const channel = await this.getChannelBySlugUnofficial(slug);
            return channel?.followers_count ?? channel?.followersCount ?? null;
        } catch {
            return null;
        }
    }

    // =========================================================================
    // Livestream status (use app token)
    // =========================================================================

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
            thumbnail: data.thumbnail || null,
            user: {
                username: slug,
                profile_pic: null,
            },
            channel_id: data.channel_id,
            broadcaster_user_id: data.broadcaster_user_id,
        };
    }

    // =========================================================================
    // Clips (use app token)
    // =========================================================================

    // Get recent clips for a channel.
    // Tries the official API first (if/when a clips endpoint exists), then falls
    // back to the unofficial website API.
    async getRecentClips(slug, broadcasterUserId = null) {
        // Try official API if we have credentials and a broadcaster ID
        if (this.hasCredentials && broadcasterUserId) {
            const officialClips = await this.getClipsOfficial(slug, broadcasterUserId);
            if (officialClips && officialClips.length > 0) return officialClips;
        }

        // Fall back to unofficial website API
        return this.getClipsUnofficial(slug);
    }

    async getClipsOfficial(slug, broadcasterUserId) {
        let token;
        if (this.hasUserToken) {
            await this.ensureUserToken();
            token = this.userAccessToken;
        } else {
            await this.ensureToken();
            token = this.accessToken;
        }

        try {
            const response = await axios.get(`${this.publicApiBase}/clips`, {
                params: { broadcaster_user_id: Number(broadcasterUserId), sort: 'date' },
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json',
                },
                timeout: 10000,
            });
            const data = response.data?.data;
            if (!Array.isArray(data) || data.length === 0) return [];
            return data.map(c => ({
                id: c.id ?? c.clip_id,
                clip_url: c.clip_url ?? c.url,
                title: c.title,
                thumbnail_url: c.thumbnail_url,
                created_at: c.created_at,
                ...c,
            }));
        } catch (error) {
            // 404 means the clips endpoint doesn't exist yet — expected, fall through silently
            if (error.response?.status === 404) return [];
            const detail = error.response
                ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
                : error.message;
            logger.warn(`Kick: official clips fetch failed for ${slug}: ${detail}`);
            return [];
        }
    }

    async getClipsUnofficial(slug) {
        try {
            const response = await axios.get(`${this.unofficialApiBase}/v2/channels/${encodeURIComponent(slug)}/clips`, {
                params: { sort: 'date', time: 'all' },
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    Referer: 'https://kick.com/',
                    Origin: 'https://kick.com',
                },
                timeout: 10000,
            });
            const clips = response.data?.clips || [];
            // Normalize to consistent shape
            return clips.map(c => ({
                id: c.id ?? c.clip_id,
                clip_url: c.clip_url || c.url || `https://kick.com/${slug}?clip=${c.id}`,
                title: c.title,
                thumbnail_url: c.thumbnail_url || c.thumbnail,
                created_at: c.created_at,
                creator: c.creator,
                ...c,
            }));
        } catch (error) {
            const status = error.response?.status;
            // 403 is common (Kick blocks some server IPs) — log at debug to reduce noise
            const level = status === 403 ? 'debug' : 'warn';
            const detail = error.response ? `HTTP ${status}` : error.message;
            logger[level](`Kick: unofficial clips unavailable for ${slug}: ${detail}`);
            return [];
        }
    }

    // =========================================================================
    // Event subscriptions (use USER token — requires events:subscribe scope)
    // =========================================================================

    // Official API: subscribe to livestream status events.
    // IMPORTANT: Before this will work, you must enable webhooks in the Kick
    // developer portal (https://kick.com/settings/developer) — edit your app,
    // toggle "Enable Webhooks" ON, and enter your webhook URL (e.g.
    // https://your-domain.com/kick-webhook). Without this, the API returns 400.
    //
    // The correct request format (confirmed from Kick Go/C#/Java SDKs) uses an
    // "events" array with { name, version } objects, plus "method": "webhook".
    // The broadcaster is derived from the authenticated user token — it is NOT
    // passed in the request body.
    async subscribeToLivestreamStatus(broadcasterId) {
        if (!this.hasCredentials) throw new Error('No Kick credentials configured');
        if (!this.hasUserToken) throw new Error('No Kick user token. Run /kickauth to authorize.');

        await this.ensureUserToken();

        const headers = {
            Authorization: `Bearer ${this.userAccessToken}`,
            'Content-Type': 'application/json',
        };
        const endpoint = `${this.publicApiBase}/events/subscriptions`;

        const body = {
            events: [
                { name: 'livestream.status.updated', version: 1 },
            ],
            method: 'webhook',
        };

        logger.info(`Kick: subscribing to livestream.status.updated for broadcaster ${broadcasterId}`);
        const response = await axios.post(endpoint, body, { headers });
        logger.info(`Kick: subscription created: ${JSON.stringify(response.data)}`);
        return response.data;
    }

    // Official API: delete a subscription by ID
    async unsubscribeFromEvent(subscriptionId) {
        if (!this.hasCredentials) return;

        // Use user token if available, fall back to app token
        const token = this.hasUserToken ? this.userAccessToken : this.accessToken;
        if (this.hasUserToken) await this.ensureUserToken();
        else await this.ensureToken();

        await axios.delete(`${this.publicApiBase}/events/subscriptions`, {
            data: { id: [subscriptionId] },
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
    }

    // Official API: list all active subscriptions
    async getAllSubscriptions() {
        if (!this.hasCredentials) return [];

        // Use user token if available, fall back to app token
        const token = this.hasUserToken ? this.userAccessToken : this.accessToken;
        if (this.hasUserToken) await this.ensureUserToken();
        else await this.ensureToken();

        const response = await axios.get(`${this.publicApiBase}/events/subscriptions`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return response.data?.data || [];
    }

    /**
     * After obtaining a user token, subscribe to livestream events for all
     * currently followed Kick streamers that don't already have a subscription.
     */
    async subscribeAllExistingFollows() {
        if (!this.hasUserToken) return;

        try {
            const follows = await this.models.getAllKickChannelFollows();
            // Deduplicate by slug
            const slugMap = new Map();
            for (const f of follows) {
                if (f.broadcaster_user_id && !slugMap.has(f.streamer_slug)) {
                    slugMap.set(f.streamer_slug, f.broadcaster_user_id);
                }
            }

            let created = 0;
            for (const [slug, broadcasterId] of slugMap) {
                const existingSub = await this.models.getKickEventSubSubscription(slug);
                if (existingSub) continue;

                try {
                    const sub = await this.subscribeToLivestreamStatus(broadcasterId);
                    const subId = sub?.data?.subscription_id ?? sub?.data?.id ?? sub?.id;
                    if (subId) {
                        await this.models.addKickEventSubSubscription(subId, slug, broadcasterId);
                        created++;
                        logger.info(`Kick: created subscription for ${slug} (id: ${subId})`);
                    }
                } catch (error) {
                    const detail = error.response
                        ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
                        : error.message;
                    logger.warn(`Kick: failed to subscribe for ${slug}: ${detail}`);
                }
            }

            if (created > 0) {
                logger.info(`Kick: created ${created} webhook subscription(s) for existing follows`);
            }
        } catch (error) {
            logger.error('Kick: error subscribing existing follows:', error.message);
        }
    }
}

module.exports = KickAPI;
