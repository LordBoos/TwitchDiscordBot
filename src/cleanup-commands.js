require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🧹 Cleaning up old Discord commands...');

        // Delete all global commands
        console.log('Fetching existing global commands...');
        const globalCommands = await rest.get(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
        );

        console.log(`Found ${globalCommands.length} global commands to delete`);

        for (const command of globalCommands) {
            console.log(`Deleting global command: ${command.name}`);
            await rest.delete(
                Routes.applicationCommand(process.env.DISCORD_CLIENT_ID, command.id)
            );
        }

        // Delete guild-specific commands for your test guild
        const guildId = '188751304502280192';
        console.log(`Fetching existing guild commands for guild ${guildId}...`);
        const guildCommands = await rest.get(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId)
        );

        console.log(`Found ${guildCommands.length} guild commands to delete`);

        for (const command of guildCommands) {
            console.log(`Deleting guild command: ${command.name}`);
            await rest.delete(
                Routes.applicationGuildCommand(process.env.DISCORD_CLIENT_ID, guildId, command.id)
            );
        }

        console.log('✅ All old commands have been cleaned up!');
        console.log('Now run "npm run deploy-commands" to add the new commands.');

    } catch (error) {
        console.error('❌ Error cleaning up commands:', error);

        if (error.code === 10002) {
            console.log('ℹ️  This error usually means the application ID is incorrect or the bot doesn\'t exist.');
        }

        process.exit(1);
    }
})();