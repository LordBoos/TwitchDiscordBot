const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class Database {
    constructor(dbPath = process.env.DATABASE_PATH || './data/bot.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    async initialize() {
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Connect to database
        await new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    logger.error('Error opening database:', err);
                    reject(err);
                } else {
                    logger.info(`Connected to SQLite database at ${this.dbPath}`);
                    resolve();
                }
            });
        });

        // Enable foreign keys
        await this.run('PRAGMA foreign_keys = ON');

        // Initialize schema
        await this.initSchema();

        // Run migrations
        await this.runMigrations();
    }

    async initSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await this.exec(schema);
        logger.info('Database schema initialized successfully');
    }

    async runMigrations() {
        try {
            // Check notification_templates columns
            const tableInfo = await this.all("PRAGMA table_info(notification_templates)");

            if (tableInfo && tableInfo.length > 0) {
                const columnNames = tableInfo.map(col => col.name);

                if (!columnNames.includes('show_game')) {
                    logger.info('Running migration: Adding new columns to notification_templates');
                    await this.run("ALTER TABLE notification_templates ADD COLUMN show_game BOOLEAN DEFAULT 1");
                    await this.run("ALTER TABLE notification_templates ADD COLUMN game_field_name TEXT DEFAULT '🎮 Game'");
                    await this.run("ALTER TABLE notification_templates ADD COLUMN show_viewers BOOLEAN DEFAULT 0");
                    await this.run("ALTER TABLE notification_templates ADD COLUMN viewers_field_name TEXT DEFAULT '👥 Viewers'");
                    await this.run("ALTER TABLE notification_templates ADD COLUMN show_followers BOOLEAN DEFAULT 1");
                    await this.run("ALTER TABLE notification_templates ADD COLUMN followers_field_name TEXT DEFAULT '❤️ Followers'");
                    await this.run("ALTER TABLE notification_templates ADD COLUMN watch_field_name TEXT DEFAULT '📺 Watch'");
                    await this.run("ALTER TABLE notification_templates ADD COLUMN open_stream_text TEXT DEFAULT 'Open Stream'");
                    logger.info('Migration completed: notification_templates updated');
                } else if (!columnNames.includes('open_stream_text')) {
                    logger.info('Running migration: Adding open_stream_text column to notification_templates');
                    await this.run("ALTER TABLE notification_templates ADD COLUMN open_stream_text TEXT DEFAULT 'Open Stream'");
                    logger.info('Migration completed: open_stream_text column added');
                }

                if (!columnNames.includes('message_text')) {
                    logger.info('Running migration: Adding message_text column to notification_templates');
                    await this.run("ALTER TABLE notification_templates ADD COLUMN message_text TEXT DEFAULT ''");
                    logger.info('Migration completed: message_text column added');
                }
            }

            // Check eventsub_subscriptions table for subscription_type column
            const eventSubTableInfo = await this.all("PRAGMA table_info(eventsub_subscriptions)");
            if (eventSubTableInfo && eventSubTableInfo.length > 0) {
                const eventSubColumnNames = eventSubTableInfo.map(col => col.name);
                if (!eventSubColumnNames.includes('subscription_type')) {
                    logger.info('Running migration: Adding subscription_type column to eventsub_subscriptions');
                    await this.run("ALTER TABLE eventsub_subscriptions ADD COLUMN subscription_type TEXT DEFAULT 'stream.online'");
                    logger.info('Migration completed: subscription_type column added');
                }
            }

            // Check if clip_polling_state table exists
            const clipTableExists = await this.all("SELECT name FROM sqlite_master WHERE type='table' AND name='clip_polling_state'");
            if (!clipTableExists || clipTableExists.length === 0) {
                logger.info('Running migration: Creating clip_polling_state table');
                await this.exec(`
                    CREATE TABLE IF NOT EXISTS clip_polling_state (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        streamer_name TEXT UNIQUE NOT NULL,
                        last_clip_time DATETIME NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX IF NOT EXISTS idx_clip_polling_streamer ON clip_polling_state(streamer_name);
                `);
                logger.info('Migration completed: clip_polling_state table created');
            }

            // Check clip_notification_templates for message_template column
            const clipTemplateTableInfo = await this.all("PRAGMA table_info(clip_notification_templates)");
            if (clipTemplateTableInfo && clipTemplateTableInfo.length > 0) {
                const clipTemplateColumnNames = clipTemplateTableInfo.map(col => col.name);
                if (!clipTemplateColumnNames.includes('message_template')) {
                    logger.info('Running migration: Adding message_template column to clip_notification_templates');
                    await this.run("ALTER TABLE clip_notification_templates ADD COLUMN message_template TEXT DEFAULT '{creator} just created a new clip on {streamer} channel\\n{title}\\n{url}'");
                    logger.info('Migration completed: message_template column added');
                }
            }

            // Check clip_discord_messages for clip_title column
            const clipDiscordMessagesTableInfo = await this.all("PRAGMA table_info(clip_discord_messages)");
            if (clipDiscordMessagesTableInfo && clipDiscordMessagesTableInfo.length > 0) {
                const clipDiscordMessagesColumnNames = clipDiscordMessagesTableInfo.map(col => col.name);
                if (!clipDiscordMessagesColumnNames.includes('clip_title')) {
                    logger.info('Running migration: Adding clip_title column to clip_discord_messages');
                    await this.run("ALTER TABLE clip_discord_messages ADD COLUMN clip_title TEXT");
                    logger.info('Migration completed: clip_title column added');
                }
            }

            // Kick tables migration
            const existingKickTables = await this.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kick_%'");
            const existing = new Set((existingKickTables || []).map(r => r.name));
            const kickTables = [
                'kick_channel_follows', 'kick_clip_follows', 'kick_eventsub_subscriptions',
                'kick_tokens', 'kick_user_tokens', 'kick_clip_polling_state',
                'kick_stream_polling_state', 'kick_notification_cooldowns',
                'kick_clip_discord_messages',
            ];
            const missing = kickTables.filter(t => !existing.has(t));

            if (missing.length > 0) {
                logger.info(`Running migration: creating missing Kick tables: ${missing.join(', ')}`);
                const schemaPath = path.join(__dirname, 'schema.sql');
                const schema = fs.readFileSync(schemaPath, 'utf8');
                await this.exec(schema);
                logger.info('Kick table migration completed successfully');
            }

            // Kick clip polling: add last_clip_time column if missing
            const kickClipPollingInfo = await this.all("PRAGMA table_info(kick_clip_polling_state)");
            if (kickClipPollingInfo && kickClipPollingInfo.length > 0) {
                const colNames = kickClipPollingInfo.map(col => col.name);
                if (!colNames.includes('last_clip_time')) {
                    logger.info('Running migration: Adding last_clip_time column to kick_clip_polling_state');
                    await this.run("ALTER TABLE kick_clip_polling_state ADD COLUMN last_clip_time DATETIME");
                    logger.info('Migration completed: last_clip_time column added');
                }
            }

        } catch (error) {
            logger.error('Migration check failed:', error);
        }
    }

    // Promise wrapper for multi-statement SQL
    exec(sql) {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Promise wrapper for database operations
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    logger.info('Database connection closed');
                    resolve();
                }
            });
        });
    }
}

module.exports = Database;
