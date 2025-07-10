const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class Database {
    constructor(dbPath = process.env.DATABASE_PATH || './data/bot.db') {
        this.dbPath = dbPath;
        this.db = null;
        this.init();
    }

    init() {
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Connect to database
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                logger.error('Error opening database:', err);
                throw err;
            }
            logger.info(`Connected to SQLite database at ${this.dbPath}`);
        });

        // Enable foreign keys
        this.db.run('PRAGMA foreign_keys = ON');

        // Initialize schema
        this.initSchema();
    }

    initSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        this.db.exec(schema, (err) => {
            if (err) {
                logger.error('Error initializing database schema:', err);
                throw err;
            }

            // Run migrations after schema initialization
            this.runMigrations();

            logger.info('Database schema initialized successfully');
        });
    }

    runMigrations() {
        try {
            // Check if notification_templates table exists and has new columns
            this.db.all("PRAGMA table_info(notification_templates)", (err, tableInfo) => {
                if (err) {
                    logger.error('Error checking table info:', err);
                    return;
                }

                if (tableInfo && tableInfo.length > 0) {
                    const columnNames = tableInfo.map(col => col.name);

                    // Migration: Add new columns to notification_templates if they don't exist
                    if (!columnNames.includes('show_game')) {
                        logger.info('Running migration: Adding new columns to notification_templates');

                        const migrationSQL = `
                            ALTER TABLE notification_templates ADD COLUMN show_game BOOLEAN DEFAULT 1;
                            ALTER TABLE notification_templates ADD COLUMN game_field_name TEXT DEFAULT '🎮 Game';
                            ALTER TABLE notification_templates ADD COLUMN show_viewers BOOLEAN DEFAULT 0;
                            ALTER TABLE notification_templates ADD COLUMN viewers_field_name TEXT DEFAULT '👥 Viewers';
                            ALTER TABLE notification_templates ADD COLUMN show_followers BOOLEAN DEFAULT 1;
                            ALTER TABLE notification_templates ADD COLUMN followers_field_name TEXT DEFAULT '❤️ Followers';
                            ALTER TABLE notification_templates ADD COLUMN watch_field_name TEXT DEFAULT '📺 Watch';
                            ALTER TABLE notification_templates ADD COLUMN open_stream_text TEXT DEFAULT 'Open Stream';
                        `;

                        this.db.exec(migrationSQL, (migrationErr) => {
                            if (migrationErr) {
                                logger.error('Migration failed:', migrationErr);
                            } else {
                                logger.info('Migration completed: notification_templates updated');
                            }
                        });
                    } else if (!columnNames.includes('open_stream_text')) {
                        // Additional migration for open_stream_text if other columns exist but this one is missing
                        logger.info('Running migration: Adding open_stream_text column to notification_templates');

                        this.db.run("ALTER TABLE notification_templates ADD COLUMN open_stream_text TEXT DEFAULT 'Open Stream'", (migrationErr) => {
                            if (migrationErr) {
                                logger.error('Migration failed for open_stream_text:', migrationErr);
                            } else {
                                logger.info('Migration completed: open_stream_text column added');
                            }
                        });
                    }
                }

                // Check eventsub_subscriptions table for subscription_type column
                this.db.all("PRAGMA table_info(eventsub_subscriptions)", (err2, eventSubTableInfo) => {
                    if (err2) {
                        logger.error('Error checking eventsub_subscriptions table info:', err2);
                        return;
                    }

                    if (eventSubTableInfo && eventSubTableInfo.length > 0) {
                        const eventSubColumnNames = eventSubTableInfo.map(col => col.name);

                        if (!eventSubColumnNames.includes('subscription_type')) {
                            logger.info('Running migration: Adding subscription_type column to eventsub_subscriptions');

                            this.db.run("ALTER TABLE eventsub_subscriptions ADD COLUMN subscription_type TEXT DEFAULT 'stream.online'", (migrationErr) => {
                                if (migrationErr) {
                                    logger.error('Migration failed for subscription_type:', migrationErr);
                                } else {
                                    logger.info('Migration completed: subscription_type column added');
                                }
                            });
                        }
                    }
                });

                // Check if clip_polling_state table exists
                this.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='clip_polling_state'", (err3, clipTableExists) => {
                    if (err3) {
                        logger.error('Error checking clip_polling_state table:', err3);
                        return;
                    }

                    if (!clipTableExists || clipTableExists.length === 0) {
                        logger.info('Running migration: Creating clip_polling_state table');

                        const createTableSQL = `
                            CREATE TABLE IF NOT EXISTS clip_polling_state (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                streamer_name TEXT UNIQUE NOT NULL,
                                last_clip_time DATETIME NOT NULL,
                                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                            );
                            CREATE INDEX IF NOT EXISTS idx_clip_polling_streamer ON clip_polling_state(streamer_name);
                        `;

                        this.db.exec(createTableSQL, (migrationErr) => {
                            if (migrationErr) {
                                logger.error('Migration failed for clip_polling_state:', migrationErr);
                            } else {
                                logger.info('Migration completed: clip_polling_state table created');
                            }
                        });
                    }
                });

                // Check if clip_notification_templates table has message_template column
                this.db.all("PRAGMA table_info(clip_notification_templates)", (err4, clipTemplateTableInfo) => {
                    if (err4) {
                        logger.error('Error checking clip_notification_templates table info:', err4);
                        return;
                    }

                    if (clipTemplateTableInfo && clipTemplateTableInfo.length > 0) {
                        const clipTemplateColumnNames = clipTemplateTableInfo.map(col => col.name);

                        if (!clipTemplateColumnNames.includes('message_template')) {
                            logger.info('Running migration: Adding message_template column to clip_notification_templates');

                            this.db.run("ALTER TABLE clip_notification_templates ADD COLUMN message_template TEXT DEFAULT '{creator} just created a new clip on {streamer} channel\\n{title}\\n{url}'", (migrationErr) => {
                                if (migrationErr) {
                                    logger.error('Migration failed for message_template:', migrationErr);
                                } else {
                                    logger.info('Migration completed: message_template column added');
                                }
                            });
                        }
                    }
                });

                // Check if notification_templates table has message_text column
                this.db.all("PRAGMA table_info(notification_templates)", (err5, notificationTemplateTableInfo) => {
                    if (err5) {
                        logger.error('Error checking notification_templates table info:', err5);
                        return;
                    }

                    if (notificationTemplateTableInfo && notificationTemplateTableInfo.length > 0) {
                        const notificationTemplateColumnNames = notificationTemplateTableInfo.map(col => col.name);

                        if (!notificationTemplateColumnNames.includes('message_text')) {
                            logger.info('Running migration: Adding message_text column to notification_templates');

                            this.db.run("ALTER TABLE notification_templates ADD COLUMN message_text TEXT DEFAULT ''", (migrationErr) => {
                                if (migrationErr) {
                                    logger.error('Migration failed for message_text:', migrationErr);
                                } else {
                                    logger.info('Migration completed: message_text column added');
                                }
                            });
                        }
                    }
                });

            });
        } catch (error) {
            logger.error('Migration check failed:', error);
        }
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