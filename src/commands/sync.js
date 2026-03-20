const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sync')
        .setDescription('Sync Twitch stream title & category to Kick automatically')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Link a Twitch channel to a Kick channel for auto-sync')
                .addStringOption(opt =>
                    opt.setName('twitch')
                        .setDescription('Twitch channel slug (e.g. "djjenna")')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('kick')
                        .setDescription('Kick channel slug (e.g. "djjenna13")')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove a Twitch→Kick sync pair')
                .addStringOption(opt =>
                    opt.setName('twitch')
                        .setDescription('Twitch channel slug')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt.setName('kick')
                        .setDescription('Kick channel slug')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('List all active Twitch→Kick sync pairs')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, models, twitchAPI) {
        const subcommand = interaction.options.getSubcommand();
        const kickAPI = interaction.client.kickAPI;

        if (!kickAPI || !kickAPI.hasCredentials) {
            return interaction.reply({
                content: '❌ Kick API is not configured. Set `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` in `.env`.',
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'add') {
            await this.handleAdd(interaction, models, twitchAPI, kickAPI);
        } else if (subcommand === 'remove') {
            await this.handleRemove(interaction, models, twitchAPI);
        } else if (subcommand === 'list') {
            await this.handleList(interaction, models);
        }
    },

    async handleAdd(interaction, models, twitchAPI, kickAPI) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const twitchSlug = interaction.options.getString('twitch').toLowerCase().trim();
        const kickSlug = interaction.options.getString('kick').toLowerCase().trim();

        // Validate slugs
        if (!/^[a-z0-9_]{1,50}$/.test(twitchSlug) || !/^[a-z0-9_-]{1,50}$/.test(kickSlug)) {
            return interaction.editReply('❌ Invalid channel slug format.');
        }

        // Check if sync pair already exists
        const existing = await models.getTwitchKickSync(twitchSlug, kickSlug);
        if (existing?.kick_access_token) {
            return interaction.editReply(`✅ Sync **${twitchSlug}** → **${kickSlug}** is already active and authorized.`);
        }

        // Look up the Twitch user to get their broadcaster ID
        let twitchUser;
        try {
            twitchUser = await twitchAPI.getUserByName(twitchSlug);
        } catch (error) {
            return interaction.editReply(`❌ Could not find Twitch user **${twitchSlug}**.`);
        }

        if (!twitchUser) {
            return interaction.editReply(`❌ Twitch user **${twitchSlug}** not found.`);
        }

        // Create or update the sync pair in the database (without token — token comes after OAuth)
        await models.addTwitchKickSync(twitchSlug, kickSlug, twitchUser.id);

        // Subscribe to Twitch channel.update EventSub
        try {
            await twitchAPI.subscribeToChannelUpdate(twitchUser.id, twitchSlug);
        } catch (error) {
            logger.error(`Failed to create channel.update subscription for ${twitchSlug}:`, error.message);
            // Continue anyway — the subscription might already exist
        }

        // Generate the Kick OAuth authorization URL for the streamer
        // Pass the interaction so we can update the Discord message after OAuth completes
        const authUrl = kickAPI.getSyncAuthorizationUrl(twitchSlug, kickSlug, interaction);

        const message = [
            `🔗 **Sync setup: ${twitchSlug} → ${kickSlug}**`,
            '',
            'The Kick streamer needs to authorize the bot to update their channel.',
            'Click the link below and log in with the **Kick account for `' + kickSlug + '`**:',
            '',
            `👉 **[Authorize on Kick](${authUrl})**`,
            '',
            '⚙️ Make sure the Kick developer app has:',
            `• **Redirect URI:** \`${kickAPI.redirectUri}\``,
            '',
            '⏱️ This link expires in 10 minutes.',
        ].join('\n');

        return interaction.editReply(message);
    },

    async handleRemove(interaction, models, twitchAPI) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const twitchSlug = interaction.options.getString('twitch').toLowerCase().trim();
        const kickSlug = interaction.options.getString('kick').toLowerCase().trim();

        const existing = await models.getTwitchKickSync(twitchSlug, kickSlug);
        if (!existing) {
            return interaction.editReply(`❌ No sync pair found for **${twitchSlug}** → **${kickSlug}**.`);
        }

        // Remove the sync pair
        await models.removeTwitchKickSync(twitchSlug, kickSlug);

        // Check if any other sync pairs use the same Twitch slug
        const remainingSyncs = await models.getSyncsByTwitchSlug(twitchSlug);
        if (remainingSyncs.length === 0) {
            // No more syncs for this Twitch streamer — unsubscribe from channel.update
            try {
                await twitchAPI.unsubscribeFromChannelUpdate(twitchSlug);
            } catch (error) {
                logger.warn(`Could not remove channel.update subscription for ${twitchSlug}:`, error.message);
            }
        }

        return interaction.editReply(`✅ Removed sync **${twitchSlug}** → **${kickSlug}**.`);
    },

    async handleList(interaction, models) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const syncs = await models.getAllTwitchKickSyncs();
        if (!syncs || syncs.length === 0) {
            return interaction.editReply('No Twitch→Kick sync pairs configured. Use `/sync add` to create one.');
        }

        const lines = syncs.map(s => {
            const status = s.kick_access_token ? '✅' : '⚠️ (needs auth)';
            return `${status} **${s.twitch_slug}** → **${s.kick_slug}**`;
        });

        return interaction.editReply(`**Twitch → Kick Sync Pairs:**\n${lines.join('\n')}`);
    },
};
