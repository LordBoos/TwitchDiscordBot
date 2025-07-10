-- Discord channels and their followed streamers
CREATE TABLE IF NOT EXISTS channel_follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    streamer_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, streamer_name)
);

-- Discord channels and their followed streamers for clips
CREATE TABLE IF NOT EXISTS channel_clip_follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    streamer_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, streamer_name)
);

-- Twitch EventSub subscriptions
CREATE TABLE IF NOT EXISTS eventsub_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT UNIQUE NOT NULL,
    streamer_name TEXT NOT NULL,
    streamer_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enabled',
    subscription_type TEXT NOT NULL DEFAULT 'stream.online',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notification cooldowns to prevent spam
CREATE TABLE IF NOT EXISTS notification_cooldowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    streamer_name TEXT NOT NULL,
    last_notification DATETIME NOT NULL,
    UNIQUE(channel_id, streamer_name)
);

-- Role mentions per game category (optional feature)
CREATE TABLE IF NOT EXISTS game_role_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    role_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, game_name)
);

-- Twitch OAuth tokens
CREATE TABLE IF NOT EXISTS twitch_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Custom notification templates per guild
CREATE TABLE IF NOT EXISTS notification_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    message_text TEXT DEFAULT '',
    title_template TEXT DEFAULT '🔴 {streamer_name} is now live!',
    description_template TEXT DEFAULT '{stream_title}',
    show_game BOOLEAN DEFAULT 1,
    game_field_name TEXT DEFAULT '🎮 Game',
    show_viewers BOOLEAN DEFAULT 0,
    viewers_field_name TEXT DEFAULT '👥 Viewers',
    show_followers BOOLEAN DEFAULT 1,
    followers_field_name TEXT DEFAULT '❤️ Followers',
    watch_field_name TEXT DEFAULT '📺 Watch',
    open_stream_text TEXT DEFAULT 'Open Stream',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id)
);

-- Custom clip notification templates per guild
CREATE TABLE IF NOT EXISTS clip_notification_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    message_template TEXT DEFAULT '{creator} just created a new clip on {streamer} channel\n{title}\n{url}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id)
);

-- Clip polling state tracking
CREATE TABLE IF NOT EXISTS clip_polling_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    streamer_name TEXT UNIQUE NOT NULL,
    last_clip_time DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track Discord messages for clips so we can delete them when clips are deleted
CREATE TABLE IF NOT EXISTS clip_discord_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    streamer_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(clip_id, channel_id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_channel_follows_channel ON channel_follows(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_follows_streamer ON channel_follows(streamer_name);
CREATE INDEX IF NOT EXISTS idx_channel_clip_follows_channel ON channel_clip_follows(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_clip_follows_streamer ON channel_clip_follows(streamer_name);
CREATE INDEX IF NOT EXISTS idx_eventsub_streamer ON eventsub_subscriptions(streamer_name);
CREATE INDEX IF NOT EXISTS idx_cooldowns_lookup ON notification_cooldowns(channel_id, streamer_name);
CREATE INDEX IF NOT EXISTS idx_game_roles_guild ON game_role_mentions(guild_id);
CREATE INDEX IF NOT EXISTS idx_notification_templates_guild ON notification_templates(guild_id);
CREATE INDEX IF NOT EXISTS idx_clip_notification_templates_guild ON clip_notification_templates(guild_id);
CREATE INDEX IF NOT EXISTS idx_clip_polling_streamer ON clip_polling_state(streamer_name);
CREATE INDEX IF NOT EXISTS idx_clip_discord_messages_clip ON clip_discord_messages(clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_discord_messages_streamer ON clip_discord_messages(streamer_name);