const logger = require('../utils/logger');

// Interval constants
const STREAM_POLL_INTERVAL_MS = 2 * 60 * 1000;  // 2 minutes
const CLIP_POLL_INTERVAL_MS   = 5 * 60 * 1000;  // 5 minutes
const INITIAL_DELAY_MS        = 30 * 1000;       // 30 seconds

class KickPollingService {
    constructor(kickAPI, models, notificationHandler) {
        this.kickAPI = kickAPI;
        this.models = models;
        this.notificationHandler = notificationHandler;
        this.streamPollTimer = null;
        this.clipPollTimer = null;

        // Poll stream status unless we have a user token for webhook subscriptions.
        // Having client credentials alone is NOT enough for webhooks — the events:subscribe
        // scope requires a user access token obtained via the OAuth authorization code flow.
        this.pollStreams = !kickAPI.hasUserToken;
    }

    start() {
        logger.info(`Kick polling service starting (stream polling: ${this.pollStreams ? 'enabled' : 'disabled — using webhooks'})`);

        setTimeout(async () => {
            if (this.pollStreams) await this.pollStreamStatus();
            await this.pollForClips();
        }, INITIAL_DELAY_MS);

        if (this.pollStreams) {
            this.streamPollTimer = setInterval(() => this.pollStreamStatus(), STREAM_POLL_INTERVAL_MS);
        }

        this.clipPollTimer = setInterval(() => this.pollForClips(), CLIP_POLL_INTERVAL_MS);

        logger.info('Kick polling service started');
    }

    stop() {
        if (this.streamPollTimer) clearInterval(this.streamPollTimer);
        if (this.clipPollTimer)  clearInterval(this.clipPollTimer);
        logger.info('Kick polling service stopped');
    }

    // -------------------------------------------------------------------------
    // Stream live-status polling (used when no Kick credentials / webhooks)
    // -------------------------------------------------------------------------

    async pollStreamStatus() {
        try {
            const follows = await this.models.getAllKickChannelFollows();
            const slugs = [...new Set(follows.map(f => f.streamer_slug))];

            for (const slug of slugs) {
                await this.checkStreamerLive(slug);
            }
        } catch (error) {
            logger.error('Error polling Kick stream status:', error);
        }
    }

    async checkStreamerLive(slug) {
        try {
            // Get broadcaster_user_id if available (needed for official API)
            const channelFollows = await this.models.getAllKickFollowsForStreamer(slug);
            const broadcasterUserId = channelFollows.find(f => f.broadcaster_user_id)?.broadcaster_user_id ?? null;

            const livestream = await this.kickAPI.getLivestream(slug, broadcasterUserId);
            const isLive = !!livestream;

            const prevState = await this.models.getKickStreamState(slug);
            const wasLive = prevState?.is_live === 1;

            await this.models.setKickStreamState(slug, isLive);

            // Only notify on offline → online transition
            if (isLive && !wasLive) {
                logger.info(`Kick: ${slug} just went live (detected via polling)`);
                await this.notificationHandler.handleKickStreamOnline(slug, livestream);
            }
        } catch (error) {
            logger.error(`Error checking Kick live status for ${slug}:`, error.message);
        }
    }

    // -------------------------------------------------------------------------
    // Clip polling (always active – no official Kick clip webhook exists)
    // -------------------------------------------------------------------------

    async pollForClips() {
        try {
            const clipFollows = await this.models.getAllKickClipFollows();
            const slugs = [...new Set(clipFollows.map(f => f.streamer_slug))];

            if (slugs.length === 0) {
                logger.debug('Kick clip polling: no streamers followed for clips');
                return;
            }

            logger.info(`Kick clip polling: checking ${slugs.length} streamer(s): ${slugs.join(', ')}`);

            for (const slug of slugs) {
                await this.checkStreamerClips(slug);
            }

            logger.info('Kick clip polling completed');
        } catch (error) {
            logger.error('Error polling Kick clips:', error);
        }
    }

    async checkStreamerClips(slug) {
        try {
            // Get broadcaster_user_id — try channel follows first, fall back to API lookup
            const channelFollows = await this.models.getAllKickFollowsForStreamer(slug);
            let broadcasterUserId = channelFollows.find(f => f.broadcaster_user_id)?.broadcaster_user_id ?? null;

            if (!broadcasterUserId) {
                // No stream follow or no stored ID — look up the channel via API
                const channel = await this.kickAPI.getChannelBySlug(slug);
                broadcasterUserId = channel?.user?.id || channel?.id || null;
            }

            const clips = await this.kickAPI.getRecentClips(slug, broadcasterUserId);
            if (!clips || clips.length === 0) return;

            // Sort oldest first so we process / notify in creation order
            const sorted = clips.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            const state = await this.models.getKickClipPollingState(slug);
            const lastClipId = state?.last_clip_id;

            if (!lastClipId) {
                // First run – seed state with newest clip and skip notifications
                const latest = sorted[sorted.length - 1];
                await this.models.setKickClipPollingState(slug, latest.id.toString());
                return;
            }

            const lastIdx = sorted.findIndex(c => c.id.toString() === lastClipId);
            if (lastIdx === -1) {
                // Previous clip no longer in results – update to newest
                await this.models.setKickClipPollingState(slug, sorted[sorted.length - 1].id.toString());
                return;
            }

            const newClips = sorted.slice(lastIdx + 1);
            if (newClips.length === 0) return;

            logger.info(`Kick: found ${newClips.length} new clip(s) for ${slug}`);
            await this.models.setKickClipPollingState(slug, newClips[newClips.length - 1].id.toString());

            for (const clip of newClips) {
                await this.notificationHandler.handleKickClipCreated(slug, clip);
            }
        } catch (error) {
            logger.error(`Error checking Kick clips for ${slug}:`, error.message);
        }
    }
}

module.exports = KickPollingService;
