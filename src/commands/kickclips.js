const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kickclips')
        .setDescription('Manage Kick.com clip notifications for this channel')
        .addSubcommand(sub =>
            sub.setName('follow')
                .setDescription('Start receiving clip notifications for a Kick streamer')
                .addStringOption(opt =>
                    opt.setName('slug')
                        .setDescription('The Kick channel slug (e.g. "xqc")')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('unfollow')
                .setDescription('Stop receiving clip notifications for a Kick streamer')
                .addStringOption(opt =>
                    opt.setName('slug')
                        .setDescription('The Kick channel slug')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all Kick streamers followed for clips in this channel')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, models) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const subcommand = interaction.options.getSubcommand();
        const kickAPI = interaction.client.kickAPI;

        if (subcommand === 'follow') {
            const slug = interaction.options.getString('slug').toLowerCase().trim();

            if (!/^[a-z0-9_-]{1,50}$/.test(slug)) {
                return interaction.editReply('❌ Invalid channel slug.');
            }

            try {
                // Verify channel exists
                const channel = await kickAPI.getChannelBySlug(slug);
                if (!channel) {
                    return interaction.editReply(`❌ Could not find a Kick channel with slug \`${slug}\`.`);
                }

                const displayName = channel.user?.username || slug;

                // Check for existing clip follow
                const existing = await models.getKickClipFollows(interaction.channelId);
                if (existing.some(f => f.streamer_slug === slug)) {
                    return interaction.editReply(`✅ Already following clips for **${displayName}** on Kick.`);
                }

                await models.addKickClipFollow(interaction.guildId, interaction.channelId, slug);

                // Seed clip polling state so only future clips are notified
                const existingState = await models.getKickClipPollingState(slug);
                if (!existingState) {
                    const broadcasterUserId = channel.user?.id || channel.id || null;
                    const clips = await kickAPI.getRecentClips(slug, broadcasterUserId);
                    if (clips && clips.length > 0) {
                        const sorted = clips.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                        await models.setKickClipPollingState(slug, sorted[0].id.toString());
                    }
                }

                logger.info(`Kick clip follow added: ${slug} → channel ${interaction.channelId}`);
                return interaction.editReply(
                    `✅ Now receiving clip notifications for [**${displayName}**](https://kick.com/${slug}) in this channel!\n*Clips are checked every 5 minutes.*`
                );
            } catch (error) {
                logger.error(`Error in /kickclips follow for ${slug}:`, error);
                return interaction.editReply('❌ An error occurred. Please try again.');
            }
        }

        if (subcommand === 'unfollow') {
            const slug = interaction.options.getString('slug').toLowerCase().trim();

            try {
                const existing = await models.getKickClipFollows(interaction.channelId);
                if (!existing.some(f => f.streamer_slug === slug)) {
                    return interaction.editReply(`❌ Not following clips for \`${slug}\` on Kick.`);
                }

                await models.removeKickClipFollow(interaction.channelId, slug);

                // Clean up polling state if no other channel follows this slug for clips
                const remaining = await models.getKickClipFollowsForStreamer(slug);
                if (remaining.length === 0) {
                    await models.removeKickClipPollingState(slug);
                }

                logger.info(`Kick clip unfollow: ${slug} ← channel ${interaction.channelId}`);
                return interaction.editReply(`✅ No longer receiving clip notifications for **${slug}** in this channel.`);
            } catch (error) {
                logger.error(`Error in /kickclips unfollow for ${slug}:`, error);
                return interaction.editReply('❌ An error occurred. Please try again.');
            }
        }

        if (subcommand === 'list') {
            try {
                const clipFollows = await models.getKickClipFollows(interaction.channelId);

                if (clipFollows.length === 0) {
                    return interaction.editReply('📋 No Kick streamers are being followed for clips in this channel.');
                }

                const list = clipFollows.map(f => `• [${f.streamer_slug}](https://kick.com/${f.streamer_slug})`).join('\n');
                return interaction.editReply(`📋 **Kick clip notifications active for:**\n${list}`);
            } catch (error) {
                logger.error('Error in /kickclips list:', error);
                return interaction.editReply('❌ An error occurred. Please try again.');
            }
        }
    },
};
