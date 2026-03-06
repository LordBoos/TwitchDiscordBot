const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kickunfollow')
        .setDescription('Stop following a Kick.com streamer in this channel')
        .addStringOption(option =>
            option.setName('slug')
                .setDescription('The Kick channel slug (e.g. "xqc")')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, models) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const slug = interaction.options.getString('slug').toLowerCase().trim();
        const kickAPI = interaction.client.kickAPI;

        try {
            const existing = await models.getKickChannelFollow(interaction.channelId, slug);
            if (!existing) {
                return interaction.editReply(`❌ This channel is not following \`${slug}\` on Kick.`);
            }

            await models.removeKickChannelFollow(interaction.channelId, slug);

            // Check if any other Discord channel still follows this streamer
            const remainingFollows = await models.getAllKickFollowsForStreamer(slug);
            if (remainingFollows.length === 0) {
                // No more follows – remove webhook subscription if one exists
                if (kickAPI.hasCredentials) {
                    const sub = await models.getKickEventSubSubscription(slug);
                    if (sub) {
                        try {
                            await kickAPI.unsubscribeFromEvent(sub.subscription_id);
                            logger.info(`Kick: removed livestream.status.updated subscription for ${slug}`);
                        } catch (subError) {
                            logger.warn(`Kick: could not delete webhook subscription for ${slug}:`, subError.message);
                        }
                        await models.removeKickEventSubSubscription(slug);
                    }
                }

                // Clean up polling state
                await models.setKickStreamState(slug, false);
            }

            logger.info(`Kick unfollow: ${slug} ← channel ${interaction.channelId}`);
            return interaction.editReply(`✅ No longer following **${slug}** on Kick in this channel.`);
        } catch (error) {
            logger.error(`Error executing /kickunfollow for ${slug}:`, error);
            return interaction.editReply('❌ An error occurred. Please try again.');
        }
    },
};
