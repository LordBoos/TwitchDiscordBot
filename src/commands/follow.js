const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // Check if already following this streamer in this channel
            const existingFollows = await models.getChannelFollows(channelId);
            const alreadyFollowing = existingFollows.some(follow =>
                follow.streamer_name === streamerName
            );

            if (alreadyFollowing) {
                return await interaction.editReply({
                    content: `❌ This channel is already following **${streamerName}**!`,
    
                });
            }

            // Validate streamer exists on Twitch
            const twitchUser = await twitchAPI.getUserByName(streamerName);
            if (!twitchUser) {
                return await interaction.editReply({
                    content: `❌ Twitch user **${streamerName}** not found. Please check the username and try again.`,
    
                });
            }

            // Add to database
            await models.addChannelFollow(guildId, channelId, streamerName);

            // Ensure an EventSub subscription exists for this streamer
            try {
                await twitchAPI.subscribeToStreamOnline(twitchUser.id, streamerName);
            } catch (error) {
                logger.error(`Failed to ensure EventSub subscription for ${streamerName}:`, error);
                // Don't fail the command, just log the error
            }

            await interaction.editReply({
                content: `✅ Now following **${twitchUser.display_name}** in this channel! You'll be notified when they go live.`
            });

            logger.info(`Channel ${channelId} started following ${streamerName}`);

        } catch (error) {
            logger.error(`Error in follow command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while trying to follow this streamer. Please try again later.',

            });
        }
    },
};