require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const Models = require('./database/models');
const TwitchAPI = require('./handlers/twitchAPI');
const KickAPI = require('./handlers/kickAPI');
const WebhookServer = require('./handlers/webhookServer');
const ClipPollingService = require('./services/clipPollingService');
const KickPollingService = require('./services/kickPollingService');

class TwitchDiscordBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
            ]
        });

        this.models = new Models();
        this.twitchAPI = new TwitchAPI(this.models);
        this.kickAPI = new KickAPI(this.models);
        this.kickAPI.onSyncAuthLost = (sync) => this.notifySyncAuthLost(sync);
        this.webhookServer = new WebhookServer(this.models, this.twitchAPI, this, this.kickAPI);

        // Initialize polling services (started after bot is ready)
        this.clipPollingService = null;
        this.kickPollingService = null;
        this.subscriptionHealthCheckInterval = null;

        this.client.commands = new Collection();
        this.client.twitchAPI = this.twitchAPI;
        this.client.kickAPI   = this.kickAPI;
        this.client.models    = this.models;
        this.client.notificationHandler = this.webhookServer?.notificationHandler || null;
        this.loadCommands();
        this.setupEventHandlers();
    }

    loadCommands() {
        const commandsPath = path.join(__dirname, 'commands');
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);

            if ('data' in command && 'execute' in command) {
                this.client.commands.set(command.data.name, command);
                logger.info(`Loaded command: ${command.data.name}`);
            } else {
                logger.warn(`Command at ${filePath} is missing required "data" or "execute" property`);
            }
        }
    }

    setupEventHandlers() {
        this.client.once('ready', async () => {
            logger.info(`Bot is ready! Logged in as ${this.client.user.tag}`);
            this.client.user.setActivity('Twitch streams', { type: 'WATCHING' });

            // Deploy commands on startup and restore them if another client deletes them
            await this.deployCommands();
            this.startCommandHealthCheck();

            // Refresh Kick sync tokens ahead of expiry; reports dead authorizations
            this.startKickTokenRefresh();

            // Clean up orphaned EventSub subscriptions
            await this.twitchAPI.cleanupOrphanedSubscriptions();

            // Periodically re-check EventSub health: Twitch can revoke subscriptions
            // mid-runtime (notification_failures_exceeded, authorization_revoked, etc.)
            // and without this the bot would silently stop delivering notifications
            // until the next restart.
            this.startSubscriptionHealthCheck();

            // Start Twitch clip polling service after bot is ready
            this.startClipPollingService();

            // Start Kick polling service after bot is ready
            this.startKickPollingService();
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                const command = this.client.commands.get(interaction.commandName);
                if (!command) {
                    logger.error(`No command matching ${interaction.commandName} was found.`);
                    return;
                }

                try {
                    await command.execute(interaction, this.models, this.twitchAPI);
                } catch (error) {
                    logger.error(`Error executing command ${interaction.commandName}:`, error);

                    const errorMessage = 'There was an error while executing this command!';
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: errorMessage, ephemeral: true });
                    } else {
                        await interaction.reply({ content: errorMessage, ephemeral: true });
                    }
                }
            } else if (interaction.isAutocomplete()) {
                const command = this.client.commands.get(interaction.commandName);
                if (!command || !command.autocomplete) return;

                try {
                    await command.autocomplete(interaction, this.models);
                } catch (error) {
                    logger.error(`Error in autocomplete for ${interaction.commandName}:`, error);
                }
            }
        });

        this.client.on('guildCreate', (guild) => {
            logger.info(`Joined guild ${guild.name} – deploying commands`);
            this.deployGuildCommands(guild);
        });

        this.client.on('error', (error) => {
            logger.error('Discord client error:', error);
        });

        this.client.on('warn', (warning) => {
            logger.warn('Discord client warning:', warning);
        });
    }

    startSubscriptionHealthCheck() {
        const intervalMs = parseInt(process.env.EVENTSUB_HEALTH_CHECK_INTERVAL_MS) || 60 * 60 * 1000;
        logger.info(`Scheduling EventSub health check every ${Math.round(intervalMs / 60000)} minutes`);

        this.subscriptionHealthCheckInterval = setInterval(async () => {
            try {
                logger.info('🔄 Running scheduled EventSub health check...');
                await this.twitchAPI.cleanupOrphanedSubscriptions();
            } catch (error) {
                logger.error('Scheduled EventSub health check failed:', error);
            }
        }, intervalMs);
    }

    startKickPollingService() {
        try {
            const NotificationHandler = require('./handlers/notificationHandler');
            const notificationHandler = new NotificationHandler(this.models, this.twitchAPI, this);

            this.kickPollingService = new KickPollingService(this.kickAPI, this.models, notificationHandler);
            this.kickPollingService.start();

            logger.info('Kick polling service started successfully');
        } catch (error) {
            logger.error('Failed to start Kick polling service:', error);
        }
    }

    commandsJSON() {
        return this.client.commands.map(command => command.data.toJSON());
    }

    // Commands are registered per guild only: instant availability, and no duplicate
    // entries that a global + guild copy of the same command would show.
    async deployCommands() {
        const commands = this.commandsJSON();
        logger.info(`🔄 Deploying ${commands.length} Discord commands to ${this.client.guilds.cache.size} guild(s)...`);

        try {
            await this.client.rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] });
        } catch (error) {
            logger.error('Failed to clear global Discord commands:', error.message);
        }

        for (const guild of this.client.guilds.cache.values()) {
            await this.deployGuildCommands(guild, commands);
        }
    }

    async deployGuildCommands(guild, commands = this.commandsJSON()) {
        try {
            await this.client.rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id),
                { body: commands }
            );
            logger.info(`  ✅ Deployed ${commands.length} commands to ${guild.name}`);
        } catch (error) {
            logger.error(`  ❌ Failed to deploy commands to ${guild.name}:`, error.message);
        }
    }

    /**
     * Re-deploy guild commands that disappeared. Another client logged in with the same
     * bot token can delete them – e.g. a nextcord bot with its default command rollout
     * removes every command it doesn't define (seen with the discord_game HA integration).
     */
    async ensureGuildCommands() {
        const commands = this.commandsJSON();
        const expected = commands.map(c => c.name).sort().join(',');

        for (const guild of this.client.guilds.cache.values()) {
            try {
                const registered = await this.client.rest.get(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guild.id)
                );
                if (registered.map(c => c.name).sort().join(',') !== expected) {
                    logger.warn(`Discord commands in ${guild.name} are missing or outdated (${registered.length}/${commands.length}) – re-deploying`);
                    await this.deployGuildCommands(guild, commands);
                }
            } catch (error) {
                logger.error(`Failed to check Discord commands in ${guild.name}:`, error.message);
            }
        }
    }

    startCommandHealthCheck() {
        this.commandHealthCheckInterval = setInterval(() => this.ensureGuildCommands(), 10 * 60 * 1000);
    }

    // Keep Kick sync refresh tokens in use and detect a dead authorization early.
    startKickTokenRefresh() {
        if (!this.kickAPI.hasCredentials) return;

        const run = () => this.kickAPI.refreshExpiringSyncTokens()
            .catch(error => logger.error('Kick token refresh check failed:', error));
        run();
        this.kickTokenRefreshInterval = setInterval(run, 30 * 60 * 1000);
    }

    /**
     * Kick rejected a sync pair's refresh token: tell the streamer in Discord (channel
     * where /sync add was run, else the channels following that Twitch streamer) and in
     * their Twitch chat how to re-authorize.
     */
    async notifySyncAuthLost(sync) {
        const fixCommand = `/sync add twitch:${sync.twitch_slug} kick:${sync.kick_slug}`;
        const pair = `${sync.twitch_slug} → ${sync.kick_slug}`;

        const channelIds = sync.discord_channel_id
            ? [sync.discord_channel_id]
            : [...new Set((await this.models.getAllFollowsForStreamer(sync.twitch_slug)).map(f => f.channel_id))];

        const mention = sync.discord_user_id ? `<@${sync.discord_user_id}> ` : '';
        const discordText = [
            `${mention}⚠️ **Twitch → Kick sync stopped: ${pair}**`,
            `Kick no longer accepts the bot's login for **${sync.kick_slug}** (it expired or was revoked), ` +
            'so stream title and category changes on Twitch are not copied to Kick anymore.',
            '',
            '**How to fix it:**',
            `1. Run \`${fixCommand}\` here in Discord (needs Administrator).`,
            '2. Click **Authorize on Kick** in the bot\'s reply.',
            `3. Log in with the Kick account **${sync.kick_slug}** and confirm. The bot then replies "Sync authorized" and syncing resumes.`,
            '',
            'The authorization link is valid for 10 minutes – if it expires, just run the command again.',
        ].join('\n');

        if (channelIds.length === 0) {
            logger.warn(`No Discord channel known for sync ${pair} – lost Kick authorization not reported in Discord`);
        }
        for (const channelId of channelIds) {
            try {
                const channel = await this.client.channels.fetch(channelId);
                await channel.send({
                    content: discordText,
                    allowedMentions: { users: sync.discord_user_id ? [sync.discord_user_id] : [] },
                });
                logger.info(`Reported lost Kick authorization for ${pair} in Discord channel ${channelId}`);
            } catch (error) {
                logger.error(`Failed to report lost Kick authorization in Discord channel ${channelId}:`, error.message);
            }
        }

        if (!sync.twitch_user_id) return;
        try {
            await this.twitchAPI.sendChatMessage(
                sync.twitch_user_id,
                `⚠️ Twitch → Kick title/category sync for kick.com/${sync.kick_slug} stopped: the Kick login expired. ` +
                `Fix: in Discord run ${fixCommand} and log in to Kick (account ${sync.kick_slug}) via the link the bot replies with.`
            );
            logger.info(`Reported lost Kick authorization for ${pair} in Twitch chat of ${sync.twitch_slug}`);
        } catch (error) {
            const detail = error.response ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}` : error.message;
            logger.warn(`Could not post to Twitch chat of ${sync.twitch_slug} (one-time authorization via /twitch-chat-auth needed?): ${detail}`);
        }
    }

    startClipPollingService() {
        try {
            // Create notification handler instance for clip polling
            const NotificationHandler = require('./handlers/notificationHandler');
            const notificationHandler = new NotificationHandler(this.models, this.twitchAPI, this);

            // Initialize and start clip polling service
            this.clipPollingService = new ClipPollingService(this.twitchAPI, this.models, notificationHandler);
            this.clipPollingService.start();

            logger.info('Clip polling service started successfully');
        } catch (error) {
            logger.error('Failed to start clip polling service:', error);
        }
    }

    async start() {
        try {
            // Ensure logs directory exists
            if (!fs.existsSync('logs')) {
                fs.mkdirSync('logs');
            }

            // Initialize Twitch API
            await this.twitchAPI.initialize();

            // Initialize Kick API (optional – gracefully degrades if no credentials)
            await this.kickAPI.initialize();

            // Start webhook server
            await this.webhookServer.start();

            // Login to Discord
            await this.client.login(process.env.DISCORD_TOKEN);

            logger.info('Bot started successfully');
        } catch (error) {
            logger.error('Failed to start bot:', error);
            process.exit(1);
        }
    }

    async shutdown() {
        logger.info('Shutting down bot...');

        try {
            // Stop periodic checks
            clearInterval(this.subscriptionHealthCheckInterval);
            clearInterval(this.commandHealthCheckInterval);
            clearInterval(this.kickTokenRefreshInterval);

            // Stop Twitch clip polling service
            if (this.clipPollingService) {
                this.clipPollingService.stop();
            }

            // Stop Kick polling service
            if (this.kickPollingService) {
                this.kickPollingService.stop();
            }

            // Close webhook server
            await this.webhookServer.stop();

            // Close database connection
            await this.models.close();

            // Destroy Discord client
            this.client.destroy();

            logger.info('Bot shutdown complete');
        } catch (error) {
            logger.error('Error during shutdown:', error);
        }
    }

    // Method to send notifications to Discord channels
    async sendNotification(channelId, embed, content = '') {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (channel) {
                const messageOptions = { embeds: [embed] };
                if (content) {
                    messageOptions.content = content;
                }
                const message = await channel.send(messageOptions);
                logger.info(`Notification sent to channel ${channelId}`);
                return message;
            }
        } catch (error) {
            logger.error(`Failed to send notification to channel ${channelId}:`, error);
        }
    }

    // Method to edit Discord messages
    async editMessage(channelId, messageId, newContent) {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (channel) {
                const message = await channel.messages.fetch(messageId);
                await message.edit(newContent);
                logger.info(`Message ${messageId} edited in channel ${channelId}`);
                return true;
            }
        } catch (error) {
            logger.error(`Failed to edit message ${messageId} in channel ${channelId}:`, error);
            return false;
        }
    }
}

// Handle graceful shutdown
const bot = new TwitchDiscordBot();

process.on('SIGINT', async () => {
    await bot.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await bot.shutdown();
    process.exit(0);
});

// Start the bot
bot.start();