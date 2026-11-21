jest.mock('axios');
const axios = require('axios');
const Models = require('../src/database/models');
const KickAPI = require('../src/handlers/kickAPI');

const HOUR = 60 * 60 * 1000;

describe('Kick sync token refresh', () => {
    let models, kick, lost;

    beforeEach(async () => {
        process.env.DATABASE_PATH = ':memory:';
        process.env.KICK_CLIENT_ID = 'id';
        process.env.KICK_CLIENT_SECRET = 'secret';
        models = new Models();
        await new Promise(resolve => setTimeout(resolve, 100)); // schema init
        kick = new KickAPI(models);
        lost = [];
        kick.onSyncAuthLost = async (row) => { lost.push(row.kick_slug); };
        axios.post.mockReset();

        await models.addTwitchKickSync('jenna', 'jenna13', '119', 'chan', 'user');
        await models.saveSyncKickToken('jenna', 'jenna13', 'AT1', 'RT1', new Date(Date.now() - 1000), 'channel:write');
    });

    afterEach(async () => { await models.close(); });

    const row = () => models.getTwitchKickSync('jenna', 'jenna13');

    test('concurrent refreshes hit Kick once and rotate the refresh token', async () => {
        axios.post.mockResolvedValue({ data: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 7200 } });
        const stale = await row();

        const tokens = await Promise.all([kick.getSyncToken(stale), kick.getSyncToken(stale)]);
        expect(tokens).toEqual(['AT2', 'AT2']);
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect((await row()).kick_refresh_token).toBe('RT2');

        // A caller still holding the pre-refresh row must not burn RT2 with the old RT1.
        expect(await kick.getSyncToken(stale)).toBe('AT2');
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    test('keeps the old refresh token when Kick does not return a new one', async () => {
        axios.post.mockResolvedValue({ data: { access_token: 'AT2', expires_in: 7200 } });
        await kick.getSyncToken(await row());
        const r = await row();
        expect(r.kick_refresh_token).toBe('RT1');
        expect(r.kick_token_scope).toBe('channel:write');
    });

    test('rejected refresh token clears the authorization and reports it once', async () => {
        axios.post.mockRejectedValue({ response: { status: 401, data: { error: 'invalid_grant' } } });
        expect(await kick.getSyncToken(await row())).toBeNull();
        const r = await row();
        expect(r.kick_access_token).toBeNull();
        expect(r.kick_refresh_token).toBeNull();
        expect(lost).toEqual(['jenna13']);

        // Nothing left to refresh – no further Kick calls, no repeated reports.
        await kick.refreshExpiringSyncTokens();
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(lost).toEqual(['jenna13']);
    });

    test.each([
        ['network error', { code: 'ECONNRESET', message: 'socket hang up' }],
        ['403 from a proxy', { response: { status: 403, data: 'Forbidden' } }],
        ['5xx', { response: { status: 502, data: 'Bad Gateway' } }],
    ])('%s keeps the tokens and does not report', async (_, failure) => {
        axios.post.mockRejectedValue(failure);
        expect(await kick.getSyncToken(await row())).toBeNull();
        expect((await row()).kick_refresh_token).toBe('RT1');
        expect(lost).toEqual([]);
    });

    test('re-running /sync add keeps the notices, successful re-authorization deletes them', async () => {
        const notices = JSON.stringify([{ channelId: 'chan', messageId: 'm1' }]);
        await models.setSyncAuthNotices((await row()).id, notices);
        await models.addTwitchKickSync('jenna', 'jenna13', '119', 'chan2', 'user2');
        const readded = await row();
        expect(readded.discord_notice_messages).toBe(notices);
        expect(readded.discord_channel_id).toBe('chan2');

        const WebhookServer = require('../src/handlers/webhookServer');
        const deleted = [];
        const bot = { deleteSyncAuthNotices: async (s) => { deleted.push(s.discord_notice_messages); } };
        const kickStub = { exchangeSyncCodeForToken: async () => ({ twitchSlug: 'jenna', kickSlug: 'jenna13' }) };
        const server = new WebhookServer(models, {}, bot, kickStub);
        const res = { status() { return this; }, send() { return this; } };
        await server.handleSyncOAuthCallback('code', 'state', res);
        expect(deleted).toEqual([notices]);
    });

    test('channel.update for an unauthorized pair reminds in Twitch chat, rate-limited', async () => {
        const WebhookServer = require('../src/handlers/webhookServer');
        const reminders = [];
        const bot = { remindSyncAuthInTwitchChat: async (s) => { reminders.push(s.kick_slug); } };
        const server = new WebhookServer(models, {}, bot, kick);
        await models.clearSyncKickToken((await row()).id);

        const event = { broadcaster_user_login: 'jenna', title: 'x', category_name: 'y' };
        await server.handleChannelUpdate(event);
        await server.handleChannelUpdate(event);
        expect(reminders).toEqual(['jenna13']);
    });

    test('401 from PATCH forces a refresh even though the token looks valid', async () => {
        await models.saveSyncKickToken('jenna', 'jenna13', 'AT1', 'RT1', new Date(Date.now() + HOUR), null);
        axios.post.mockResolvedValue({ data: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 7200 } });
        expect(await kick.refreshSyncToken(await row(), { rejectedToken: 'AT1' })).toBe('AT2');
        expect(axios.post).toHaveBeenCalledTimes(1);
    });

    test('periodic check refreshes only tokens close to expiry', async () => {
        await models.saveSyncKickToken('jenna', 'jenna13', 'AT1', 'RT1', new Date(Date.now() + 2 * HOUR), null);
        await kick.refreshExpiringSyncTokens();
        expect(axios.post).not.toHaveBeenCalled();

        await models.saveSyncKickToken('jenna', 'jenna13', 'AT1', 'RT1', new Date(Date.now() + 30 * 60 * 1000), null);
        axios.post.mockResolvedValue({ data: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 7200 } });
        await kick.refreshExpiringSyncTokens();
        expect(axios.post).toHaveBeenCalledTimes(1);
    });
});
