const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

class NotificationHandler {
    constructor(models, twitchAPI, discordBot) {
        this.models = models;
        this.twitchAPI = twitchAPI;
        this.discordBot = discordBot;
        this.cooldownSeconds = parseInt(process.env.NOTIFICATION_COOLDOWN_SECONDS) || 30;
    }

    async handleStreamOnline(event) {
        const streamerName = event.broadcaster_user_login.toLowerCase();
        const streamerId = event.broadcaster_user_id;

        logger.info(`${event.broadcaster_user_name} went live`);
        logger.info(`EventSub data: category_id=${event.category_id}, category_name=${event.category_name}`);

        // Wait 5 seconds to allow stream preview image to be ready
        logger.info(`Waiting 5 seconds for stream preview image to be ready...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            // Get all channels following this streamer
            const follows = await this.models.getAllFollowsForStreamer(streamerName);

            if (follows.length === 0) {
                logger.warn(`No channels following ${streamerName}, but received notification`);
                return;
            }

            // Get stream, game, and follower information with retry logic
            let streamData = null;
            let retryCount = 0;
            const maxRetries = 3;

            // Retry fetching stream data as it might not be immediately available
            while (!streamData && retryCount < maxRetries) {
                if (retryCount > 0) {
                    logger.info(`Retrying stream data fetch for ${streamerName} (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                }

                const [fetchedStreamData, followerCount] = await Promise.all([
                    this.twitchAPI.getStreamByUserId(streamerId),
                    this.twitchAPI.getFollowerCount(streamerId)
                ]);

                streamData = fetchedStreamData;

                // Get game data from stream data if available
                let gameData = null;
                if (streamData && streamData.game_id) {
                    gameData = await this.twitchAPI.getGameById(streamData.game_id);
                }

                logger.info(`Fetched data - Stream: ${!!streamData}, Game: ${gameData?.name || 'none'}, Followers: ${followerCount}`);

                if (streamData) {
                    // Successfully got stream data, proceed with notifications
                    const notifications = follows.map(follow =>
                        this.sendChannelNotification(follow.channel_id, follow.guild_id, streamerName, event, streamData, gameData, followerCount)
                    );
                    await Promise.allSettled(notifications);
                    return;
                }

                retryCount++;
            }

            // If we still don't have stream data after retries, send notification with basic info
            if (!streamData) {
                logger.warn(`Could not fetch stream data for ${streamerName} after ${maxRetries} attempts, sending basic notification`);

                // Create basic stream data object
                streamData = {
                    title: 'Live Stream',
                    viewer_count: 0,
                    thumbnail_url: null
                };

                const [gameData, followerCount] = await Promise.all([
                    event.category_id ? this.twitchAPI.getGameById(event.category_id) : null,
                    this.twitchAPI.getFollowerCount(streamerId)
                ]);

                const notifications = follows.map(follow =>
                    this.sendChannelNotification(follow.channel_id, follow.guild_id, streamerName, event, streamData, gameData, followerCount)
                );
                await Promise.allSettled(notifications);
            }



        } catch (error) {
            logger.error(`Error handling stream online for ${streamerName}:`, error);
        }
    }

    async sendChannelNotification(channelId, guildId, streamerName, event, streamData, gameData, followerCount) {
        try {
            // Check cooldown
            const onCooldown = await this.models.isNotificationOnCooldown(
                channelId,
                streamerName,
                this.cooldownSeconds
            );

            if (onCooldown) {
                logger.info(`Notification for ${streamerName} in channel ${channelId} is on cooldown`);
                return;
            }

            // Create embed with guild-specific template
            const embed = await this.createStreamEmbed(event, streamData, gameData, followerCount, guildId);

            // Get template for message text
            const template = await this.models.getNotificationTemplate(guildId);

            // Build content message
            let content = '';

            // Add custom message text if configured
            if (template?.message_text && template.message_text.trim() !== '') {
                // Template variables for replacement
                const variables = {
                    '{streamer_name}': event.broadcaster_user_name,
                    '{streamer_login}': event.broadcaster_user_login,
                    '{stream_title}': streamData.title || 'No title',
                    '{game_name}': gameData ? gameData.name : 'No category',
                    '{viewer_count}': streamData.viewer_count ? streamData.viewer_count.toLocaleString() : '0',
                    '{follower_count}': followerCount ? followerCount.toLocaleString() : '0'
                };

                // Replace variables in message text
                let messageText = template.message_text;
                Object.entries(variables).forEach(([placeholder, value]) => {
                    messageText = messageText.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
                });

                content = messageText;
            }

            // Check for role mentions and add to content
            if (embed.data.fields) {
                const gameField = embed.data.fields.find(field => field.name === '🎮 Game');
                if (gameField) {
                    const gameName = gameField.value;
                    const roleMention = await this.models.getGameRoleMention(guildId, gameName);
                    if (roleMention) {
                        // Add role mention to content (with newline if there's already message text)
                        const roleMentionText = `<@&${roleMention.role_id}>`;
                        content = content ? `${content}\n${roleMentionText}` : roleMentionText;
                    }
                }
            }

            // Send notification
            await this.discordBot.sendNotification(channelId, embed, content);

            // Update cooldown
            await this.models.updateNotificationCooldown(channelId, streamerName);

            logger.info(`Sent notification for ${streamerName} to channel ${channelId}`);

        } catch (error) {
            logger.error(`Failed to send notification for ${streamerName} to channel ${channelId}:`, error);
        }
    }

    async createStreamEmbed(event, streamData, gameData, followerCount, guildId) {
        // Get custom template for this guild
        const template = await this.models.getNotificationTemplate(guildId);

        // Template variables for replacement
        const variables = {
            '{streamer_name}': event.broadcaster_user_name,
            '{streamer_login}': event.broadcaster_user_login,
            '{stream_title}': streamData.title || 'No title',
            '{game_name}': gameData ? gameData.name : 'No category',
            '{viewer_count}': streamData.viewer_count ? streamData.viewer_count.toLocaleString() : '0',
            '{follower_count}': followerCount ? followerCount.toLocaleString() : '0'
        };

        // Apply template or use defaults
        let title = template?.title_template || '🔴 {streamer_name} is now live!';
        let description = template?.description_template || '{stream_title}';

        // Replace variables in templates
        Object.entries(variables).forEach(([placeholder, value]) => {
            title = title.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
            description = description.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
        });

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setURL(`https://twitch.tv/${event.broadcaster_user_login}`)
            .setColor(0x9146FF) // Twitch purple
            .setTimestamp();

        // Add description if not empty
        if (description && description.trim() !== '') {
            embed.setDescription(`**${description}**`);
        }

        // Add stream preview as main image
        if (streamData.thumbnail_url) {
            const streamPreviewUrl = streamData.thumbnail_url
                .replace('{width}', '1920')
                .replace('{height}', '1080');

            // Add random parameter to preserve multiple image previews on Discord
            const randomNum = Math.floor(Math.random() * (100000 - 100 + 1)) + 100;
            const timestamp = Math.floor(Date.now() / 1000);
            const urlWithParam = `${streamPreviewUrl}?${randomNum}=${timestamp}`;

            embed.setImage(urlWithParam);
            logger.info(`Added stream preview as main image: ${urlWithParam}`);
        }

        // Add profile picture as thumbnail (small image on the right side)
        try {
            const userData = await this.twitchAPI.getUserByName(event.broadcaster_user_login);
            if (userData && userData.profile_image_url) {
                embed.setThumbnail(userData.profile_image_url);
                logger.info(`Added profile picture as thumbnail: ${userData.profile_image_url}`);
            }
        } catch (error) {
            logger.warn(`Could not fetch user data for ${event.broadcaster_user_login}:`, error);
        }

        // Add fields based on template settings
        const fields = [];

        logger.info(`Template settings - show_game: ${template?.show_game}, gameData: ${!!gameData}, game_name: ${gameData?.name}`);

        // Game/Category field (inline)
        if (template?.show_game !== false && gameData) {
            fields.push({
                name: template?.game_field_name || '🎮 Game',
                value: gameData.name,
                inline: true
            });
            logger.info(`Added game field: ${gameData.name}`);
        } else {
            logger.info(`Game field not added - show_game: ${template?.show_game}, gameData: ${!!gameData}`);
        }

        // Followers field (inline)
        if (template?.show_followers !== false) {
            fields.push({
                name: template?.followers_field_name || '❤️ Followers',
                value: followerCount ? followerCount.toLocaleString() : '0',
                inline: true
            });
        }

        // Watch field (inline)
        fields.push({
            name: template?.watch_field_name || '📺 Watch',
            value: `[${template?.open_stream_text || 'Open Stream'}](https://twitch.tv/${event.broadcaster_user_login})`,
            inline: true
        });

        // Viewers field (optional, usually hidden for new streams) - if shown, goes after watch
        if (template?.show_viewers === true && streamData.viewer_count !== undefined) {
            fields.push({
                name: template?.viewers_field_name || '👥 Viewers',
                value: streamData.viewer_count.toLocaleString(),
                inline: true
            });
        }

        embed.addFields(fields);

        return embed;
    }

    async handleClipCreated(event) {
        logger.info(`${event.broadcaster_user_name} created a new clip`);

        // Get all channels following this streamer for clips
        const allClipFollows = await this.models.getAllClipFollows();
        const clipFollows = allClipFollows.filter(follow =>
            follow.streamer_name === event.broadcaster_user_login.toLowerCase()
        );

        if (clipFollows.length === 0) {
            logger.info(`No channels following ${event.broadcaster_user_name} for clips`);
            return;
        }

        // Send notifications to all following channels
        for (const follow of clipFollows) {
            try {
                // Create clip notification message with guild-specific template
                const messageContent = await this.createClipMessage(event, follow.guild_id);

                const channel = await this.discordBot.client.channels.fetch(follow.channel_id);
                if (channel) {
                    // Send the formatted text message
                    const message = await channel.send({
                        content: messageContent
                    });

                    // Track the Discord message for potential deletion and title updates
                    await this.models.addClipDiscordMessage(
                        event.id,
                        follow.channel_id,
                        message.id,
                        follow.streamer_name,
                        event.title || 'Untitled Clip'
                    );

                    logger.info(`Sent clip notification for ${follow.streamer_name} to channel ${follow.channel_id} (message: ${message.id})`);
                } else {
                    logger.warn(`Could not find channel ${follow.channel_id}`);
                }
            } catch (error) {
                logger.error(`Failed to send clip notification to channel ${follow.channel_id}:`, error);
            }
        }
    }

    async createClipMessage(event, guildId) {
        // Get guild-specific template or use default
        const template = await this.models.getClipNotificationTemplate(guildId);
        const messageTemplate = template?.message_template || '{creator} just created a new clip on {streamer} channel\n{title}\n{url}';

        // Template variables for replacement
        const variables = {
            '{streamer}': event.broadcaster_user_name,
            '{creator}': event.creator_name || event.broadcaster_user_name,
            '{title}': event.title || 'Untitled Clip',
            '{url}': event.url
        };

        // Replace variables in template
        let message = messageTemplate;
        for (const [variable, value] of Object.entries(variables)) {
            message = message.replace(new RegExp(variable.replace(/[{}]/g, '\\$&'), 'g'), value);
        }

        return message;
    }

    async handleClipDeleted(event) {
        logger.info(`${event.broadcaster_user_name} deleted a clip: ${event.id}`);

        try {
            // Get all Discord messages for this clip
            const discordMessages = await this.models.getClipDiscordMessages(event.id);

            if (discordMessages.length === 0) {
                logger.info(`No Discord messages found for deleted clip ${event.id}`);
                return;
            }

            logger.info(`Found ${discordMessages.length} Discord messages to delete for clip ${event.id}`);

            // Delete each Discord message
            for (const messageRecord of discordMessages) {
                try {
                    const channel = await this.discordBot.client.channels.fetch(messageRecord.channel_id);
                    if (channel) {
                        await channel.messages.delete(messageRecord.message_id);
                        logger.info(`Deleted Discord message ${messageRecord.message_id} in channel ${messageRecord.channel_id}`);
                    } else {
                        logger.warn(`Could not find channel ${messageRecord.channel_id} to delete message`);
                    }
                } catch (error) {
                    if (error.code === 10008) {
                        // Message not found - it was already deleted
                        logger.info(`Discord message ${messageRecord.message_id} was already deleted`);
                    } else {
                        logger.error(`Failed to delete Discord message ${messageRecord.message_id}:`, error);
                    }
                }
            }

            // Remove all tracking records for this clip
            await this.models.removeAllClipDiscordMessages(event.id);
            logger.info(`Cleaned up tracking records for deleted clip ${event.id}`);

        } catch (error) {
            logger.error(`Error handling clip deletion for ${event.id}:`, error);
        }
    }
}

module.exports = NotificationHandler;