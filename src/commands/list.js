const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list')
        .setDescription('List all Twitch streamers followed in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, models, twitchAPI) {
        const channelId = interaction.channel.id;

        await interaction.deferReply();

        try {
            const follows = await models.getChannelFollows(channelId);

            if (follows.length === 0) {
                return await interaction.editReply({
                    content: '📋 This channel is not following any Twitch streamers yet.\n\nUse `/follow <streamer>` to start following someone!'
                });
            }

            // Create embed with followed streamers
            const embed = new EmbedBuilder()
                .setTitle('📋 Followed Streamers')
                .setDescription(`This channel is following **${follows.length}** streamer${follows.length === 1 ? '' : 's'}:`)
                .setColor(0x9146FF) // Twitch purple
                .setTimestamp();

            // Add streamers to embed (max 25 fields)
            const maxStreamers = Math.min(follows.length, 25);
            for (let i = 0; i < maxStreamers; i++) {
                const follow = follows[i];
                const addedDate = new Date(follow.created_at).toLocaleDateString();

                embed.addFields({
                    name: `🎮 ${follow.streamer_name}`,
                    value: `Added: ${addedDate}`,
                    inline: true
                });
            }

            if (follows.length > 25) {
                embed.setFooter({
                    text: `... and ${follows.length - 25} more streamers`
                });
            }

            await interaction.editReply({ embeds: [embed] });

            logger.info(`Listed ${follows.length} followed streamers for channel ${channelId}`);

        } catch (error) {
            logger.error(`Error in list command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while retrieving the list of followed streamers. Please try again later.',
                ephemeral: true
            });
        }
    },
};