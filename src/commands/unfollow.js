const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unfollow')
        .setDescription('Stop following a Twitch streamer in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addStringOption(option =>
            option.setName('streamer')
                .setDescription('The Twitch username to unfollow')
                .setRequired(true)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction, models) {
        const focusedValue = interaction.options.getFocused();
        const channelId = interaction.channel.id;

        try {
            const follows = await models.getChannelFollows(channelId);
            const filtered = follows
                .filter(follow => follow.streamer_name.startsWith(focusedValue.toLowerCase()))
                .slice(0, 25); // Discord limits to 25 choices

            await interaction.respond(
                filtered.map(follow => ({
                    name: follow.streamer_name,
                    value: follow.streamer_name
                }))
            );
        } catch (error) {
            logger.error('Error in unfollow autocomplete:', error);
            await interaction.respond([]);
        }
    },

    async execute(interaction, models, twitchAPI) {
        const streamerName = interaction.options.getString('streamer').toLowerCase().trim();
        const channelId = interaction.channel.id;

        await interaction.deferReply();

        try {
            // Check if we're following this streamer
            const existingFollows = await models.getChannelFollows(channelId);
            const isFollowing = existingFollows.some(follow =>
                follow.streamer_name === streamerName
            );

            if (!isFollowing) {
                return await interaction.editReply({
                    content: `❌ This channel is not following **${streamerName}**!`,
                    ephemeral: true
                });
            }

            // Remove from database
            await models.removeChannelFollow(channelId, streamerName);

            // Check if we need to remove the EventSub subscription
            const remainingFollows = await models.getAllFollowsForStreamer(streamerName);
            if (remainingFollows.length === 0) {
                // No more channels following this streamer, remove subscription
                try {
                    await twitchAPI.unsubscribeFromStreamOnline(streamerName);
                    logger.info(`Removed EventSub subscription for ${streamerName}`);
                } catch (error) {
                    logger.error(`Failed to remove EventSub subscription for ${streamerName}:`, error);
                    // Don't fail the command, just log the error
                }
            }

            await interaction.editReply({
                content: `✅ No longer following **${streamerName}** in this channel.`
            });

            logger.info(`Channel ${channelId} stopped following ${streamerName}`);

        } catch (error) {
            logger.error(`Error in unfollow command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while trying to unfollow this streamer. Please try again later.',
                ephemeral: true
            });
        }
    },
};