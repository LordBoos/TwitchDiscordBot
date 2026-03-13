const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kickfollow')
        .setDescription('Follow a Kick.com streamer for live notifications in this channel')
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

        // Basic slug validation
        if (!/^[a-z0-9_-]{1,50}$/.test(slug)) {
            return interaction.editReply('❌ Invalid channel slug. Use only letters, numbers, underscores, or hyphens.');
        }

        try {
            // Verify channel exists on Kick
            const channel = await kickAPI.getChannelBySlug(slug);
            if (!channel) {
                return interaction.editReply(`❌ Could not find a Kick channel with slug \`${slug}\`. Check the spelling and try again.`);
            }

            const broadcasterUserId = channel.user?.id || channel.id || null;
            const displayName = channel.user?.username || slug;
            const unverified = channel._unverified === true;

            // Check for existing follow in this Discord channel
            const existing = await models.getKickChannelFollow(interaction.channelId, slug);
            if (existing) {
                return interaction.editReply(`✅ This channel is already following **${displayName}** on Kick.`);
            }

            // Add to database
            await models.addKickChannelFollow(
                interaction.guildId,
                interaction.channelId,
                slug,
                broadcasterUserId
            );

            // If we have a user token (events:subscribe scope), subscribe to the webhook
            if (kickAPI.hasUserToken && broadcasterUserId) {
                const existingSub = await models.getKickEventSubSubscription(slug);
                if (!existingSub) {
                    try {
                        const sub = await kickAPI.subscribeToLivestreamStatus(broadcasterUserId);
                        // Response: { data: { subscription_id, event, broadcaster_user_id, status, created_at } }
                        const subId = sub?.data?.subscription_id ?? sub?.data?.id ?? sub?.id;
                        if (subId) {
                            await models.addKickEventSubSubscription(subId, slug, broadcasterUserId);
                            logger.info(`Kick: created livestream.status.updated subscription for ${slug} (id: ${subId})`);
                        }
                    } catch (subError) {
                        const detail = subError.response
                            ? `HTTP ${subError.response.status}: ${JSON.stringify(subError.response.data)}`
                            : subError.message;
                        logger.warn(`Kick: could not create webhook subscription for ${slug} (will use polling): ${detail}`);
                    }
                }
            }

            logger.info(`Kick follow added: ${slug} → channel ${interaction.channelId}${unverified ? ' (unverified)' : ''}`);

            if (unverified) {
                return interaction.editReply(
                    `✅ Now following [**${slug}**](https://kick.com/${slug}) on Kick in this channel!\n` +
                    `⚠️ *Could not verify the channel exists (Kick API temporarily unavailable). ` +
                    `Notifications will use polling. If the slug is wrong, use \`/kickunfollow\` to remove it.*`
                );
            }

            let modeNote;
            if (kickAPI.hasUserToken && broadcasterUserId) {
                modeNote = 'Live notifications delivered via Kick webhooks (instant).';
            } else if (kickAPI.hasCredentials) {
                modeNote = 'Live notifications delivered via polling (every 2 min). Run `/kickauth` to enable instant webhooks.';
            } else {
                modeNote = 'Live notifications delivered via polling (every 2 min). Add `KICK_CLIENT_ID`/`KICK_CLIENT_SECRET` and run `/kickauth` for instant webhooks.';
            }

            return interaction.editReply(
                `✅ Now following [**${displayName}**](https://kick.com/${slug}) on Kick in this channel!\n*${modeNote}*`
            );
        } catch (error) {
            logger.error(`Error executing /kickfollow for ${slug}:`, error);
            return interaction.editReply('❌ An error occurred while following this streamer. Please try again.');
        }
    },
};
