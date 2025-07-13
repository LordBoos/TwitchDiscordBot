require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const Models = require('./database/models');
const TwitchAPI = require('./handlers/twitchAPI');
const WebhookServer = require('./handlers/webhookServer');
const ClipPollingService = require('./services/clipPollingService');

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
        this.webhookServer = new WebhookServer(this.models, this.twitchAPI, this);

        // Initialize clip polling service (will be started after bot is ready)
        this.clipPollingService = null;

        this.client.commands = new Collection();
        this.client.twitchAPI = this.twitchAPI; // Make TwitchAPI available to commands
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

            // Deploy commands on startup
            await this.deployCommands();

            // Clean up orphaned EventSub subscriptions
            await this.twitchAPI.cleanupOrphanedSubscriptions();

            // Start clip polling service after bot is ready
            this.startClipPollingService();
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

        this.client.on('error', (error) => {
            logger.error('Discord client error:', error);
        });

        this.client.on('warn', (warning) => {
            logger.warn('Discord client warning:', warning);
        });
    }

    async deployCommands() {
        try {
            logger.info('🔄 Deploying Discord commands...');

            // Collect all commands
            const commands = [];
            for (const [name, command] of this.client.commands) {
                commands.push(command.data.toJSON());
            }

            logger.info(`📋 Collected ${commands.length} commands for deployment`);

            const rest = new REST().setToken(process.env.DISCORD_TOKEN);

            // Deploy commands globally for long-term stability
            logger.info(`Deploying ${commands.length} commands globally...`);
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: commands }
            );
            logger.info(`✅ Successfully deployed ${commands.length} global commands`);

            // Also deploy to guilds for immediate availability
            const guilds = this.client.guilds.cache;
            if (guilds.size > 0) {
                logger.info(`Deploying ${commands.length} commands to ${guilds.size} guilds for immediate availability...`);

                let successCount = 0;
                let errorCount = 0;

                for (const [guildId, guild] of guilds) {
                    try {
                        // Deploy commands to guild for immediate availability
                        await rest.put(
                            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
                            { body: commands }
                        );
                        successCount++;
                        logger.info(`  ✅ Deployed ${commands.length} commands to ${guild.name}`);
                    } catch (error) {
                        errorCount++;
                        logger.error(`  ❌ Failed to deploy to ${guild.name}:`, error.message);
                    }
                }

                logger.info(`📊 Guild command deployment complete: ${successCount}/${guilds.size} guilds successful`);
                if (errorCount > 0) {
                    logger.warn(`⚠️ ${errorCount} guild deployments failed`);
                }
            }

        } catch (error) {
            logger.error('Failed to deploy commands:', error);
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
            // Stop clip polling service
            if (this.clipPollingService) {
                this.clipPollingService.stop();
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