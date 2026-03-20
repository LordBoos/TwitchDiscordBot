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
                `**broadcaster_user_name:** ${ch.broadcaster_user_name}`,
                `**is_banned:** ${ch.is_banned}`,
                `**subscription_enabled:** ${ch.subscription_enabled}`,
                `**active_subscribers_count:** ${ch.active_subscribers_count ?? 'N/A'}`,
                `**profile_pic:** ${ch.user?.profile_pic ? 'present' : 'null'}`,
                `**banner_image:** ${ch.banner_image ? 'present' : 'null'}`,
                `**offline_banner:** ${ch.offline_banner_image ? 'present' : 'null'}`,
                `**livestream:** ${ch.livestream ? (ch.livestream.is_live ? 'LIVE' : 'offline') : 'null'}`,
            ].join('\n') : `Error: ${JSON.stringify(channelRaw)}`;

            const livestreamInfo = ls ? [
                `**is_live:** ${ls.is_live}`,
                `**session_title:** ${ls.session_title}`,
                `**viewers:** ${ls.viewers}`,
                `**duration:** ${ls.duration}s`,
                `**language:** ${ls.language}`,
                `**is_mature:** ${ls.is_mature}`,
                `**thumbnail:** ${ls.thumbnail ? 'present' : 'null'}`,
                `**categories:** ${ls.categories?.map(c => `${c.name} (id:${c.id})`).join(', ') || 'none'}`,
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

            if (ch?.user?.profile_pic) {
                embed.setThumbnail(ch.user.profile_pic);
            }
            if (ls?.thumbnail) {
                embed.setImage(ls.thumbnail);
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
