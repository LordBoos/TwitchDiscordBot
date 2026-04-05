const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const NotificationHandler = require('./notificationHandler');

class WebhookServer {
    constructor(models, twitchAPI, discordBot, kickAPI = null) {
        this.models = models;
        this.twitchAPI = twitchAPI;
        this.discordBot = discordBot;
        this.kickAPI = kickAPI;
        this.app = express();
        this.server = null;
        this.port = process.env.WEBHOOK_PORT || 3000;
        this.secret = process.env.WEBHOOK_SECRET;

        this.notificationHandler = new NotificationHandler(models, twitchAPI, discordBot, kickAPI);

        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Raw body parsers for webhook verification (must come before express.json())
        this.app.use('/webhook', express.raw({ type: 'application/json' }));
        this.app.use('/kick-webhook', express.raw({ type: 'application/json' }));

        // JSON parser for other routes
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // Basic logging middleware
        this.app.use((req, res, next) => {
            logger.info(`${req.method} ${req.path} - ${req.ip}`);
            next();
        });
    }

    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        // Twitch EventSub webhook endpoint
        this.app.post('/webhook', (req, res) => {
            this.handleWebhook(req, res);
        });

        // Kick EventSub webhook endpoint (used when KICK_CLIENT_ID is configured)
        this.app.post('/kick-webhook', (req, res) => {
            this.handleKickWebhook(req, res);
        });

        // Kick OAuth callback endpoint (receives authorization code after user authorizes)
        this.app.get('/kick-auth/callback', (req, res) => {
            this.handleKickOAuthCallback(req, res);
        });

        // Catch-all for undefined routes
        this.app.use('*', (req, res) => {
            res.status(404).json({ error: 'Not found' });
        });
    }

    verifySignature(body, signature, messageId, timestamp) {
        if (!this.secret) {
            logger.warn('No webhook secret configured, skipping signature verification');
            return true;
        }

        if (!signature) {
            logger.warn('No signature provided in webhook request');
            return false;
        }

        // According to Twitch EventSub docs, signature is calculated from messageId + timestamp + body
        const message = messageId + timestamp + body.toString();

        const expectedSignature = crypto
            .createHmac('sha256', this.secret)
            .update(message)
            .digest('hex');

        const providedSignature = signature.replace('sha256=', '');

        // Debug logging
        logger.info(`Webhook signature verification:`);
        logger.info(`- Message ID: ${messageId}`);
        logger.info(`- Timestamp: ${timestamp}`);
        logger.info(`- Body length: ${body.length}`);
        logger.info(`- Expected: ${expectedSignature}`);
        logger.info(`- Provided: ${providedSignature}`);
        logger.info(`- Secret length: ${this.secret.length}`);

        try {
            return crypto.timingSafeEqual(
                Buffer.from(expectedSignature, 'hex'),
                Buffer.from(providedSignature, 'hex')
            );
        } catch (error) {
            logger.error('Error comparing signatures:', error.message);
            return false;
        }
    }

    async handleWebhook(req, res) {
        try {
            const signature = req.headers['twitch-eventsub-message-signature'];
            const messageId = req.headers['twitch-eventsub-message-id'];
            const messageType = req.headers['twitch-eventsub-message-type'];
            const timestamp = req.headers['twitch-eventsub-message-timestamp'];

            // Verify signature
            if (!this.verifySignature(req.body, signature, messageId, timestamp)) {
                logger.warn('Invalid webhook signature');
                return res.status(403).json({ error: 'Invalid signature' });
            }

            // Check timestamp to prevent replay attacks (within 10 minutes)
            const messageTime = new Date(timestamp);
            const now = new Date();
            const timeDiff = Math.abs(now - messageTime) / 1000; // seconds

            if (timeDiff > 600) { // 10 minutes
                logger.warn(`Webhook message too old: ${timeDiff}s`);
                return res.status(400).json({ error: 'Message too old' });
            }

            const body = JSON.parse(req.body.toString());

            // Handle different message types
            switch (messageType) {
                case 'webhook_callback_verification':
                    logger.info('Webhook verification challenge received');
                    return res.status(200).send(body.challenge);

                case 'notification':
                    await this.handleNotification(body);
                    return res.status(200).json({ status: 'ok' });

                case 'revocation':
                    await this.handleRevocation(body);
                    return res.status(200).json({ status: 'ok' });

                default:
                    logger.warn(`Unknown message type: ${messageType}`);
                    return res.status(400).json({ error: 'Unknown message type' });
            }

        } catch (error) {
            logger.error('Error handling webhook:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    async handleNotification(body) {
        const { subscription, event } = body;

        logger.info(`Received ${subscription.type} notification for ${event.broadcaster_user_name || event.broadcaster_user_login}`);

        if (subscription.type === 'stream.online') {
            await this.notificationHandler.handleStreamOnline(event);
        } else if (subscription.type === 'channel.clip.delete') {
            await this.notificationHandler.handleClipDeleted(event);
        } else if (subscription.type === 'channel.update') {
            await this.handleChannelUpdate(event);
        }
    }

    /**
     * Handle Twitch channel.update events — sync title and category to Kick.
     * Looks up all twitch_kick_sync pairs for this Twitch streamer and updates each Kick channel.
     */
    async handleChannelUpdate(event) {
        const twitchSlug = (event.broadcaster_user_login || '').toLowerCase();
        const newTitle = event.title;
        const newCategoryName = event.category_name;

        if (!twitchSlug) return;

        // Find all Kick channels synced to this Twitch channel
        const syncs = await this.models.getSyncsByTwitchSlug(twitchSlug);
        if (!syncs || syncs.length === 0) {
            logger.debug(`channel.update for ${twitchSlug}: no sync pairs configured`);
            return;
        }

        logger.info(`channel.update for ${twitchSlug}: title="${newTitle}", category="${newCategoryName}" — syncing to ${syncs.length} Kick channel(s)`);

        for (const sync of syncs) {
            if (!sync.kick_access_token) {
                logger.warn(`Sync ${twitchSlug}→${sync.kick_slug}: no Kick token, skipping`);
                continue;
            }

            // Get a valid token (refresh if needed)
            let token;
            try {
                token = await this.kickAPI.getSyncToken(sync);
            } catch (tokenErr) {
                logger.error(`Sync ${twitchSlug}→${sync.kick_slug}: token error — ${tokenErr.message}`);
                continue;
            }
            if (!token) {
                logger.warn(`Sync ${twitchSlug}→${sync.kick_slug}: token expired and refresh failed`);
                continue;
            }

            // Build the update payload
            const updates = {};

            // Always sync title
            if (newTitle) {
                updates.title = newTitle;
            }

            // Map Twitch category name to Kick category ID
            // Falls back to "Games + Demos" if the Twitch category doesn't exist on Kick
            if (newCategoryName) {
                try {
                    let kickCategory = await this.kickAPI.findCategoryByName(newCategoryName);
                    if (kickCategory) {
                        updates.category_id = kickCategory.id;
                        logger.info(`Sync ${twitchSlug}→${sync.kick_slug}: mapped category "${newCategoryName}" → Kick id ${kickCategory.id} ("${kickCategory.name}")`);
                    } else {
                        // Fall back to "Games + Demos" (id 242)
                        updates.category_id = 242;
                        logger.info(`Sync ${twitchSlug}→${sync.kick_slug}: category "${newCategoryName}" not found on Kick, using fallback "Games + Demos" (id 242)`);
                    }
                } catch (catErr) {
                    logger.warn(`Sync ${twitchSlug}→${sync.kick_slug}: category lookup error — ${catErr.message}`);
                }
            }

            if (Object.keys(updates).length === 0) {
                logger.debug(`Sync ${twitchSlug}→${sync.kick_slug}: nothing to update`);
                continue;
            }

            // Try the update — if combined title+category fails, retry with title only
            try {
                await this.kickAPI.updateChannel(token, updates);
                logger.info(`Sync ${twitchSlug}→${sync.kick_slug}: Kick channel updated — ${JSON.stringify(updates)}`);
            } catch (error) {
                const detail = error.response
                    ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
                    : error.message;
                logger.error(`Sync ${twitchSlug}→${sync.kick_slug}: failed to update Kick channel — ${detail}`);

                // Retry with title only if the combined request failed
                if (error.response?.status === 400 && updates.title && updates.category_id) {
                    try {
                        logger.info(`Sync ${twitchSlug}→${sync.kick_slug}: retrying with title only`);
                        await this.kickAPI.updateChannel(token, { title: updates.title });
                        logger.info(`Sync ${twitchSlug}→${sync.kick_slug}: title-only update succeeded`);
                    } catch (retryError) {
                        const retryDetail = retryError.response
                            ? `HTTP ${retryError.response.status}: ${JSON.stringify(retryError.response.data)}`
                            : retryError.message;
                        logger.error(`Sync ${twitchSlug}→${sync.kick_slug}: title-only retry also failed — ${retryDetail}`);
                    }
                }
            }
        }
    }

    async handleRevocation(body) {
        const { subscription } = body;

        logger.warn(`EventSub subscription revoked: ${subscription.id} (${subscription.status})`);

        // Remove from database if it exists
        try {
            const dbSubscription = await this.models.getEventSubSubscription(subscription.condition.broadcaster_user_id);
            if (dbSubscription && dbSubscription.subscription_id === subscription.id) {
                await this.models.removeEventSubSubscription(dbSubscription.streamer_name);
                logger.info(`Removed revoked subscription from database: ${dbSubscription.streamer_name}`);
            }
        } catch (error) {
            logger.error('Error handling subscription revocation:', error);
        }
    }

    async handleKickWebhook(req, res) {
        try {
            const messageId  = req.headers['kick-event-message-id'];
            const timestamp  = req.headers['kick-event-message-timestamp'];
            const eventType  = req.headers['kick-event-type'];
            const signatureB64 = req.headers['kick-event-signature'];

            // Verify RSA-SHA256 signature using Kick's public key
            if (this.kickAPI) {
                if (!this.kickAPI.verifyWebhookSignature(messageId, timestamp, req.body, signatureB64)) {
                    logger.warn('Invalid Kick webhook signature');
                    return res.status(403).json({ error: 'Invalid signature' });
                }
            } else {
                logger.warn('KickAPI not available – skipping Kick webhook signature verification');
            }

            // Reject stale messages (>10 minutes old)
            const messageTime = new Date(timestamp);
            const timeDiff = Math.abs(new Date() - messageTime) / 1000;
            if (timeDiff > 600) {
                logger.warn(`Kick webhook message too old: ${timeDiff}s`);
                return res.status(400).json({ error: 'Message too old' });
            }

            const body = JSON.parse(req.body.toString());
            logger.info(`Received Kick webhook event: ${eventType}`);

            if (eventType === 'livestream.status.updated') {
                const slug = body.broadcaster?.channel_slug;
                if (slug) {
                    if (body.is_live === true) {
                        logger.info(`Kick: ${slug} went live (via webhook)`);
                        // Sync polling state so polling doesn't re-fire this notification
                        await this.models.setKickStreamState(slug, true);

                        // Fetch full livestream data from API for rich notification.
                        // The API may not have the stream registered yet when the webhook fires,
                        // so we retry a few times with increasing delays.
                        let livestream = null;
                        if (this.kickAPI) {
                            const follow = await this.models.db.get(
                                'SELECT broadcaster_user_id FROM kick_channel_follows WHERE streamer_slug = ? AND broadcaster_user_id IS NOT NULL LIMIT 1',
                                [slug]
                            );
                            const broadcasterId = follow?.broadcaster_user_id || body.broadcaster?.user_id;

                            const delays = [5000, 5000, 10000]; // retry after 5s, 10s, 20s total
                            for (const delay of delays) {
                                await new Promise(resolve => setTimeout(resolve, delay));
                                livestream = await this.kickAPI.getLivestream(slug, broadcasterId);
                                if (livestream) {
                                    logger.info(`Kick: enriched livestream data for ${slug} (categories: ${livestream.categories?.map(c => c.name).join(', ') || 'none'}, subscribers: ${livestream.subscriber_count ?? 'unknown'})`);
                                    break;
                                }
                                logger.info(`Kick: stream data not available yet for ${slug}, retrying...`);
                            }
                        }

                        // Fall back to minimal webhook data if API fetch fails
                        if (!livestream) {
                            logger.warn(`Kick: API enrichment failed for ${slug}, using minimal webhook data`);
                            livestream = {
                                session_title: body.title || 'Live Stream',
                                is_live: true,
                                viewer_count: 0,
                                slug,
                                user: {
                                    username: body.broadcaster?.username || slug,
                                    profile_pic: body.broadcaster?.profile_picture || null,
                                },
                                categories: [],
                            };
                        }

                        // Wait for the stream thumbnail to be generated on Kick's CDN.
                        // The API returns the thumbnail URL immediately but the actual image may
                        // not be ready yet, causing Discord to skip it in the embed.
                        if (livestream.thumbnail) {
                            logger.info(`Kick: waiting 30s for stream thumbnail CDN to be ready for ${slug}...`);
                            await new Promise(resolve => setTimeout(resolve, 30000));
                        }

                        await this.notificationHandler.handleKickStreamOnline(slug, livestream);
                    } else {
                        logger.info(`Kick: ${slug} went offline (via webhook)`);
                        // Sync polling state so polling knows the stream ended
                        await this.models.setKickStreamState(slug, false);
                    }
                }
            }

            return res.status(200).json({ status: 'ok' });
        } catch (error) {
            logger.error('Error handling Kick webhook:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    async handleKickOAuthCallback(req, res) {
        try {
            const { code, state, error: oauthError, error_description } = req.query;

            if (oauthError) {
                logger.warn(`Kick OAuth error: ${oauthError} — ${error_description}`);
                return res.status(400).send(
                    `<html><body><h2>Authorization Failed</h2>` +
                    `<p>${error_description || oauthError}</p>` +
                    `<p>You can close this window and try again.</p></body></html>`
                );
            }

            if (!code || !state) {
                return res.status(400).send(
                    `<html><body><h2>Missing Parameters</h2>` +
                    `<p>No authorization code received.</p></body></html>`
                );
            }

            if (!this.kickAPI) {
                return res.status(500).send(
                    `<html><body><h2>Server Error</h2>` +
                    `<p>Kick API not configured.</p></body></html>`
                );
            }

            // Check if this is a sync-specific OAuth callback
            if (this.kickAPI.pendingSyncPKCE.has(state)) {
                return this.handleSyncOAuthCallback(code, state, res);
            }

            // Otherwise, handle as the general /kickauth flow
            await this.kickAPI.exchangeCodeForToken(code, state);

            logger.info('Kick OAuth callback: user token obtained successfully');

            // Now create webhook subscriptions for all existing follows
            await this.kickAPI.subscribeAllExistingFollows();

            return res.status(200).send(
                `<html><body style="font-family: system-ui; max-width: 500px; margin: 80px auto; text-align: center;">` +
                `<h2 style="color: #53FC18;">Kick Authorization Successful!</h2>` +
                `<p>Your bot can now receive instant webhook notifications for Kick streams.</p>` +
                `<p>You can close this window.</p></body></html>`
            );
        } catch (error) {
            logger.error('Kick OAuth callback error:', error.message);
            return res.status(500).send(
                `<html><body><h2>Authorization Failed</h2>` +
                `<p>${error.message}</p>` +
                `<p>Try again in Discord.</p></body></html>`
            );
        }
    }

    async handleSyncOAuthCallback(code, state, res) {
        try {
            const result = await this.kickAPI.exchangeSyncCodeForToken(code, state);

            logger.info(`Kick sync OAuth callback: token obtained for ${result.twitchSlug}→${result.kickSlug}`);

            // Update the original Discord message to show success
            if (result.interaction) {
                try {
                    await result.interaction.editReply(
                        `✅ **Sync authorized: ${result.twitchSlug} → ${result.kickSlug}**\n\n` +
                        'Title and category changes on Twitch will now be synced to Kick automatically.'
                    );
                } catch (discordError) {
                    logger.warn('Could not update Discord message after sync auth:', discordError.message);
                }
            }

            return res.status(200).send(
                `<html><body style="font-family: system-ui; max-width: 500px; margin: 80px auto; text-align: center;">` +
                `<h2 style="color: #53FC18;">Sync Authorization Successful!</h2>` +
                `<p>Twitch <strong>${result.twitchSlug}</strong> → Kick <strong>${result.kickSlug}</strong></p>` +
                `<p>Title and category changes on Twitch will now be synced to Kick automatically.</p>` +
                `<p>You can close this window.</p></body></html>`
            );
        } catch (error) {
            logger.error('Kick sync OAuth callback error:', error.message);
            return res.status(500).send(
                `<html><body><h2>Sync Authorization Failed</h2>` +
                `<p>${error.message}</p>` +
                `<p>Try again with <code>/sync add</code> in Discord.</p></body></html>`
            );
        }
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, (err) => {
                if (err) {
                    logger.error(`Failed to start webhook server: ${err.message}`);
                    reject(err);
                } else {
                    logger.info(`Webhook server listening on port ${this.port}`);
                    resolve();
                }
            });
        });
    }

    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    logger.info('Webhook server stopped');
                    resolve();
                });
            });
        }
    }
}

module.exports = WebhookServer;