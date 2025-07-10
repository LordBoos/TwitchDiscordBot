const Models = require('../src/database/models');
const fs = require('fs');
const path = require('path');

describe('Database Models', () => {
    let models;
    const testDbPath = './test.db';

    beforeEach(async () => {
        // Use in-memory database for testing
        process.env.DATABASE_PATH = ':memory:';
        models = new Models();

        // Wait a bit for database initialization
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(async () => {
        if (models) {
            await models.close();
        }

        // Clean up test database file if it exists
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    describe('Channel Follows', () => {
        test('should add and retrieve channel follow', async () => {
            const guildId = '123456789';
            const channelId = '987654321';
            const streamerName = 'teststreamer';

            await models.addChannelFollow(guildId, channelId, streamerName);
            const follows = await models.getChannelFollows(channelId);

            expect(follows).toHaveLength(1);
            expect(follows[0].streamer_name).toBe(streamerName.toLowerCase());
            expect(follows[0].guild_id).toBe(guildId);
            expect(follows[0].channel_id).toBe(channelId);
        });

        test('should prevent duplicate follows', async () => {
            const guildId = '123456789';
            const channelId = '987654321';
            const streamerName = 'teststreamer';

            await models.addChannelFollow(guildId, channelId, streamerName);
            await models.addChannelFollow(guildId, channelId, streamerName);

            const follows = await models.getChannelFollows(channelId);
            expect(follows).toHaveLength(1);
        });

        test('should remove channel follow', async () => {
            const guildId = '123456789';
            const channelId = '987654321';
            const streamerName = 'teststreamer';

            await models.addChannelFollow(guildId, channelId, streamerName);
            await models.removeChannelFollow(channelId, streamerName);

            const follows = await models.getChannelFollows(channelId);
            expect(follows).toHaveLength(0);
        });
    });

    describe('Notification Cooldowns', () => {
        test('should not be on cooldown initially', async () => {
            const channelId = '987654321';
            const streamerName = 'teststreamer';

            const onCooldown = await models.isNotificationOnCooldown(channelId, streamerName, 30);
            expect(onCooldown).toBe(false);
        });

        test('should be on cooldown after update', async () => {
            const channelId = '987654321';
            const streamerName = 'teststreamer';

            await models.updateNotificationCooldown(channelId, streamerName);
            const onCooldown = await models.isNotificationOnCooldown(channelId, streamerName, 30);

            expect(onCooldown).toBe(true);
        });
    });
});