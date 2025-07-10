const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clips')
        .setDescription('Manage Twitch clip notifications for streamers')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName('follow')
                .setDescription('Follow a streamer for clip notifications in this channel')
                .addStringOption(option =>
                    option.setName('streamer')
                        .setDescription('Twitch streamer username')
                        .setRequired(true)
                        .setMaxLength(25)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unfollow')
                .setDescription('Stop following a streamer for clip notifications in this channel')
                .addStringOption(option =>
                    option.setName('streamer')
                        .setDescription('Twitch streamer username')
                        .setRequired(true)
                        .setMaxLength(25)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all streamers being followed for clips in this channel')
        ),

    async execute(interaction, models) {
        const subcommand = interaction.options.getSubcommand();
        const channelId = interaction.channel.id;
        const guildId = interaction.guild.id;

        await interaction.deferReply();

        try {
            switch (subcommand) {
                case 'follow':
                    await this.handleFollow(interaction, models, guildId, channelId);
                    break;
                case 'unfollow':
                    await this.handleUnfollow(interaction, models, channelId);
                    break;
                case 'list':
                    await this.handleList(interaction, models, channelId);
                    break;
            }
        } catch (error) {
            logger.error(`Error in clips command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while managing clip follows. Please try again later.',
                ephemeral: true
            });
        }
    },

    async handleFollow(interaction, models, guildId, channelId) {
        const streamerName = interaction.options.getString('streamer').toLowerCase().trim();

        // Get TwitchAPI instance from the client
        const twitchAPI = interaction.client.twitchAPI;

        // Validate streamer name
        if (!/^[a-zA-Z0-9_]{1,25}$/.test(streamerName)) {
            return await interaction.editReply({
                content: '❌ Invalid streamer name. Twitch usernames can only contain letters, numbers, and underscores.',
                ephemeral: true
            });
        }

        try {
            // Check if streamer exists
            const userData = await twitchAPI.getUserByName(streamerName);
            if (!userData) {
                return await interaction.editReply({
                    content: `❌ Streamer **${streamerName}** not found on Twitch.`,
                    ephemeral: true
                });
            }

            // Check if already following
            const existingFollows = await models.getChannelClipFollows(channelId);
            const isAlreadyFollowing = existingFollows.some(follow => follow.streamer_name === streamerName);

            if (isAlreadyFollowing) {
                return await interaction.editReply({
                    content: `❌ This channel is already following **${streamerName}** for clip notifications.`,
                    ephemeral: true
                });
            }

            // Add to database
            await models.addChannelClipFollow(guildId, channelId, streamerName);



            const embed = new EmbedBuilder()
                .setTitle('✅ Clip Follow Added')
                .setDescription(`Now following **${streamerName}** for clip notifications in this channel.`)
                .setColor(0x00FF00)
                .addFields(
                    {
                        name: '📺 Streamer',
                        value: streamerName,
                        inline: true
                    },
                    {
                        name: '📋 Channel',
                        value: `<#${channelId}>`,
                        inline: true
                    },
                    {
                        name: '🎬 Notifications',
                        value: 'New clips will be posted here (checked every 1 minute)\n🗑️ Deleted clips will be removed from Discord',
                        inline: false
                    }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            logger.info(`Added clip follow for ${streamerName} in channel ${channelId} by ${interaction.user.tag}`);

        } catch (error) {
            logger.error(`Error adding clip follow for ${streamerName}:`, error);
            await interaction.editReply({
                content: '❌ Failed to add clip follow. Please try again later.',
                ephemeral: true
            });
        }
    },

    async handleUnfollow(interaction, models, channelId) {
        const streamerName = interaction.options.getString('streamer').toLowerCase().trim();

        try {
            // Check if following
            const existingFollows = await models.getChannelClipFollows(channelId);
            const isFollowing = existingFollows.some(follow => follow.streamer_name === streamerName);

            if (!isFollowing) {
                return await interaction.editReply({
                    content: `❌ This channel is not following **${streamerName}** for clip notifications.`,
                    ephemeral: true
                });
            }

            // Remove from database
            await models.removeChannelClipFollow(channelId, streamerName);

            // Check if any other channels are still following this streamer for clips
            const allClipFollows = await models.getAllClipFollows();
            const otherFollows = allClipFollows.filter(follow => follow.streamer_name === streamerName);

            // If no other channels are following, clean up polling state and EventSub subscription
            if (otherFollows.length === 0) {
                try {
                    await models.removeClipPollingState(streamerName);
                    logger.info(`Removed clip polling state for ${streamerName} (no more followers)`);
                } catch (cleanupError) {
                    logger.warn(`Failed to remove clip polling state for ${streamerName}:`, cleanupError);
                    // Continue anyway - the follow is still removed from database
                }


            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Clip Follow Removed')
                .setDescription(`No longer following **${streamerName}** for clip notifications in this channel.`)
                .setColor(0xFF6B6B)
                .addFields(
                    {
                        name: '📺 Streamer',
                        value: streamerName,
                        inline: true
                    },
                    {
                        name: '📋 Channel',
                        value: `<#${channelId}>`,
                        inline: true
                    }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            logger.info(`Removed clip follow for ${streamerName} in channel ${channelId} by ${interaction.user.tag}`);

        } catch (error) {
            logger.error(`Error removing clip follow for ${streamerName}:`, error);
            await interaction.editReply({
                content: '❌ Failed to remove clip follow. Please try again later.',
                ephemeral: true
            });
        }
    },

    async handleList(interaction, models, channelId) {
        try {
            const follows = await models.getChannelClipFollows(channelId);

            const embed = new EmbedBuilder()
                .setTitle('🎬 Clip Follows')
                .setDescription(`Streamers being followed for clip notifications in <#${channelId}>`)
                .setColor(0x9146FF)
                .setTimestamp();

            if (follows.length === 0) {
                embed.addFields({
                    name: '📭 No Follows',
                    value: 'This channel is not following any streamers for clip notifications.\nUse `/clips follow <streamer>` to start following someone.',
                    inline: false
                });
            } else {
                const streamerList = follows
                    .map((follow, index) => `${index + 1}. **${follow.streamer_name}**`)
                    .join('\n');

                embed.addFields(
                    {
                        name: `📺 Following ${follows.length} streamer${follows.length === 1 ? '' : 's'}`,
                        value: streamerList,
                        inline: false
                    },
                    {
                        name: '💡 Tip',
                        value: 'Use `/clips unfollow <streamer>` to stop following someone.',
                        inline: false
                    }
                );
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error(`Error listing clip follows for channel ${channelId}:`, error);
            await interaction.editReply({
                content: '❌ Failed to list clip follows. Please try again later.',
                ephemeral: true
            });
        }
    }
};
