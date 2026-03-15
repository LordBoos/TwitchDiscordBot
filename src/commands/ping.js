const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Test bot responsiveness')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        const sent = await interaction.reply({
            content: 'Pinging...',
            flags: MessageFlags.Ephemeral,
            fetchReply: true
        });

        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);

        await interaction.editReply({
            content: `🏓 **Pong!**\n📡 **Latency:** ${latency}ms\n💓 **API Latency:** ${apiLatency}ms`
        });
    },
};