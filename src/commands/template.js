const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('template')
        .setDescription('Manage custom notification templates for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set custom notification template')
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Title template (use {streamer_name}, {game_name}, etc.)')
                        .setRequired(true)
                        .setMaxLength(256)
                )
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Description template (use {stream_title}, {viewer_count}, etc.)')
                        .setRequired(false)
                        .setMaxLength(1000)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('Set the plain text message that appears above the embed')
                .addStringOption(option =>
                    option.setName('text')
                        .setDescription('Message text (use variables like {streamer_name}, leave empty to remove)')
                        .setRequired(false)
                        .setMaxLength(2000)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('fields')
                .setDescription('Customize notification field names and visibility')
                .addStringOption(option =>
                    option.setName('game_field')
                        .setDescription('Game/Category field name (e.g., "🎮 Playing", "📱 Category")')
                        .setRequired(false)
                        .setMaxLength(50)
                )
                .addBooleanOption(option =>
                    option.setName('show_game')
                        .setDescription('Show game/category field')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('viewers_field')
                        .setDescription('Viewers field name (e.g., "👥 Watching", "📊 Live Viewers")')
                        .setRequired(false)
                        .setMaxLength(50)
                )
                .addBooleanOption(option =>
                    option.setName('show_viewers')
                        .setDescription('Show viewers field (usually 0 at stream start)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('followers_field')
                        .setDescription('Followers field name (e.g., "❤️ Community", "👥 Followers")')
                        .setRequired(false)
                        .setMaxLength(50)
                )
                .addBooleanOption(option =>
                    option.setName('show_followers')
                        .setDescription('Show followers field')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('watch_field')
                        .setDescription('Watch link field name (e.g., "📺 Join Stream", "🔗 Watch Now")')
                        .setRequired(false)
                        .setMaxLength(50)
                )
                .addStringOption(option =>
                    option.setName('open_stream_text')
                        .setDescription('Text for the stream link (e.g., "Open Stream", "Watch Live", "Join Now")')
                        .setRequired(false)
                        .setMaxLength(50)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View current notification template')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset to default notification template')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('variables')
                .setDescription('Show available template variables')
        ),

    async execute(interaction, models) {
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            switch (subcommand) {
                case 'set':
                    await this.handleSet(interaction, models, guildId);
                    break;
                case 'message':
                    await this.handleMessage(interaction, models, guildId);
                    break;
                case 'fields':
                    await this.handleFields(interaction, models, guildId);
                    break;
                case 'view':
                    await this.handleView(interaction, models, guildId);
                    break;
                case 'reset':
                    await this.handleReset(interaction, models, guildId);
                    break;
                case 'variables':
                    await this.handleVariables(interaction);
                    break;
            }
        } catch (error) {
            logger.error(`Error in template command:`, error);
            await interaction.editReply({
                content: '❌ An error occurred while managing the template. Please try again later.',

            });
        }
    },

    async handleSet(interaction, models, guildId) {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description') || '{stream_title}';

        // Validate templates contain at least one variable
        const variables = ['{streamer_name}', '{streamer_login}', '{stream_title}', '{game_name}', '{viewer_count}', '{follower_count}'];
        const titleHasVariable = variables.some(variable => title.includes(variable));

        if (!titleHasVariable) {
            return await interaction.editReply({
                content: '❌ Title template must contain at least one variable. Use `/template variables` to see available variables.',

            });
        }

        // Get current template to preserve other settings
        const currentTemplate = await models.getNotificationTemplate(guildId);

        await models.setNotificationTemplate(guildId, {
            messageText: currentTemplate?.message_text || '',
            titleTemplate: title,
            descriptionTemplate: description,
            showGame: currentTemplate?.show_game !== undefined ? currentTemplate.show_game : true,
            gameFieldName: currentTemplate?.game_field_name || '🎮 Game',
            showViewers: currentTemplate?.show_viewers !== undefined ? currentTemplate.show_viewers : false,
            viewersFieldName: currentTemplate?.viewers_field_name || '👥 Viewers',
            showFollowers: currentTemplate?.show_followers !== undefined ? currentTemplate.show_followers : true,
            followersFieldName: currentTemplate?.followers_field_name || '❤️ Followers',
            watchFieldName: currentTemplate?.watch_field_name || '📺 Watch',
            openStreamText: currentTemplate?.open_stream_text || 'Open Stream'
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Notification Template Updated')
            .setColor(0x00FF00)
            .addFields(
                {
                    name: '📝 Title Template',
                    value: `\`${title}\``,
                    inline: false
                },
                {
                    name: '📄 Description Template',
                    value: `\`${description}\``,
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Template updated for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handleMessage(interaction, models, guildId) {
        const messageText = interaction.options.getString('text') || '';

        // Get current template to preserve other settings
        const currentTemplate = await models.getNotificationTemplate(guildId);

        await models.setNotificationTemplate(guildId, {
            messageText: messageText,
            titleTemplate: currentTemplate?.title_template || '🔴 {streamer_name} is now live!',
            descriptionTemplate: currentTemplate?.description_template || '{stream_title}',
            showGame: currentTemplate?.show_game !== undefined ? currentTemplate.show_game : true,
            gameFieldName: currentTemplate?.game_field_name || '🎮 Game',
            showViewers: currentTemplate?.show_viewers !== undefined ? currentTemplate.show_viewers : false,
            viewersFieldName: currentTemplate?.viewers_field_name || '👥 Viewers',
            showFollowers: currentTemplate?.show_followers !== undefined ? currentTemplate.show_followers : true,
            followersFieldName: currentTemplate?.followers_field_name || '❤️ Followers',
            watchFieldName: currentTemplate?.watch_field_name || '📺 Watch',
            openStreamText: currentTemplate?.open_stream_text || 'Open Stream'
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Message Text Updated')
            .setColor(0x00FF00)
            .setTimestamp();

        if (messageText.trim() === '') {
            embed.setDescription('Message text has been **removed**. Only the embed will be shown in notifications.');
        } else {
            embed.addFields(
                {
                    name: '💬 Message Text',
                    value: `\`\`\`${messageText}\`\`\``,
                    inline: false
                },
                {
                    name: '🔧 Available Variables',
                    value: '`{streamer_name}` `{streamer_login}` `{stream_title}` `{game_name}` `{viewer_count}` `{follower_count}`',
                    inline: false
                }
            );
        }

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Message text updated for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handleFields(interaction, models, guildId) {
        // Get current template or create default values
        const currentTemplate = await models.getNotificationTemplate(guildId);

        const options = {
            titleTemplate: currentTemplate?.title_template || '🔴 {streamer_name} is now live!',
            descriptionTemplate: currentTemplate?.description_template || '{stream_title}',
            showGame: interaction.options.getBoolean('show_game') ?? currentTemplate?.show_game ?? true,
            gameFieldName: interaction.options.getString('game_field') || currentTemplate?.game_field_name || '🎮 Game',
            showViewers: interaction.options.getBoolean('show_viewers') ?? currentTemplate?.show_viewers ?? false,
            viewersFieldName: interaction.options.getString('viewers_field') || currentTemplate?.viewers_field_name || '👥 Viewers',
            showFollowers: interaction.options.getBoolean('show_followers') ?? currentTemplate?.show_followers ?? true,
            followersFieldName: interaction.options.getString('followers_field') || currentTemplate?.followers_field_name || '❤️ Followers',
            watchFieldName: interaction.options.getString('watch_field') || currentTemplate?.watch_field_name || '📺 Watch',
            openStreamText: interaction.options.getString('open_stream_text') || currentTemplate?.open_stream_text || 'Open Stream'
        };

        await models.setNotificationTemplate(guildId, options);

        const embed = new EmbedBuilder()
            .setTitle('✅ Notification Fields Updated')
            .setColor(0x00FF00)
            .addFields(
                {
                    name: '🎮 Game/Category Field',
                    value: `${options.showGame ? '✅' : '❌'} **${options.gameFieldName}**`,
                    inline: true
                },
                {
                    name: '👥 Viewers Field',
                    value: `${options.showViewers ? '✅' : '❌'} **${options.viewersFieldName}**`,
                    inline: true
                },
                {
                    name: '❤️ Followers Field',
                    value: `${options.showFollowers ? '✅' : '❌'} **${options.followersFieldName}**`,
                    inline: true
                },
                {
                    name: '📺 Watch Field',
                    value: `✅ **${options.watchFieldName}**`,
                    inline: true
                },
                {
                    name: '🔗 Stream Link Text',
                    value: `✅ **${options.openStreamText}**`,
                    inline: true
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Template fields updated for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handleView(interaction, models, guildId) {
        const template = await models.getNotificationTemplate(guildId);

        const embed = new EmbedBuilder()
            .setTitle('📋 Current Notification Template')
            .setColor(0x9146FF)
            .setTimestamp();

        if (template) {
            const fields = [];

            // Message text field (if configured)
            if (template.message_text && template.message_text.trim() !== '') {
                fields.push({
                    name: '💬 Message Text',
                    value: `\`\`\`${template.message_text}\`\`\``,
                    inline: false
                });
            }

            fields.push(
                {
                    name: '📝 Title Template',
                    value: `\`${template.title_template}\``,
                    inline: false
                },
                {
                    name: '📄 Description Template',
                    value: `\`${template.description_template}\``,
                    inline: false
                },
                {
                    name: '🎮 Game/Category Field',
                    value: `${template.show_game ? '✅' : '❌'} **${template.game_field_name}**`,
                    inline: true
                },
                {
                    name: '👥 Viewers Field',
                    value: `${template.show_viewers ? '✅' : '❌'} **${template.viewers_field_name}**`,
                    inline: true
                },
                {
                    name: '❤️ Followers Field',
                    value: `${template.show_followers ? '✅' : '❌'} **${template.followers_field_name}**`,
                    inline: true
                },
                {
                    name: '📺 Watch Field',
                    value: `✅ **${template.watch_field_name}**`,
                    inline: true
                },
                {
                    name: '🔗 Stream Link Text',
                    value: `✅ **${template.open_stream_text}**`,
                    inline: true
                },
                {
                    name: '🕒 Last Updated',
                    value: `<t:${Math.floor(new Date(template.updated_at).getTime() / 1000)}:R>`,
                    inline: false
                }
            );

            embed.addFields(fields);
        } else {
            embed.addFields(
                {
                    name: '📝 Title Template (Default)',
                    value: '`🔴 {streamer_name} is now live!`',
                    inline: false
                },
                {
                    name: '📄 Description Template (Default)',
                    value: '`{stream_title}`',
                    inline: false
                },
                {
                    name: '🔧 Field Settings (Default)',
                    value: [
                        '✅ **🎮 Game** - Game/Category field',
                        '❌ **👥 Viewers** - Viewers field (hidden by default)',
                        '✅ **❤️ Followers** - Followers field',
                        '✅ **📺 Watch** - Watch link field'
                    ].join('\n'),
                    inline: false
                }
            );
        }

        await interaction.editReply({ embeds: [embed] });
    },

    async handleReset(interaction, models, guildId) {
        await models.removeNotificationTemplate(guildId);

        const embed = new EmbedBuilder()
            .setTitle('🔄 Template Reset')
            .setDescription('Notification template and field settings have been reset to defaults.')
            .setColor(0x00FF00)
            .addFields(
                {
                    name: '📝 Default Title',
                    value: '`🔴 {streamer_name} is now live!`',
                    inline: false
                },
                {
                    name: '📄 Default Description',
                    value: '`{stream_title}`',
                    inline: false
                },
                {
                    name: '🔧 Default Field Settings',
                    value: [
                        '✅ **🎮 Game** - Shows currently played game/category',
                        '❌ **👥 Viewers** - Hidden (usually 0 at stream start)',
                        '✅ **❤️ Followers** - Shows total follower count',
                        '✅ **📺 Watch** - Shows link to stream'
                    ].join('\n'),
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Template reset for guild ${guildId} by ${interaction.user.tag}`);
    },

    async handleVariables(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('📝 Template Customization Guide')
            .setDescription('Complete guide to customizing your stream notifications:')
            .setColor(0x9146FF)
            .addFields(
                {
                    name: '👤 Streamer Variables',
                    value: [
                        '`{streamer_name}` - Display name (e.g., "LordBoos")',
                        '`{streamer_login}` - Username (e.g., "lordboos")'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '📺 Stream Variables',
                    value: [
                        '`{stream_title}` - Stream title',
                        '`{game_name}` - Currently played game/category',
                        '`{viewer_count}` - Current viewer count',
                        '`{follower_count}` - Total follower count'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '💡 Example Templates',
                    value: [
                        '**Title:** `🔴 {streamer_name} is playing {game_name}!`',
                        '**Description:** `"{stream_title}" - {follower_count} followers`'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🔧 Field Customization',
                    value: [
                        '**`/template fields`** - Customize field names and visibility',
                        '• **Game Field** - Show/hide and rename game/category',
                        '• **Viewers Field** - Usually hidden (0 at stream start)',
                        '• **Followers Field** - Show total follower count',
                        '• **Watch Field** - Customize the stream link text'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '📋 Quick Commands',
                    value: [
                        '`/template set` - Set title and description templates',
                        '`/template fields` - Customize field names and visibility',
                        '`/template view` - View current settings',
                        '`/template reset` - Reset to defaults'
                    ].join('\n'),
                    inline: false
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};
