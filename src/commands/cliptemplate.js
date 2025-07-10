const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cliptemplate')
        .setDescription('Manage clip notification templates')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set entire clip notification message template')
                .addStringOption(option =>
                    option.setName('template')
                        .setDescription('Message template (use {streamer}, {creator}, {title}, {url})')
                        .setRequired(true)
                        .setMaxLength(2000)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('setline')
                .setDescription('Set a specific line of the clip notification template')
                .addIntegerOption(option =>
                    option.setName('line')
                        .setDescription('Line number (1-5)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(5))
                .addStringOption(option =>
                    option.setName('text')
                        .setDescription('Text for this line (use {streamer}, {creator}, {title}, {url})')
                        .setRequired(true)
                        .setMaxLength(500)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('removeline')
                .setDescription('Remove a specific line from the clip notification template')
                .addIntegerOption(option =>
                    option.setName('line')
                        .setDescription('Line number to remove (1-5)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(5)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View current clip notification template'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset clip notification template to defaults'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('preview')
                .setDescription('Preview clip notification template with sample data')),

    async execute(interaction, models) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        await interaction.deferReply();

        try {
            switch (subcommand) {
                case 'set':
                    await this.handleSet(interaction, models, guildId);
                    break;
                case 'setline':
                    await this.handleSetLine(interaction, models, guildId);
                    break;
                case 'removeline':
                    await this.handleRemoveLine(interaction, models, guildId);
                    break;
                case 'view':
                    await this.handleView(interaction, models, guildId);
                    break;
                case 'reset':
                    await this.handleReset(interaction, models, guildId);
                    break;
                case 'preview':
                    await this.handlePreview(interaction, models, guildId);
                    break;
            }
        } catch (error) {
            logger.error(`Error in cliptemplate command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while managing clip templates. Please try again later.',
                ephemeral: true
            });
        }
    },

    async handleSet(interaction, models, guildId) {
        const messageTemplate = interaction.options.getString('template');

        await models.setClipNotificationTemplate(guildId, messageTemplate);

        const embed = new EmbedBuilder()
            .setTitle('✅ Clip Template Updated')
            .setDescription('Clip notification template has been updated successfully.')
            .setColor(0x00FF00)
            .addFields(
                {
                    name: '📝 New Template',
                    value: `\`\`\`${messageTemplate}\`\`\``,
                    inline: false
                },
                {
                    name: '🔧 Available Variables',
                    value: '`{streamer}` `{creator}` `{title}` `{url}`',
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Updated clip template for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handleSetLine(interaction, models, guildId) {
        const lineNumber = interaction.options.getInteger('line');
        const lineText = interaction.options.getString('text');

        // Get current template
        const template = await models.getClipNotificationTemplate(guildId);
        const currentTemplate = template?.message_template || '{creator} just created a new clip on {streamer} channel\n{title}\n{url}';

        // Split into lines
        const lines = currentTemplate.split('\n');

        // Ensure we have enough lines
        while (lines.length < 5) {
            lines.push('');
        }

        // Set the specific line (convert to 0-based index)
        lines[lineNumber - 1] = lineText;

        // Remove empty lines from the end
        while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        // Join back together
        const newTemplate = lines.join('\n');

        await models.setClipNotificationTemplate(guildId, newTemplate);

        const embed = new EmbedBuilder()
            .setTitle('✅ Clip Template Line Updated')
            .setDescription(`Line ${lineNumber} has been updated successfully.`)
            .setColor(0x00FF00)
            .addFields(
                {
                    name: `📝 Line ${lineNumber}`,
                    value: `\`\`\`${lineText}\`\`\``,
                    inline: false
                },
                {
                    name: '📋 Full Template',
                    value: `\`\`\`${newTemplate}\`\`\``,
                    inline: false
                },
                {
                    name: '🔧 Available Variables',
                    value: '`{streamer}` `{creator}` `{title}` `{url}`',
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Updated clip template line ${lineNumber} for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handleRemoveLine(interaction, models, guildId) {
        const lineNumber = interaction.options.getInteger('line');

        // Get current template
        const template = await models.getClipNotificationTemplate(guildId);
        const currentTemplate = template?.message_template || '{creator} just created a new clip on {streamer} channel\n{title}\n{url}';

        // Split into lines
        const lines = currentTemplate.split('\n');

        if (lineNumber > lines.length) {
            await interaction.editReply({
                content: `❌ Line ${lineNumber} doesn't exist. The template only has ${lines.length} lines.`,
                ephemeral: true
            });
            return;
        }

        // Remove the specific line (convert to 0-based index)
        const removedLine = lines[lineNumber - 1];
        lines.splice(lineNumber - 1, 1);

        // Join back together
        const newTemplate = lines.join('\n');

        await models.setClipNotificationTemplate(guildId, newTemplate);

        const embed = new EmbedBuilder()
            .setTitle('✅ Clip Template Line Removed')
            .setDescription(`Line ${lineNumber} has been removed successfully.`)
            .setColor(0xFF6B6B)
            .addFields(
                {
                    name: `🗑️ Removed Line ${lineNumber}`,
                    value: `\`\`\`${removedLine}\`\`\``,
                    inline: false
                },
                {
                    name: '📋 Updated Template',
                    value: `\`\`\`${newTemplate || '(empty)'}\`\`\``,
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Removed clip template line ${lineNumber} for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handleView(interaction, models, guildId) {
        const template = await models.getClipNotificationTemplate(guildId);
        const messageTemplate = template?.message_template || '{creator} just created a new clip on {streamer} channel\n{title}\n{url}';

        // Split template into lines for numbered display
        const lines = messageTemplate.split('\n');
        const numberedLines = lines.map((line, index) => `${index + 1}. ${line || '(empty)'}`).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('📋 Current Clip Template')
            .setColor(0x9146FF)
            .addFields(
                {
                    name: '📝 Message Template (with line numbers)',
                    value: `\`\`\`${numberedLines}\`\`\``,
                    inline: false
                },
                {
                    name: '📄 Raw Template',
                    value: `\`\`\`${messageTemplate}\`\`\``,
                    inline: false
                },
                {
                    name: '🔧 Available Variables',
                    value: '`{streamer}` `{creator}` `{title}` `{url}`',
                    inline: false
                },
                {
                    name: '📖 Variable Descriptions',
                    value: [
                        '`{streamer}` - Channel name where clip was created',
                        '`{creator}` - Username who created the clip',
                        '`{title}` - Title of the clip',
                        '`{url}` - Direct link to the clip'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '✏️ Line Editing Commands',
                    value: [
                        '`/cliptemplate setline line:1 text:Your text` - Set line 1',
                        '`/cliptemplate removeline line:2` - Remove line 2',
                        '`/cliptemplate set template:Full template` - Set entire template'
                    ].join('\n'),
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },

    async handleReset(interaction, models, guildId) {
        await models.removeClipNotificationTemplate(guildId);

        const embed = new EmbedBuilder()
            .setTitle('🔄 Clip Template Reset')
            .setDescription('Clip notification template has been reset to defaults.')
            .setColor(0xFF6B6B)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Reset clip template for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handlePreview(interaction, models, guildId) {
        // Create a sample clip event for preview
        const sampleEvent = {
            broadcaster_user_name: 'SampleStreamer',
            broadcaster_user_login: 'samplestreamer',
            creator_name: 'ClipCreator',
            title: 'Amazing Play!',
            url: 'https://clips.twitch.tv/sample-clip',
            id: 'sample-clip-id'
        };

        // Get the notification handler to create preview message
        const NotificationHandler = require('../handlers/notificationHandler');
        const notificationHandler = new NotificationHandler(models, null, null);

        const previewMessage = await notificationHandler.createClipMessage(sampleEvent, guildId);

        const previewEmbed = new EmbedBuilder()
            .setTitle('👀 Clip Template Preview')
            .setDescription('This is how your clip notifications will look:')
            .setColor(0x9146FF)
            .addFields(
                {
                    name: '📝 Preview Message',
                    value: `\`\`\`${previewMessage}\`\`\``,
                    inline: false
                }
            );

        await interaction.editReply({
            embeds: [previewEmbed]
        });
    }
};
