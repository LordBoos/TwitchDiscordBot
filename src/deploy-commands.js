require('dotenv').config();
const { REST, Routes, Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Load all commands
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
        console.log(`Loaded command: ${command.data.name}`);
    } else {
        console.warn(`Command at ${filePath} is missing required "data" or "execute" property`);
    }
}

// Deploy commands
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Create a temporary client to fetch guilds
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // Deploy commands globally for all guilds
        console.log('Deploying commands globally...');
        const globalData = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );
        console.log(`✅ Successfully deployed ${globalData.length} global commands (will propagate in ~1 hour)`);

        // Login to Discord to fetch guilds
        console.log('Logging in to fetch guild list...');
        await client.login(process.env.DISCORD_TOKEN);

        // Wait a moment for the client to be ready
        await new Promise(resolve => {
            if (client.isReady()) {
                resolve();
            } else {
                client.once('ready', resolve);
            }
        });

        // Get all guilds the bot is in
        const guilds = client.guilds.cache;
        console.log(`Found ${guilds.size} guilds. Deploying commands to each guild for immediate availability...`);

        let successCount = 0;
        let errorCount = 0;

        // Deploy to each guild
        for (const [guildId, guild] of guilds) {
            try {
                console.log(`Deploying to guild: ${guild.name} (${guildId})`);
                await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
                    { body: commands },
                );
                successCount++;
                console.log(`  ✅ Successfully deployed to ${guild.name}`);
            } catch (error) {
                errorCount++;
                console.error(`  ❌ Failed to deploy to ${guild.name} (${guildId}):`, error.message);
            }
        }

        // Cleanup
        client.destroy();

        console.log('\n📊 Deployment Summary:');
        console.log(`✅ Global deployment: Success (will propagate in ~1 hour)`);
        console.log(`✅ Guild deployments: ${successCount}/${guilds.size} successful`);
        if (errorCount > 0) {
            console.log(`❌ Failed deployments: ${errorCount}`);
        }
        console.log('🎉 Commands are now available immediately in all successfully deployed guilds!');

    } catch (error) {
        console.error('Error deploying commands:', error);
        if (client.isReady()) {
            client.destroy();
        }
        process.exit(1);
    }
})();