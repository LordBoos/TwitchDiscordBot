const logger = require('../utils/logger');

class ClipPollingService {
    constructor(twitchAPI, models, notificationHandler) {
        this.twitchAPI = twitchAPI;
        this.models = models;
        this.notificationHandler = notificationHandler;
        this.pollingInterval = null;
        this.isPolling = false;
        this.pollIntervalMinutes = 5; // Poll every 5 minutes
    }

    start() {
        if (this.isPolling) {
            logger.warn('Clip polling service is already running');
            return;
        }

        logger.info(`Starting clip polling service (interval: ${this.pollIntervalMinutes} minutes)`);
        this.isPolling = true;

        // Run initial poll after 30 seconds
        setTimeout(() => {
            this.pollForClips();
        }, 30000);

        // Set up recurring polling
        this.pollingInterval = setInterval(() => {
            this.pollForClips();
        }, this.pollIntervalMinutes * 60 * 1000);
    }

    stop() {
        if (!this.isPolling) {
            logger.warn('Clip polling service is not running');
            return;
        }

        logger.info('Stopping clip polling service');
        this.isPolling = false;

        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    async pollForClips() {
        if (!this.isPolling) {
            return;
        }

        try {
            logger.info('Polling for new clips...');

            // Get all unique streamers being followed for clips
            const allClipFollows = await this.models.getAllClipFollows();
            const uniqueStreamers = [...new Set(allClipFollows.map(follow => follow.streamer_name))];

            if (uniqueStreamers.length === 0) {
                logger.info('No streamers being followed for clips');
                return;
            }

            logger.info(`Checking clips for ${uniqueStreamers.length} streamers`);

            for (const streamerName of uniqueStreamers) {
                try {
                    await this.checkStreamerClips(streamerName);
                } catch (error) {
                    logger.error(`Error checking clips for ${streamerName}:`, error);
                    // Continue with other streamers
                }
            }

            // Check for deleted clips
            await this.checkForDeletedClips();

            logger.info('Clip polling completed');
        } catch (error) {
            logger.error('Error during clip polling:', error);
        }
    }

    async checkStreamerClips(streamerName) {
        try {
            // Get streamer user data
            const userData = await this.twitchAPI.getUserByName(streamerName);
            if (!userData) {
                logger.warn(`Streamer ${streamerName} not found`);
                return;
            }

            // Get the last known clip timestamp for this streamer
            const lastClipTime = await this.models.getLastClipTime(streamerName);
            const checkFromTime = lastClipTime || new Date(Date.now() - (24 * 60 * 60 * 1000)); // Default to 24 hours ago

            // Get recent clips (check last 2 hours to ensure we don't miss any)
            const recentClips = await this.twitchAPI.getRecentClips(userData.id, 120);

            if (recentClips.length === 0) {
                logger.debug(`No recent clips found for ${streamerName}`);
                return;
            }

            // Filter clips that are newer than our last known clip
            const newClips = recentClips.filter(clip => {
                const clipTime = new Date(clip.created_at);
                return clipTime > checkFromTime;
            });

            if (newClips.length === 0) {
                logger.debug(`No new clips found for ${streamerName}`);
                return;
            }

            logger.info(`Found ${newClips.length} new clips for ${streamerName}`);

            // Sort clips by creation time (oldest first) to process in order
            newClips.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            // Process each new clip
            for (const clip of newClips) {
                await this.processNewClip(clip, streamerName);
            }

            // Update the last clip time to the newest clip
            const newestClip = newClips[newClips.length - 1];
            await this.models.updateLastClipTime(streamerName, new Date(newestClip.created_at));

        } catch (error) {
            logger.error(`Error checking clips for ${streamerName}:`, error);
        }
    }

    async processNewClip(clip, streamerName) {
        try {
            logger.info(`Processing new clip: ${clip.title} by ${clip.broadcaster_name}`);

            // Create a clip event object similar to what EventSub would provide
            const clipEvent = {
                id: clip.id,
                url: clip.url,
                embed_url: clip.embed_url,
                broadcaster_user_id: clip.broadcaster_id,
                broadcaster_user_login: streamerName,
                broadcaster_user_name: clip.broadcaster_name,
                creator_id: clip.creator_id,
                creator_name: clip.creator_name,
                video_id: clip.video_id,
                game_id: clip.game_id,
                language: clip.language,
                title: clip.title,
                view_count: clip.view_count,
                created_at: clip.created_at,
                thumbnail_url: clip.thumbnail_url,
                duration: clip.duration,
                vod_offset: clip.vod_offset
            };

            // Send notifications using the existing handler
            await this.notificationHandler.handleClipCreated(clipEvent);

        } catch (error) {
            logger.error(`Error processing clip ${clip.id}:`, error);
        }
    }

    async checkForDeletedClips() {
        try {
            // Get all tracked Discord messages for clips
            const allClipMessages = await this.models.db.all(`
                SELECT DISTINCT clip_id, streamer_name
                FROM clip_discord_messages
                WHERE created_at > datetime('now', '-7 days')
            `);

            if (allClipMessages.length === 0) {
                return;
            }

            logger.info(`Checking ${allClipMessages.length} clips for deletion...`);

            for (const clipRecord of allClipMessages) {
                try {
                    // Try to fetch the clip from Twitch API
                    const clipExists = await this.checkIfClipExists(clipRecord.clip_id);

                    if (!clipExists) {
                        logger.info(`Clip ${clipRecord.clip_id} was deleted, removing Discord messages`);
                        await this.handleClipDeletion(clipRecord.clip_id);
                    }
                } catch (error) {
                    logger.error(`Error checking clip ${clipRecord.clip_id}:`, error);
                }
            }
        } catch (error) {
            logger.error('Error checking for deleted clips:', error);
        }
    }

    async checkIfClipExists(clipId) {
        try {
            // Use Twitch API to check if clip exists
            const response = await this.twitchAPI.makeAPIRequest('/clips', { id: clipId });
            return response.data && response.data.length > 0;
        } catch (error) {
            // If we get a 404 or similar error, the clip probably doesn't exist
            if (error.response && (error.response.status === 404 || error.response.status === 400)) {
                return false;
            }
            // For other errors, assume the clip still exists to avoid false deletions
            logger.warn(`Could not verify clip ${clipId} existence:`, error.message);
            return true;
        }
    }

    async handleClipDeletion(clipId) {
        try {
            // Get all Discord messages for this clip
            const discordMessages = await this.models.getClipDiscordMessages(clipId);

            if (discordMessages.length === 0) {
                return;
            }

            logger.info(`Deleting ${discordMessages.length} Discord messages for clip ${clipId}`);

            // Delete each Discord message
            for (const messageRecord of discordMessages) {
                try {
                    const channel = await this.notificationHandler.discordBot.client.channels.fetch(messageRecord.channel_id);
                    if (channel) {
                        await channel.messages.delete(messageRecord.message_id);
                        logger.info(`Deleted Discord message ${messageRecord.message_id} in channel ${messageRecord.channel_id}`);
                    } else {
                        logger.warn(`Could not find channel ${messageRecord.channel_id} to delete message`);
                    }
                } catch (error) {
                    if (error.code === 10008) {
                        // Message not found - it was already deleted
                        logger.info(`Discord message ${messageRecord.message_id} was already deleted`);
                    } else {
                        logger.error(`Failed to delete Discord message ${messageRecord.message_id}:`, error);
                    }
                }
            }

            // Remove all tracking records for this clip
            await this.models.removeAllClipDiscordMessages(clipId);
            logger.info(`Cleaned up tracking records for deleted clip ${clipId}`);

        } catch (error) {
            logger.error(`Error handling clip deletion for ${clipId}:`, error);
        }
    }
}

module.exports = ClipPollingService;
