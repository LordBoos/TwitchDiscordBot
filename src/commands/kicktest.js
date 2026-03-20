const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kicktest')
        .setDescription('Simulate a Kick stream notification for testing')
        .addStringOption(option =>
            option.setName('slug')
                .setDescription('The Kick channel slug (e.g. "xqc")')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const slug = interaction.options.getString('slug').toLowerCase().trim();
        const kickAPI = interaction.client.kickAPI;
        const notificationHandler = interaction.client.notificationHandler;

        if (!kickAPI || !kickAPI.hasCredentials) {
            return interaction.editReply('❌ Kick API is not configured.');
        }

        if (!notificationHandler) {
            return interaction.editReply('❌ Notification handler is not available.');
        }

        if (!/^[a-z0-9_-]{1,50}$/.test(slug)) {
            return interaction.editReply('❌ Invalid channel slug.');
        }

        try {
            // Look up the channel to get broadcaster ID
            const channel = await kickAPI.getChannelBySlug(slug);
            if (!channel) {
                return interaction.editReply(`❌ Channel **${slug}** not found on Kick.`);
            }

            const broadcasterId = channel.id || channel.user?.id;
            logger.info(`Kick test: fetching livestream data for ${slug} (broadcaster ${broadcasterId})`);

            // Fetch livestream data (same as webhook handler does)
            const livestream = await kickAPI.getLivestream(slug, broadcasterId);

            if (!livestream) {
                return interaction.editReply(`❌ **${slug}** is not currently live. This command requires the streamer to be live so we can fetch real stream data.`);
            }

            // Log the full livestream object for debugging
            logger.info(`Kick test: livestream data for ${slug}: ${JSON.stringify(livestream)}`);

            // Build the embed using the same method as real notifications
            const guildId = interaction.guildId;
            const embed = await notificationHandler.createKickStreamEmbed(slug, livestream, guildId);

            // Also build the message text (same as real notifications)
            const template = await interaction.client.models.getNotificationTemplate(guildId);
            let content = '';

            if (template?.message_text && template.message_text.trim() !== '') {
                const streamerName = livestream.user?.username || slug;
                const streamTitle = livestream.session_title || 'Live Stream';
                const category = livestream.categories?.[0]?.name || 'No category';
                const subscriberCount = livestream.subscriber_count ?? null;

                const variables = {
                    '{streamer_name}': streamerName,
                    '{streamer_login}': slug,
                    '{stream_title}': streamTitle,
                    '{game_name}': category,
                    '{viewer_count}': livestream.viewer_count ? livestream.viewer_count.toLocaleString() : '0',
                    '{follower_count}': subscriberCount ? subscriberCount.toLocaleString() : '0'
                };

                let messageText = template.message_text;
                Object.entries(variables).forEach(([placeholder, value]) => {
                    messageText = messageText.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
                });
                content = messageText;
            }

            // Send as ephemeral so only the tester sees it
            const reply = { embeds: [embed] };
            if (content) reply.content = content;

            logger.info(`Kick test: sending test notification for ${slug} — category: ${livestream.categories?.[0]?.name || 'none'}, subscribers: ${livestream.subscriber_count ?? 'unknown'}, thumbnail: ${livestream.thumbnail ? 'present' : 'null'}, profile_pic: ${livestream.user?.profile_pic ? 'present' : 'null'}`);

            return interaction.editReply(reply);
        } catch (error) {
            logger.error(`Kick test command failed for ${slug}:`, error);
            return interaction.editReply(`❌ Error: ${error.message}`);
        }
    },
};
