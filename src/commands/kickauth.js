const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kickauth')
        .setDescription('Authorize the bot with Kick to enable instant webhook notifications')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, models) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const kickAPI = interaction.client.kickAPI;

        if (!kickAPI.hasCredentials) {
            return interaction.editReply(
                '❌ Kick API credentials are not configured.\n' +
                'Set `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` in your `.env` file first.'
            );
        }

        if (!kickAPI.redirectUri) {
            return interaction.editReply(
                '❌ No redirect URI configured.\n' +
                'Set `KICK_REDIRECT_URI` in your `.env` file (e.g. `https://your-domain.com/kick-auth/callback`), ' +
                'or ensure `WEBHOOK_URL` is set so it can be derived automatically.'
            );
        }

        if (kickAPI.hasUserToken) {
            return interaction.editReply(
                '✅ Kick is already authorized with a user token. Webhook subscriptions are active.\n' +
                '*To re-authorize, the bot owner can delete the stored token and run this command again.*'
            );
        }

        try {
            const authUrl = kickAPI.getAuthorizationUrl();

            logger.info('Kick OAuth: authorization URL generated');

            return interaction.editReply(
                '🔗 **Kick Authorization Required**\n\n' +
                'To enable instant webhook notifications (instead of 2-min polling), ' +
                'a Kick account needs to authorize this bot.\n\n' +
                `**[Click here to authorize with Kick](${authUrl})**\n\n` +
                '*This link expires in 10 minutes. After authorizing, the bot will automatically ' +
                'create webhook subscriptions for all followed Kick streamers.*\n\n' +
                '> **Note:** Make sure your Kick app\'s redirect URI is set to:\n' +
                `> \`${kickAPI.redirectUri}\``
            );
        } catch (error) {
            logger.error('Error generating Kick auth URL:', error);
            return interaction.editReply(`❌ Failed to generate authorization URL: ${error.message}`);
        }
    },
};
