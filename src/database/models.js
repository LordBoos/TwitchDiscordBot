const Database = require('./database');

class Models {
    constructor() {
        this.db = new Database();
    }

    // Channel follows operations
    async addChannelFollow(guildId, channelId, streamerName) {
        const sql = `
            INSERT OR IGNORE INTO channel_follows (guild_id, channel_id, streamer_name)
            VALUES (?, ?, ?)
        `;
        return await this.db.run(sql, [guildId, channelId, streamerName.toLowerCase()]);
    }

    async removeChannelFollow(channelId, streamerName) {
        const sql = `
            DELETE FROM channel_follows
            WHERE channel_id = ? AND streamer_name = ?
        `;
        return await this.db.run(sql, [channelId, streamerName.toLowerCase()]);
    }

    // Clip follow operations
    async addChannelClipFollow(guildId, channelId, streamerName) {
        const sql = `
            INSERT OR IGNORE INTO channel_clip_follows
            (guild_id, channel_id, streamer_name)
            VALUES (?, ?, ?)
        `;
        return await this.db.run(sql, [guildId, channelId, streamerName.toLowerCase()]);
    }

    async getChannelClipFollows(channelId) {
        const sql = `
            SELECT * FROM channel_clip_follows
            WHERE channel_id = ?
            ORDER BY streamer_name
        `;
        return await this.db.all(sql, [channelId]);
    }

    async getAllClipFollows() {
        const sql = `
            SELECT * FROM channel_clip_follows
            ORDER BY streamer_name
        `;
        return await this.db.all(sql);
    }

    async removeChannelClipFollow(channelId, streamerName) {
        const sql = `
            DELETE FROM channel_clip_follows
            WHERE channel_id = ? AND streamer_name = ?
        `;
        return await this.db.run(sql, [channelId, streamerName.toLowerCase()]);
    }

    async getChannelFollows(channelId) {
        const sql = `
            SELECT * FROM channel_follows
            WHERE channel_id = ?
            ORDER BY streamer_name
        `;
        return await this.db.all(sql, [channelId]);
    }

    async getAllFollowsForStreamer(streamerName) {
        const sql = `
            SELECT * FROM channel_follows
            WHERE streamer_name = ?
        `;
        return await this.db.all(sql, [streamerName.toLowerCase()]);
    }

    // EventSub subscription operations
    async addEventSubSubscription(subscriptionId, streamerName, streamerId, status = 'enabled', type = 'stream.online') {
        const sql = `
            INSERT OR REPLACE INTO eventsub_subscriptions
            (subscription_id, streamer_name, streamer_id, status, subscription_type, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [subscriptionId, streamerName.toLowerCase(), streamerId, status, type]);
    }

    async removeEventSubSubscription(streamerName, type = 'stream.online') {
        const sql = `
            DELETE FROM eventsub_subscriptions
            WHERE streamer_name = ? AND subscription_type = ?
        `;
        return await this.db.run(sql, [streamerName.toLowerCase(), type]);
    }

    async getEventSubSubscription(streamerName, type = 'stream.online') {
        const sql = `
            SELECT * FROM eventsub_subscriptions
            WHERE streamer_name = ? AND subscription_type = ? AND status = 'enabled'
        `;
        return await this.db.get(sql, [streamerName.toLowerCase(), type]);
    }

    async getAllEventSubSubscriptions() {
        const sql = `
            SELECT * FROM eventsub_subscriptions
            WHERE status = 'enabled'
        `;
        return await this.db.all(sql);
    }

    // Notification cooldown operations
    async isNotificationOnCooldown(channelId, streamerName, cooldownSeconds = 30) {
        const sql = `
            SELECT last_notification FROM notification_cooldowns
            WHERE channel_id = ? AND streamer_name = ?
        `;
        const result = await this.db.get(sql, [channelId, streamerName.toLowerCase()]);

        if (!result) return false;

        const lastNotification = new Date(result.last_notification);
        const now = new Date();
        const timeDiff = (now - lastNotification) / 1000; // seconds

        return timeDiff < cooldownSeconds;
    }

    async updateNotificationCooldown(channelId, streamerName) {
        const sql = `
            INSERT OR REPLACE INTO notification_cooldowns
            (channel_id, streamer_name, last_notification)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [channelId, streamerName.toLowerCase()]);
    }

    // Twitch token operations
    async saveToken(accessToken, refreshToken, expiresAt) {
        const sql = `
            INSERT OR REPLACE INTO twitch_tokens
            (id, access_token, refresh_token, expires_at, updated_at)
            VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [accessToken, refreshToken, expiresAt]);
    }

    async getToken() {
        const sql = `
            SELECT * FROM twitch_tokens WHERE id = 1
        `;
        return await this.db.get(sql);
    }

    // Game role mention operations (optional feature)
    async addGameRoleMention(guildId, gameName, roleId) {
        const sql = `
            INSERT OR REPLACE INTO game_role_mentions
            (guild_id, game_name, role_id)
            VALUES (?, ?, ?)
        `;
        return await this.db.run(sql, [guildId, gameName, roleId]);
    }

    async getGameRoleMention(guildId, gameName) {
        const sql = `
            SELECT * FROM game_role_mentions
            WHERE guild_id = ? AND game_name = ?
        `;
        return await this.db.get(sql, [guildId, gameName]);
    }

    // Notification template operations
    async setNotificationTemplate(guildId, options) {
        const {
            messageText,
            titleTemplate,
            descriptionTemplate,
            showGame = true,
            gameFieldName = '🎮 Game',
            showViewers = false,
            viewersFieldName = '👥 Viewers',
            showFollowers = true,
            followersFieldName = '❤️ Followers',
            watchFieldName = '📺 Watch',
            openStreamText = 'Open Stream'
        } = options;

        const sql = `
            INSERT OR REPLACE INTO notification_templates
            (guild_id, message_text, title_template, description_template, show_game, game_field_name,
             show_viewers, viewers_field_name, show_followers, followers_field_name,
             watch_field_name, open_stream_text, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [
            guildId, messageText, titleTemplate, descriptionTemplate, showGame, gameFieldName,
            showViewers, viewersFieldName, showFollowers, followersFieldName, watchFieldName, openStreamText
        ]);
    }

    async getNotificationTemplate(guildId) {
        const sql = `
            SELECT * FROM notification_templates
            WHERE guild_id = ?
        `;
        return await this.db.get(sql, [guildId]);
    }

    async removeNotificationTemplate(guildId) {
        const sql = `
            DELETE FROM notification_templates
            WHERE guild_id = ?
        `;
        return await this.db.run(sql, [guildId]);
    }

    // Clip notification template operations
    async setClipNotificationTemplate(guildId, messageTemplate) {
        const sql = `
            INSERT OR REPLACE INTO clip_notification_templates
            (guild_id, message_template, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [guildId, messageTemplate]);
    }

    async getClipNotificationTemplate(guildId) {
        const sql = `
            SELECT * FROM clip_notification_templates
            WHERE guild_id = ?
        `;
        return await this.db.get(sql, [guildId]);
    }

    async removeClipNotificationTemplate(guildId) {
        const sql = `
            DELETE FROM clip_notification_templates
            WHERE guild_id = ?
        `;
        return await this.db.run(sql, [guildId]);
    }

    // Clip Discord message tracking operations
    async addClipDiscordMessage(clipId, channelId, messageId, streamerName, clipTitle = null) {
        const sql = `
            INSERT OR REPLACE INTO clip_discord_messages
            (clip_id, channel_id, message_id, streamer_name, clip_title)
            VALUES (?, ?, ?, ?, ?)
        `;
        return await this.db.run(sql, [clipId, channelId, messageId, streamerName, clipTitle]);
    }

    async getClipDiscordMessages(clipId) {
        const sql = `
            SELECT * FROM clip_discord_messages
            WHERE clip_id = ?
        `;
        return await this.db.all(sql, [clipId]);
    }

    async removeClipDiscordMessage(clipId, channelId) {
        const sql = `
            DELETE FROM clip_discord_messages
            WHERE clip_id = ? AND channel_id = ?
        `;
        return await this.db.run(sql, [clipId, channelId]);
    }

    async removeAllClipDiscordMessages(clipId) {
        const sql = `
            DELETE FROM clip_discord_messages
            WHERE clip_id = ?
        `;
        return await this.db.run(sql, [clipId]);
    }

    async updateClipTitle(clipId, newTitle) {
        const sql = `
            UPDATE clip_discord_messages
            SET clip_title = ?
            WHERE clip_id = ?
        `;
        return await this.db.run(sql, [newTitle, clipId]);
    }

    async getClipsByTitle(streamerName) {
        const sql = `
            SELECT DISTINCT clip_id, clip_title
            FROM clip_discord_messages
            WHERE streamer_name = ? AND clip_title IS NOT NULL
        `;
        return await this.db.all(sql, [streamerName]);
    }

    // Cleanup operations
    async cleanupOrphanedSubscriptions() {
        // Remove EventSub subscriptions that have no corresponding channel follows
        const sql = `
            DELETE FROM eventsub_subscriptions
            WHERE streamer_name NOT IN (
                SELECT DISTINCT streamer_name FROM channel_follows
            )
        `;
        return await this.db.run(sql);
    }

    // Clip polling tracking methods
    async getLastClipTime(streamerName) {
        const sql = `
            SELECT last_clip_time FROM clip_polling_state
            WHERE streamer_name = ?
        `;
        const result = await this.db.get(sql, [streamerName.toLowerCase()]);
        return result ? new Date(result.last_clip_time) : null;
    }

    async updateLastClipTime(streamerName, clipTime) {
        const sql = `
            INSERT OR REPLACE INTO clip_polling_state
            (streamer_name, last_clip_time, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [streamerName.toLowerCase(), clipTime.toISOString()]);
    }

    async removeClipPollingState(streamerName) {
        const sql = `
            DELETE FROM clip_polling_state
            WHERE streamer_name = ?
        `;
        return await this.db.run(sql, [streamerName.toLowerCase()]);
    }

    async close() {
        return await this.db.close();
    }

    // =========================================================================
    // Kick channel follow operations
    // =========================================================================

    async addKickChannelFollow(guildId, channelId, streamerSlug, broadcasterUserId = null) {
        const sql = `
            INSERT OR IGNORE INTO kick_channel_follows
            (guild_id, channel_id, streamer_slug, broadcaster_user_id)
            VALUES (?, ?, ?, ?)
        `;
        return await this.db.run(sql, [guildId, channelId, streamerSlug.toLowerCase(), broadcasterUserId]);
    }

    async removeKickChannelFollow(channelId, streamerSlug) {
        const sql = `
            DELETE FROM kick_channel_follows
            WHERE channel_id = ? AND streamer_slug = ?
        `;
        return await this.db.run(sql, [channelId, streamerSlug.toLowerCase()]);
    }

    async getKickChannelFollows(channelId) {
        const sql = `
            SELECT * FROM kick_channel_follows
            WHERE channel_id = ?
            ORDER BY streamer_slug
        `;
        return await this.db.all(sql, [channelId]);
    }

    async getAllKickChannelFollows() {
        const sql = `SELECT * FROM kick_channel_follows ORDER BY streamer_slug`;
        return await this.db.all(sql);
    }

    async getAllKickFollowsForStreamer(streamerSlug) {
        const sql = `
            SELECT * FROM kick_channel_follows
            WHERE streamer_slug = ?
        `;
        return await this.db.all(sql, [streamerSlug.toLowerCase()]);
    }

    async getKickChannelFollow(channelId, streamerSlug) {
        const sql = `
            SELECT * FROM kick_channel_follows
            WHERE channel_id = ? AND streamer_slug = ?
        `;
        return await this.db.get(sql, [channelId, streamerSlug.toLowerCase()]);
    }

    // =========================================================================
    // Kick clip follow operations
    // =========================================================================

    async addKickClipFollow(guildId, channelId, streamerSlug) {
        const sql = `
            INSERT OR IGNORE INTO kick_clip_follows
            (guild_id, channel_id, streamer_slug)
            VALUES (?, ?, ?)
        `;
        return await this.db.run(sql, [guildId, channelId, streamerSlug.toLowerCase()]);
    }

    async removeKickClipFollow(channelId, streamerSlug) {
        const sql = `
            DELETE FROM kick_clip_follows
            WHERE channel_id = ? AND streamer_slug = ?
        `;
        return await this.db.run(sql, [channelId, streamerSlug.toLowerCase()]);
    }

    async getKickClipFollows(channelId) {
        const sql = `
            SELECT * FROM kick_clip_follows
            WHERE channel_id = ?
            ORDER BY streamer_slug
        `;
        return await this.db.all(sql, [channelId]);
    }

    async getAllKickClipFollows() {
        const sql = `SELECT * FROM kick_clip_follows ORDER BY streamer_slug`;
        return await this.db.all(sql);
    }

    async getKickClipFollowsForStreamer(streamerSlug) {
        const sql = `
            SELECT * FROM kick_clip_follows
            WHERE streamer_slug = ?
        `;
        return await this.db.all(sql, [streamerSlug.toLowerCase()]);
    }

    // =========================================================================
    // Kick EventSub subscription operations
    // =========================================================================

    async addKickEventSubSubscription(subscriptionId, streamerSlug, broadcasterUserId, eventType = 'livestream.status.updated') {
        const sql = `
            INSERT OR REPLACE INTO kick_eventsub_subscriptions
            (subscription_id, streamer_slug, broadcaster_user_id, event_type)
            VALUES (?, ?, ?, ?)
        `;
        return await this.db.run(sql, [subscriptionId, streamerSlug.toLowerCase(), broadcasterUserId, eventType]);
    }

    async getKickEventSubSubscription(streamerSlug, eventType = 'livestream.status.updated') {
        const sql = `
            SELECT * FROM kick_eventsub_subscriptions
            WHERE streamer_slug = ? AND event_type = ?
        `;
        return await this.db.get(sql, [streamerSlug.toLowerCase(), eventType]);
    }

    async removeKickEventSubSubscription(streamerSlug, eventType = 'livestream.status.updated') {
        const sql = `
            DELETE FROM kick_eventsub_subscriptions
            WHERE streamer_slug = ? AND event_type = ?
        `;
        return await this.db.run(sql, [streamerSlug.toLowerCase(), eventType]);
    }

    async getAllKickEventSubSubscriptions() {
        const sql = `SELECT * FROM kick_eventsub_subscriptions`;
        return await this.db.all(sql);
    }

    // =========================================================================
    // Kick token operations
    // =========================================================================

    async saveKickToken(accessToken, expiresAt) {
        const sql = `
            INSERT OR REPLACE INTO kick_tokens
            (id, access_token, expires_at, updated_at)
            VALUES (1, ?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [accessToken, expiresAt.toISOString()]);
    }

    async getKickToken() {
        const sql = `SELECT * FROM kick_tokens WHERE id = 1`;
        return await this.db.get(sql);
    }

    // =========================================================================
    // Kick user token operations (OAuth authorization code + PKCE flow)
    // =========================================================================

    async saveKickUserToken(accessToken, refreshToken, expiresAt, scope = null) {
        const sql = `
            INSERT OR REPLACE INTO kick_user_tokens
            (id, access_token, refresh_token, expires_at, scope, updated_at)
            VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [accessToken, refreshToken, expiresAt.toISOString(), scope]);
    }

    async getKickUserToken() {
        const sql = `SELECT * FROM kick_user_tokens WHERE id = 1`;
        return await this.db.get(sql);
    }

    async deleteKickUserToken() {
        const sql = `DELETE FROM kick_user_tokens WHERE id = 1`;
        return await this.db.run(sql);
    }

    // =========================================================================
    // Kick clip polling state
    // =========================================================================

    async getKickClipPollingState(streamerSlug) {
        const sql = `
            SELECT * FROM kick_clip_polling_state
            WHERE streamer_slug = ?
        `;
        return await this.db.get(sql, [streamerSlug.toLowerCase()]);
    }

    async setKickClipPollingState(streamerSlug, lastClipId) {
        const sql = `
            INSERT OR REPLACE INTO kick_clip_polling_state
            (streamer_slug, last_clip_id, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [streamerSlug.toLowerCase(), lastClipId]);
    }

    async removeKickClipPollingState(streamerSlug) {
        const sql = `DELETE FROM kick_clip_polling_state WHERE streamer_slug = ?`;
        return await this.db.run(sql, [streamerSlug.toLowerCase()]);
    }

    // =========================================================================
    // Kick stream polling state (live/offline tracking)
    // =========================================================================

    async getKickStreamState(streamerSlug) {
        const sql = `
            SELECT * FROM kick_stream_polling_state
            WHERE streamer_slug = ?
        `;
        return await this.db.get(sql, [streamerSlug.toLowerCase()]);
    }

    async setKickStreamState(streamerSlug, isLive) {
        const sql = `
            INSERT OR REPLACE INTO kick_stream_polling_state
            (streamer_slug, is_live, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [streamerSlug.toLowerCase(), isLive ? 1 : 0]);
    }

    // =========================================================================
    // Kick notification cooldowns
    // =========================================================================

    async isKickNotificationOnCooldown(channelId, streamerSlug, cooldownSeconds) {
        const sql = `
            SELECT last_notification FROM kick_notification_cooldowns
            WHERE channel_id = ? AND streamer_slug = ?
        `;
        const result = await this.db.get(sql, [channelId, streamerSlug.toLowerCase()]);
        if (!result) return false;

        const timeDiff = (new Date() - new Date(result.last_notification)) / 1000;
        return timeDiff < cooldownSeconds;
    }

    async updateKickNotificationCooldown(channelId, streamerSlug) {
        const sql = `
            INSERT OR REPLACE INTO kick_notification_cooldowns
            (channel_id, streamer_slug, last_notification)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [channelId, streamerSlug.toLowerCase()]);
    }

    // =========================================================================
    // Kick clip Discord message tracking
    // =========================================================================

    async addKickClipDiscordMessage(clipId, channelId, messageId, streamerSlug) {
        const sql = `
            INSERT OR REPLACE INTO kick_clip_discord_messages
            (clip_id, channel_id, message_id, streamer_slug)
            VALUES (?, ?, ?, ?)
        `;
        return await this.db.run(sql, [clipId, channelId, messageId, streamerSlug.toLowerCase()]);
    }

    async getKickClipDiscordMessages(clipId) {
        const sql = `SELECT * FROM kick_clip_discord_messages WHERE clip_id = ?`;
        return await this.db.all(sql, [clipId]);
    }

    async removeKickClipDiscordMessages(clipId) {
        const sql = `DELETE FROM kick_clip_discord_messages WHERE clip_id = ?`;
        return await this.db.run(sql, [clipId]);
    }
    // =========================================================================
    // Twitch↔Kick sync operations
    // =========================================================================

    async addTwitchKickSync(twitchSlug, kickSlug, twitchUserId = null) {
        const sql = `
            INSERT OR REPLACE INTO twitch_kick_sync
            (twitch_slug, kick_slug, twitch_user_id, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `;
        return await this.db.run(sql, [twitchSlug.toLowerCase(), kickSlug.toLowerCase(), twitchUserId]);
    }

    async removeTwitchKickSync(twitchSlug, kickSlug) {
        const sql = `DELETE FROM twitch_kick_sync WHERE twitch_slug = ? AND kick_slug = ?`;
        return await this.db.run(sql, [twitchSlug.toLowerCase(), kickSlug.toLowerCase()]);
    }

    async getTwitchKickSync(twitchSlug, kickSlug) {
        const sql = `SELECT * FROM twitch_kick_sync WHERE twitch_slug = ? AND kick_slug = ?`;
        return await this.db.get(sql, [twitchSlug.toLowerCase(), kickSlug.toLowerCase()]);
    }

    async getSyncsByTwitchSlug(twitchSlug) {
        const sql = `SELECT * FROM twitch_kick_sync WHERE twitch_slug = ?`;
        return await this.db.all(sql, [twitchSlug.toLowerCase()]);
    }

    async getAllTwitchKickSyncs() {
        const sql = `SELECT * FROM twitch_kick_sync`;
        return await this.db.all(sql);
    }

    async saveSyncKickToken(twitchSlug, kickSlug, accessToken, refreshToken, expiresAt, scope = null) {
        const sql = `
            UPDATE twitch_kick_sync
            SET kick_access_token = ?, kick_refresh_token = ?, kick_token_expires_at = ?,
                kick_token_scope = ?, updated_at = CURRENT_TIMESTAMP
            WHERE twitch_slug = ? AND kick_slug = ?
        `;
        return await this.db.run(sql, [
            accessToken, refreshToken, expiresAt.toISOString(), scope,
            twitchSlug.toLowerCase(), kickSlug.toLowerCase()
        ]);
    }
}

module.exports = Models;