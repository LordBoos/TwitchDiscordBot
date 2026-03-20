const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kickinfo')
        .setDescription('Fetch and display raw API data for a Kick streamer (debug)')
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

        if (!kickAPI || !kickAPI.hasCredentials) {
            return interaction.editReply('❌ Kick API is not configured.');
        }

        if (!/^[a-z0-9_-]{1,50}$/.test(slug)) {
            return interaction.editReply('❌ Invalid channel slug.');
        }

        try {
            await kickAPI.ensureToken();
            const headers = {
                Authorization: `Bearer ${kickAPI.accessToken}`,
                Accept: 'application/json',
            };
            const axios = require('axios');

            // Fetch /channels and /livestreams in parallel
            const [channelResult, livestreamResult] = await Promise.allSettled([
                axios.get(`${kickAPI.publicApiBase}/channels`, {
                    params: { slug },
                    headers,
                    timeout: 10000,
                }),
                // We need broadcaster ID for livestreams — get it from channels first or try without
                kickAPI.getChannelBySlug(slug).then(ch => {
                    if (!ch?.id) return null;
                    return axios.get(`${kickAPI.publicApiBase}/livestreams`, {
                        params: { broadcaster_user_id: Number(ch.id) },
                        headers,
                        timeout: 10000,
                    });
                }),
            ]);

            const channelRaw = channelResult.status === 'fulfilled'
                ? channelResult.value.data
                : { error: channelResult.reason?.message };
            const livestreamRaw = livestreamResult.status === 'fulfilled' && livestreamResult.value
                ? livestreamResult.value.data
                : livestreamResult.status === 'rejected'
                    ? { error: livestreamResult.reason?.message }
                    : { data: [] };

            // Extract key fields for display
            const ch = channelRaw?.data?.[0];
            const ls = livestreamRaw?.data?.[0];

            const channelInfo = ch ? [
                `**slug:** ${ch.slug}`,
                `**broadcaster_user_id:** ${ch.broadcaster_user_id}`,
                `**stream_title:** ${ch.stream_title || 'N/A'}`,
                `**category:** ${ch.category?.name || 'N/A'} (id:${ch.category?.id || 'N/A'})`,
                `**active_subscribers_count:** ${ch.active_subscribers_count ?? 'N/A'}`,
                `**stream.is_live:** ${ch.stream?.is_live ?? 'N/A'}`,
                `**stream.viewer_count:** ${ch.stream?.viewer_count ?? 'N/A'}`,
                `**stream.language:** ${ch.stream?.language ?? 'N/A'}`,
                `**stream.thumbnail:** ${ch.stream?.thumbnail ? 'present' : 'null'}`,
            ].join('\n') : `Error: ${JSON.stringify(channelRaw)}`;

            const livestreamInfo = ls ? [
                `**stream_title:** ${ls.stream_title}`,
                `**viewer_count:** ${ls.viewer_count}`,
                `**language:** ${ls.language}`,
                `**has_mature_content:** ${ls.has_mature_content}`,
                `**started_at:** ${ls.started_at}`,
                `**thumbnail:** ${ls.thumbnail ? 'present' : 'null'}`,
                `**category:** ${ls.category?.name || 'none'} (id:${ls.category?.id || 'N/A'})`,
                `**profile_picture:** ${ls.profile_picture ? 'present' : 'null'}`,
                `**broadcaster_user_id:** ${ls.broadcaster_user_id}`,
                `**channel_id:** ${ls.channel_id}`,
            ].join('\n') : 'Not currently live (or no data)';

            // Log full raw responses
            logger.info(`Kick info for ${slug} — /channels response: ${JSON.stringify(channelRaw)}`);
            logger.info(`Kick info for ${slug} — /livestreams response: ${JSON.stringify(livestreamRaw)}`);

            const embed = new EmbedBuilder()
                .setTitle(`Kick API Data: ${slug}`)
                .setColor(0x53FC18)
                .addFields(
                    { name: '📡 /channels', value: channelInfo.substring(0, 1024) },
                    { name: '🔴 /livestreams', value: livestreamInfo.substring(0, 1024) },
                )
                .setTimestamp();

            if (ls?.profile_picture) {
                embed.setThumbnail(ls.profile_picture);
            }
            if (ls?.thumbnail || ch?.stream?.thumbnail) {
                embed.setImage(ls?.thumbnail || ch.stream.thumbnail);
            }

            // Also show user token status
            const tokenStatus = kickAPI.hasUserToken
                ? '✅ User token available'
                : '⚠️ No user token (run /kickauth)';

            // Show subscriptions if user token exists
            let subsInfo = '';
            if (kickAPI.hasUserToken) {
                try {
                    const subs = await kickAPI.listSubscriptions();
                    subsInfo = `\n**Active subscriptions:** ${subs?.length ?? 0}`;
                } catch { /* ignore */ }
            }

            embed.addFields({
                name: '🔑 Auth Status',
                value: `${tokenStatus}${subsInfo}`,
            });

            return interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error(`Kick info command failed for ${slug}:`, error);
            return interaction.editReply(`❌ Error fetching data: ${error.message}`);
        }
    },
};
