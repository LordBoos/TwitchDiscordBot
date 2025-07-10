const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('follow')
        .setDescription('Start following a Twitch streamer in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addStringOption(option =>
            option.setName('streamer')
                .setDescription('The Twitch username to follow')
                .setRequired(true)
                .setAutocomplete(false)
        ),

    async execute(interaction, models, twitchAPI) {
        const streamerName = interaction.options.getString('streamer').toLowerCase().trim();
        const channelId = interaction.channel.id;
        const guildId = interaction.guild.id;

        await interaction.deferReply();

        try {
            // Check if already following this streamer in this channel
            const existingFollows = await models.getChannelFollows(channelId);
            const alreadyFollowing = existingFollows.some(follow =>
                follow.streamer_name === streamerName
            );

            if (alreadyFollowing) {
                return await interaction.editReply({
                    content: `❌ This channel is already following **${streamerName}**!`,
                    ephemeral: true
                });
            }

            // Validate streamer exists on Twitch
            const twitchUser = await twitchAPI.getUserByName(streamerName);
            if (!twitchUser) {
                return await interaction.editReply({
                    content: `❌ Twitch user **${streamerName}** not found. Please check the username and try again.`,
                    ephemeral: true
                });
            }

            // Add to database
            await models.addChannelFollow(guildId, channelId, streamerName);

            // Check if we need to create an EventSub subscription
            const allFollows = await models.getAllFollowsForStreamer(streamerName);
            if (allFollows.length === 1) {
                // This is the first channel following this streamer, create subscription
                try {
                    await twitchAPI.subscribeToStreamOnline(twitchUser.id, streamerName);
                    logger.info(`Created new EventSub subscription for ${streamerName}`);
                } catch (error) {
                    logger.error(`Failed to create EventSub subscription for ${streamerName}:`, error);
                    // Don't fail the command, just log the error
                }
            }

            await interaction.editReply({
                content: `✅ Now following **${twitchUser.display_name}** in this channel! You'll be notified when they go live.`
            });

            logger.info(`Channel ${channelId} started following ${streamerName}`);

        } catch (error) {
            logger.error(`Error in follow command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while trying to follow this streamer. Please try again later.',
                ephemeral: true
            });
        }
    },
};