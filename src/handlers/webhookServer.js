const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const NotificationHandler = require('./notificationHandler');

class WebhookServer {
    constructor(models, twitchAPI, discordBot) {
        this.models = models;
        this.twitchAPI = twitchAPI;
        this.discordBot = discordBot;
        this.app = express();
        this.server = null;
        this.port = process.env.WEBHOOK_PORT || 3000;
        this.secret = process.env.WEBHOOK_SECRET;

        this.notificationHandler = new NotificationHandler(models, twitchAPI, discordBot);

        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        // Raw body parser for webhook verification
        this.app.use('/webhook', express.raw({ type: 'application/json' }));

        // JSON parser for other routes
        this.app.use(express.json());

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

        // Main webhook endpoint
        this.app.post('/webhook', (req, res) => {
            this.handleWebhook(req, res);
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