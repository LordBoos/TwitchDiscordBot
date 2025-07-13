const axios = require('axios');
const logger = require('../utils/logger');

class TwitchAPI {
    constructor(models) {
        this.models = models;
        this.clientId = process.env.TWITCH_CLIENT_ID;
        this.clientSecret = process.env.TWITCH_CLIENT_SECRET;
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;

        this.baseURL = 'https://api.twitch.tv/helix';
        this.authURL = 'https://id.twitch.tv/oauth2';
    }

    async initialize() {
        logger.info('Initializing Twitch API...');

        // Try to load existing token from database
        const tokenData = await this.models.getToken();
        if (tokenData) {
            this.accessToken = tokenData.access_token;
            this.refreshToken = tokenData.refresh_token;
            this.tokenExpiresAt = new Date(tokenData.expires_at);

            // Check if token is expired
            if (new Date() >= this.tokenExpiresAt) {
                logger.info('Stored token is expired, refreshing...');
                await this.refreshAccessToken();
            } else {
                logger.info('Using stored access token');
            }
        } else {
            // Get new token using client credentials flow
            await this.getClientCredentialsToken();
        }
    }

    async getClientCredentialsToken() {
        try {
            const response = await axios.post(`${this.authURL}/token`, null, {
                params: {
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    grant_type: 'client_credentials'
                }
            });

            const { access_token, expires_in } = response.data;
            this.accessToken = access_token;
            this.tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

            // Save token to database
            await this.models.saveToken(
                this.accessToken,
                null, // No refresh token for client credentials
                this.tokenExpiresAt.toISOString()
            );

            logger.info('Successfully obtained Twitch access token');
        } catch (error) {
            logger.error('Failed to get Twitch access token:', error.response?.data || error.message);
            throw error;
        }
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            logger.info('No refresh token available, getting new client credentials token');
            return await this.getClientCredentialsToken();
        }

        try {
            const response = await axios.post(`${this.authURL}/token`, null, {
                params: {
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken
                }
            });

            const { access_token, refresh_token, expires_in } = response.data;
            this.accessToken = access_token;
            this.refreshToken = refresh_token || this.refreshToken;
            this.tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

            // Save updated token to database
            await this.models.saveToken(
                this.accessToken,
                this.refreshToken,
                this.tokenExpiresAt.toISOString()
            );

            logger.info('Successfully refreshed Twitch access token');
        } catch (error) {
            logger.error('Failed to refresh Twitch access token:', error.response?.data || error.message);
            // Fall back to client credentials
            await this.getClientCredentialsToken();
        }
    }

    async makeAPIRequest(endpoint, params = {}) {
        // Check if token needs refresh
        if (new Date() >= this.tokenExpiresAt) {
            await this.refreshAccessToken();
        }

        try {
            const response = await axios.get(`${this.baseURL}${endpoint}`, {
                headers: {
                    'Client-ID': this.clientId,
                    'Authorization': `Bearer ${this.accessToken}`
                },
                params
            });

            return response.data;
        } catch (error) {
            if (error.response?.status === 401) {
                // Token might be invalid, try refreshing
                logger.warn('API request failed with 401, refreshing token...');
                await this.refreshAccessToken();

                // Retry the request
                const response = await axios.get(`${this.baseURL}${endpoint}`, {
                    headers: {
                        'Client-ID': this.clientId,
                        'Authorization': `Bearer ${this.accessToken}`
                    },
                    params
                });

                return response.data;
            }

            throw error;
        }
    }

    // Get user information by username
    async getUserByName(username) {
        try {
            const data = await this.makeAPIRequest('/users', { login: username.toLowerCase() });
            return data.data[0] || null;
        } catch (error) {
            logger.error(`Failed to get user ${username}:`, error.response?.data || error.message);
            return null;
        }
    }

    // Get user information by ID
    async getUserById(userId) {
        try {
            const data = await this.makeAPIRequest('/users', { id: userId });
            return data.data[0] || null;
        } catch (error) {
            logger.error(`Failed to get user by ID ${userId}:`, error.response?.data || error.message);
            return null;
        }
    }

    // Get stream information
    async getStreamByUserId(userId) {
        try {
            const data = await this.makeAPIRequest('/streams', { user_id: userId });
            return data.data[0] || null;
        } catch (error) {
            logger.error(`Failed to get stream for user ${userId}:`, error.response?.data || error.message);
            return null;
        }
    }

    // Get game information
    async getGameById(gameId) {
        try {
            const data = await this.makeAPIRequest('/games', { id: gameId });
            return data.data[0] || null;
        } catch (error) {
            logger.error(`Failed to get game ${gameId}:`, error.response?.data || error.message);
            return null;
        }
    }

    // Get follower count for a user
    async getFollowerCount(userId) {
        try {
            const data = await this.makeAPIRequest('/channels/followers', { broadcaster_id: userId });
            return data.total || 0;
        } catch (error) {
            logger.error(`Failed to get follower count for user ${userId}:`, error.response?.data || error.message);
            return 0;
        }
    }

    // EventSub subscription management
    async createEventSubSubscription(type, condition, transport) {
        try {
            const response = await axios.post(`${this.baseURL}/eventsub/subscriptions`, {
                type,
                version: '1',
                condition,
                transport
            }, {
                headers: {
                    'Client-ID': this.clientId,
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.data[0];
        } catch (error) {
            logger.error('Failed to create EventSub subscription:', error.response?.data || error.message);
            throw error;
        }
    }

    async deleteEventSubSubscription(subscriptionId) {
        try {
            await axios.delete(`${this.baseURL}/eventsub/subscriptions`, {
                headers: {
                    'Client-ID': this.clientId,
                    'Authorization': `Bearer ${this.accessToken}`
                },
                params: { id: subscriptionId }
            });

            logger.info(`Deleted EventSub subscription: ${subscriptionId}`);
        } catch (error) {
            logger.error(`Failed to delete EventSub subscription ${subscriptionId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async getAllEventSubSubscriptions() {
        try {
            const response = await axios.get(`${this.baseURL}/eventsub/subscriptions`, {
                headers: {
                    'Client-ID': this.clientId,
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            return response.data.data || [];
        } catch (error) {
            logger.error('Failed to get EventSub subscriptions:', error.response?.data || error.message);
            throw error;
        }
    }

    async findExistingSubscription(userId, type) {
        try {
            const subscriptions = await this.getAllEventSubSubscriptions();

            // Find subscription matching our criteria
            const existingSub = subscriptions.find(sub =>
                sub.type === type &&
                sub.condition.broadcaster_user_id === userId &&
                sub.transport.callback === process.env.WEBHOOK_URL &&
                sub.status === 'enabled'
            );

            return existingSub || null;
        } catch (error) {
            logger.error(`Failed to find existing subscription for user ${userId}:`, error);
            return null;
        }
    }

    async cleanupOrphanedSubscriptions() {
        try {
            logger.info('🧹 Cleaning up orphaned EventSub subscriptions...');

            // Get all subscriptions from Twitch
            const twitchSubscriptions = await this.getAllEventSubSubscriptions();

            // Filter subscriptions that belong to this bot (same webhook URL)
            const ourSubscriptions = twitchSubscriptions.filter(sub =>
                sub.transport.callback === process.env.WEBHOOK_URL
            );

            // Get all subscriptions from our database
            const dbSubscriptions = await this.models.getAllEventSubSubscriptions();

            let cleanedCount = 0;
            let syncedCount = 0;

            // Check for subscriptions on Twitch that aren't in our database
            for (const twitchSub of ourSubscriptions) {
                const dbSub = dbSubscriptions.find(db => db.subscription_id === twitchSub.id);

                if (!dbSub) {
                    // This subscription exists on Twitch but not in our database
                    if (twitchSub.type === 'stream.online') {
                        // Try to determine the streamer name from the user ID
                        try {
                            const user = await this.getUserById(twitchSub.condition.broadcaster_user_id);
                            if (user) {
                                // Check if we actually need this subscription
                                const follows = await this.models.getAllFollowsForStreamer(user.login);
                                if (follows.length > 0) {
                                    // We need this subscription, sync it to database
                                    await this.models.addEventSubSubscription(
                                        twitchSub.id,
                                        user.login,
                                        twitchSub.condition.broadcaster_user_id
                                    );
                                    logger.info(`✅ Synced existing subscription for ${user.login}`);
                                    syncedCount++;
                                } else {
                                    // We don't need this subscription, delete it
                                    await this.deleteEventSubSubscription(twitchSub.id);
                                    logger.info(`🗑️ Deleted orphaned subscription for ${user.login}`);
                                    cleanedCount++;
                                }
                            }
                        } catch (error) {
                            logger.warn(`Could not process subscription ${twitchSub.id}:`, error.message);
                        }
                    }
                }
            }

            // Check for subscriptions in our database that don't exist on Twitch
            for (const dbSub of dbSubscriptions) {
                const twitchSub = twitchSubscriptions.find(t => t.id === dbSub.subscription_id);

                if (!twitchSub) {
                    // This subscription is in our database but not on Twitch
                    await this.models.removeEventSubSubscription(dbSub.streamer_name);
                    logger.info(`🗑️ Removed stale database entry for ${dbSub.streamer_name}`);
                    cleanedCount++;
                }
            }

            logger.info(`✅ Cleanup complete: ${syncedCount} synced, ${cleanedCount} cleaned`);

        } catch (error) {
            logger.error('Failed to cleanup orphaned subscriptions:', error);
        }
    }

    async subscribeToStreamOnline(userId, streamerName) {
        const existingSubscription = await this.models.getEventSubSubscription(streamerName);
        if (existingSubscription) {
            logger.info(`EventSub subscription already exists for ${streamerName}`);
            return existingSubscription;
        }

        try {
            const subscription = await this.createEventSubSubscription(
                'stream.online',
                { broadcaster_user_id: userId },
                {
                    method: 'webhook',
                    callback: process.env.WEBHOOK_URL,
                    secret: process.env.WEBHOOK_SECRET
                }
            );

            // Save subscription to database
            await this.models.addEventSubSubscription(
                subscription.id,
                streamerName,
                userId
            );

            logger.info(`Created EventSub subscription for ${streamerName}: ${subscription.id}`);
            return subscription;
        } catch (error) {
            // Handle 409 Conflict - subscription already exists on Twitch
            if (error.response?.status === 409) {
                logger.warn(`EventSub subscription already exists on Twitch for ${streamerName}, attempting to find and sync...`);

                try {
                    // Try to find the existing subscription on Twitch
                    const existingTwitchSub = await this.findExistingSubscription(userId, 'stream.online');
                    if (existingTwitchSub) {
                        // Save the existing subscription to our database
                        await this.models.addEventSubSubscription(
                            existingTwitchSub.id,
                            streamerName,
                            userId
                        );
                        logger.info(`Synced existing EventSub subscription for ${streamerName}: ${existingTwitchSub.id}`);
                        return existingTwitchSub;
                    }
                } catch (syncError) {
                    logger.error(`Failed to sync existing subscription for ${streamerName}:`, syncError);
                }

                // If we can't sync, just log and continue - the subscription exists on Twitch
                logger.warn(`Continuing without local subscription record for ${streamerName} - notifications may still work`);
                return null;
            }

            logger.error(`Failed to subscribe to stream.online for ${streamerName}:`, error);
            throw error;
        }
    }

    async unsubscribeFromStreamOnline(streamerName) {
        const subscription = await this.models.getEventSubSubscription(streamerName);
        if (!subscription) {
            logger.info(`No EventSub subscription found for ${streamerName}`);
            return;
        }

        try {
            await this.deleteEventSubSubscription(subscription.subscription_id);
            await this.models.removeEventSubSubscription(streamerName);

            logger.info(`Removed EventSub subscription for ${streamerName}`);
        } catch (error) {
            logger.error(`Failed to unsubscribe from stream.online for ${streamerName}:`, error);
            throw error;
        }
    }

    async getClips(userId, startedAt = null, endedAt = null, first = 20) {
        try {
            const params = {
                broadcaster_id: userId,
                first: first
            };

            if (startedAt) {
                params.started_at = startedAt;
            }
            if (endedAt) {
                params.ended_at = endedAt;
            }

            const response = await this.makeAPIRequest('/clips', params);
            return response.data;
        } catch (error) {
            logger.error(`Failed to get clips for user ${userId}:`, error);
            throw error;
        }
    }

    async getRecentClips(userId, minutes = 60) {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - (minutes * 60 * 1000));

        return await this.getClips(
            userId,
            startTime.toISOString(),
            endTime.toISOString(),
            20
        );
    }

    async getClipById(clipId) {
        try {
            const response = await this.makeAPIRequest('/clips', { id: clipId });
            return response.data[0] || null;
        } catch (error) {
            logger.error(`Failed to get clip ${clipId}:`, error);
            return null;
        }
    }

    async subscribeToClipDeletion(userId, streamerName) {
        // Check if we already have a subscription for this streamer
        const existingSubscription = await this.models.getEventSubSubscription(`${streamerName}_clip_delete`);
        if (existingSubscription) {
            logger.info(`EventSub clip deletion subscription already exists for ${streamerName}`);
            return existingSubscription;
        }

        try {
            const subscription = await this.createEventSubSubscription(
                'channel.clip.delete',
                { broadcaster_user_id: userId },
                {
                    method: 'webhook',
                    callback: process.env.WEBHOOK_URL,
                    secret: process.env.WEBHOOK_SECRET
                }
            );

            // Save subscription to database with a unique identifier for clip deletion
            await this.models.addEventSubSubscription(
                subscription.id,
                `${streamerName}_clip_delete`,
                userId
            );

            logger.info(`Created EventSub clip deletion subscription for ${streamerName}: ${subscription.id}`);
            return subscription;
        } catch (error) {
            // Handle 409 Conflict - subscription already exists on Twitch
            if (error.response?.status === 409) {
                logger.warn(`EventSub clip deletion subscription already exists on Twitch for ${streamerName}, attempting to find and sync...`);

                try {
                    // Try to find the existing subscription on Twitch
                    const existingTwitchSub = await this.findExistingSubscription(userId, 'channel.clip.delete');
                    if (existingTwitchSub) {
                        // Save the existing subscription to our database
                        await this.models.addEventSubSubscription(
                            existingTwitchSub.id,
                            `${streamerName}_clip_delete`,
                            userId
                        );
                        logger.info(`Synced existing EventSub clip deletion subscription for ${streamerName}: ${existingTwitchSub.id}`);
                        return existingTwitchSub;
                    }
                } catch (syncError) {
                    logger.error(`Failed to sync existing clip deletion subscription for ${streamerName}:`, syncError);
                }

                // If we can't sync, just log and continue
                logger.warn(`Continuing without local clip deletion subscription record for ${streamerName}`);
                return null;
            }

            logger.error(`Failed to subscribe to clip deletion for ${streamerName}:`, error);
            throw error;
        }
    }

    async unsubscribeFromClipDeletion(streamerName) {
        const subscription = await this.models.getEventSubSubscription(`${streamerName}_clip_delete`);
        if (!subscription) {
            logger.info(`No EventSub clip deletion subscription found for ${streamerName}`);
            return;
        }

        try {
            await this.deleteEventSubSubscription(subscription.subscription_id);
            await this.models.removeEventSubSubscription(`${streamerName}_clip_delete`);

            logger.info(`Removed EventSub clip deletion subscription for ${streamerName}`);
        } catch (error) {
            logger.error(`Failed to unsubscribe from clip deletion for ${streamerName}:`, error);
            throw error;
        }
    }
}

module.exports = TwitchAPI;