const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show bot status and active EventSub subscriptions')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, models, twitchAPI) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Get all EventSub subscriptions
            const subscriptions = await models.getAllEventSubSubscriptions();

            // Get total number of channel follows
            const allFollows = await models.db.all('SELECT COUNT(*) as count FROM channel_follows');
            const totalFollows = allFollows[0].count;

            // Get number of unique guilds
            const guilds = await models.db.all('SELECT COUNT(DISTINCT guild_id) as count FROM channel_follows');
            const totalGuilds = guilds[0].count;

            const embed = new EmbedBuilder()
                .setTitle('🤖 Bot Status')
                .setColor(0x00FF00) // Green
                .setTimestamp()
                .addFields(
                    {
                        name: '📊 Statistics',
                        value: [
                            `**Active Subscriptions:** ${subscriptions.length}`,
                            `**Total Channel Follows:** ${totalFollows}`,
                            `**Servers:** ${totalGuilds}`,
                        ].join('\n'),
                        inline: false
                    }
                );

            if (subscriptions.length > 0) {
                const streamerList = subscriptions
                    .map(sub => `• ${sub.streamer_name}`)
                    .slice(0, 20) // Limit to first 20
                    .join('\n');

                embed.addFields({
                    name: '🎮 Active EventSub Subscriptions',
                    value: subscriptions.length > 20
                        ? `${streamerList}\n... and ${subscriptions.length - 20} more`
                        : streamerList,
                    inline: false
                });
            }

            // Add system info
            embed.addFields({
                name: '⚙️ System Info',
                value: [
                    `**Node.js:** ${process.version}`,
                    `**Memory Usage:** ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
                    `**Uptime:** ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
                ].join('\n'),
                inline: false
            });

            await interaction.editReply({ embeds: [embed] });

            logger.info(`Status command executed by ${interaction.user.tag}`);

        } catch (error) {
            logger.error(`Error in status command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while retrieving bot status. Please try again later.'
            });
        }
    },
};