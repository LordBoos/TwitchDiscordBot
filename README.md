# Twitch & Kick → Discord Bot

A comprehensive Discord bot that monitors Twitch and Kick streamers and clips, sending real-time notifications to Discord channels using webhooks and polling-based detection.

## Features

### Discord Integration
- **Slash Commands**: Full command suite for Twitch and Kick management
- **Ephemeral Responses**: All command responses are only visible to the user who invoked them
- **Dual Command Deployment**: Both global and guild commands for immediate availability
- **Autocomplete**: Discord autosuggests parameters for better UX
- **Per-Channel Management**: Each Discord channel maintains its own list of followed streamers
- **Permission-Based**: All commands require ManageChannels permission

### Twitch Integration
- **EventSub Webhooks**: Real-time stream notifications (no polling)
- **Clip Polling**: Automatic detection of new clips with 5-minute intervals
- **Clip Title Tracking**: Detects clip title changes and updates Discord messages
- **Clip Deletion Handling**: Removes Discord messages when clips are deleted on Twitch
- **Smart Subscription Management**: Automatic deduplication and cleanup
- **OAuth Token Management**: Automatic token renewal

### Kick Integration
- **Webhook Notifications**: Real-time stream notifications via Kick EventSub
- **OAuth 2.1 PKCE Flow**: Full user authorization for webhook subscriptions
- **Polling Fallback**: Automatic stream polling when webhooks aren't configured (2-minute intervals)
- **Clip Polling**: Automatic detection of new Kick clips
- **Shared Templates**: Kick notifications use the same customizable templates as Twitch
- **Rich Embeds**: Stream thumbnail, category, follower count, and profile picture

### Stream Notifications
- **Rich Embeds**: Beautiful notifications with stream info, thumbnails, and links
- **Customizable Templates**: Per-guild message templates with variable substitution
- **Game Information**: Prominently displayed game/category
- **Follower Count**: Shows current follower count in notifications
- **Stream Preview**: Large stream thumbnail screenshot in notifications
- **Customizable Fields**: Toggle and customize field names (Game, Followers, Watch button text)
- **Anti-Spam Protection**: Configurable cooldown per streamer per channel
- **Role Mentions**: Optional role pings for specific game categories

### Clip Notifications
- **Real-time Clip Detection**: Polling-based system to detect new clips
- **Customizable Templates**: Line-by-line template editing with `/cliptemplate` command
- **Automatic Deletion Handling**: Removes Discord messages when clips are deleted
- **Title Change Tracking**: Updates Discord messages when clip titles are edited
- **Startup Repair**: Automatically fixes any clip messages with wrong template formatting on restart
- **Hyperlink Support**: Direct links to clips with proper formatting

### Deployment & Infrastructure
- **Docker Ready**: Complete containerization with health checks
- **SQLite Database**: Persistent storage with automatic schema management and migrations
- **Environment Configuration**: Secure credential management
- **Production Logging**: Comprehensive logging with Winston and console output
- **Health Monitoring**: Built-in health check endpoint
- **Automatic Migrations**: Database schema updates applied automatically on startup

## Quick Start

### Prerequisites
- Node.js 18+ or Docker
- Discord Bot Token and Client ID
- Twitch Client ID and Secret
- (Optional) Kick Client ID and Secret for Kick integration
- **Public HTTPS webhook URL** (required for Twitch EventSub and Kick webhooks)

### 1. Clone and Setup
```bash
git clone <repository-url>
cd TwitchBot
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` with your credentials:
```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here

# Twitch API Configuration
TWITCH_CLIENT_ID=your_twitch_client_id_here
TWITCH_CLIENT_SECRET=your_twitch_client_secret_here

# Webhook Configuration (HTTPS REQUIRED!)
WEBHOOK_SECRET=your_webhook_secret_here
WEBHOOK_PORT=8081
WEBHOOK_URL=https://your-domain.com/webhook

# Kick API Configuration (optional)
KICK_CLIENT_ID=your_kick_client_id_here
KICK_CLIENT_SECRET=your_kick_client_secret_here

# Database Configuration
DATABASE_PATH=./data/bot.db

# Logging Configuration
LOG_LEVEL=info

# Anti-spam Configuration
NOTIFICATION_COOLDOWN_SECONDS=30
KICK_NOTIFICATION_COOLDOWN_SECONDS=300
```

### 3. Run the Bot

#### Option A: Docker (Recommended)
```bash
docker-compose up --build
```

#### Option B: Node.js
```bash
npm install
npm start
```

Commands are automatically deployed on bot startup with dual deployment (global + guild) for immediate availability.

## Kick Setup

Kick integration is optional. Without Kick credentials, only Twitch features are available.

### 1. Create a Kick App
1. Go to [Kick Developer Settings](https://kick.com/settings/developer)
2. Create a new application
3. Copy Client ID and Client Secret to `.env`
4. Enable webhooks in the developer portal
5. Set webhook URL to `https://your-domain.com/kick-webhook`
6. Set redirect URI to `https://your-domain.com/kick-auth/callback`

### 2. Authorize for Webhooks
Kick webhook subscriptions require a user access token (not just app credentials):

1. Run `/kickauth` in Discord — it generates an authorization URL
2. Open the URL in your browser and authorize the app
3. The bot exchanges the code for tokens and auto-subscribes to all followed Kick streamers
4. Tokens are stored in the database and refreshed automatically

Without user authorization, Kick stream notifications fall back to polling (2-minute delay).

## Commands

### Twitch Stream Management
| Command | Description |
|---------|-------------|
| `/follow <streamer>` | Follow a Twitch streamer for stream notifications |
| `/unfollow <streamer>` | Stop following a Twitch streamer |
| `/list` | List all followed Twitch streamers in this channel |

### Twitch Clip Management
| Command | Description |
|---------|-------------|
| `/clips follow <streamer>` | Follow a streamer for clip notifications |
| `/clips unfollow <streamer>` | Stop following clips from a streamer |
| `/clips list` | List all followed streamers for clips |

### Kick Management
| Command | Description |
|---------|-------------|
| `/kickfollow <streamer>` | Follow a Kick streamer for stream notifications |
| `/kickunfollow <streamer>` | Stop following a Kick streamer |
| `/kickclips follow <streamer>` | Follow a Kick streamer for clip notifications |
| `/kickclips unfollow <streamer>` | Stop following Kick clips from a streamer |
| `/kickclips list` | List all followed Kick streamers for clips |
| `/kickauth` | Authorize the bot for Kick webhook notifications (Admin only) |

### Notification Templates
| Command | Description |
|---------|-------------|
| `/template set` | Set custom stream notification embed templates |
| `/template message` | Set plain text message above embed |
| `/template fields` | Customize notification field names and visibility |
| `/template view` | View current template with variables |
| `/template reset` | Reset to default template |
| `/template variables` | Show available template variables |
| `/cliptemplate set` | Set entire clip notification template |
| `/cliptemplate setline` | Set a specific line of the clip template |
| `/cliptemplate removeline` | Remove a specific line from clip template |
| `/cliptemplate view` | View current clip template |
| `/cliptemplate reset` | Reset clip template to default |
| `/cliptemplate preview` | Preview clip template with sample data |

### Bot Management
| Command | Description |
|---------|-------------|
| `/status` | Display bot status and active subscriptions |
| `/ping` | Test bot responsiveness |

### Template Variables

#### Stream Templates (Twitch & Kick)
- `{streamer_name}` - Display name of the streamer
- `{streamer_login}` - Login/slug of the streamer
- `{stream_title}` - Stream title
- `{game_name}` - Game/category being played
- `{viewer_count}` - Current viewer count
- `{follower_count}` - Total follower count

#### Clip Templates
- `{streamer}` - Channel name where clip was created
- `{creator}` - Username who created the clip
- `{title}` - Title of the clip
- `{url}` - Direct link to the clip

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Discord Bot   │    │  Webhook Server  │    │   Twitch API    │
│                 │    │                  │    │                 │
│ • Slash Commands│◄──►│ • Twitch EventSub│◄──►│ • OAuth         │
│ • Notifications │    │ • Kick Webhooks  │    │ • Stream Data   │
│ • Autocomplete  │    │ • OAuth Callback │    │ • Subscriptions │
│ • Templates     │    │ • Health Check   │    │ • Clip Data     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │              ┌──────────────────┐               │
         │              │    Kick API      │               │
         │              │                  │               │
         │              │ • OAuth 2.1 PKCE │               │
         │              │ • Livestreams    │               │
         │              │ • Channels       │               │
         │              │ • Event Subs     │               │
         │              └──────────────────┘               │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite Database                             │
│                                                                 │
│ Twitch:                        Kick:                           │
│ • channel_follows              • kick_channel_follows          │
│ • eventsub_subscriptions       • kick_eventsub_subscriptions   │
│ • notification_cooldowns       • kick_notification_cooldowns   │
│ • twitch_tokens                • kick_user_tokens              │
│ • clip_follows                 • kick_clip_follows             │
│ • clip_polling_state           • kick_clip_polling_state       │
│ • clip_discord_messages        • kick_clip_discord_messages    │
│                                • kick_stream_polling_state     │
│ Shared:                                                        │
│ • notification_templates       • clip_notification_templates   │
│ • game_role_mentions                                           │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### Polling Services
- **Clip Polling Service**: Checks for new Twitch clips every 5 minutes
- **Kick Polling Service**: Checks Kick stream status (2-minute intervals) and clips when webhooks aren't available
- **Startup Repair**: Fixes clip messages with incorrect template formatting on boot

#### Webhook Server
- **Twitch EventSub**: Processes stream.online events with signature verification
- **Kick Webhooks**: Processes livestream.status.updated events with public key verification
- **Kick OAuth Callback**: Handles authorization code exchange for PKCE flow
- **Health Check**: `GET /health` endpoint for uptime monitoring

## Configuration

### Discord Bot Setup
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token for `DISCORD_TOKEN`
5. Copy the application ID for `DISCORD_CLIENT_ID`
6. Enable "Message Content Intent" if needed

### Twitch API Setup
1. Go to [Twitch Developer Console](https://dev.twitch.tv/console)
2. Create a new application
3. Copy Client ID and Client Secret

### Webhook Setup (HTTPS Required)

**Both Twitch EventSub and Kick webhooks require HTTPS.**

#### Option A: Production Domain (Recommended)
1. Use a domain with a valid SSL certificate
2. Set `WEBHOOK_URL=https://your-domain.com/webhook`
3. Ensure the webhook port is accessible from the internet

#### Option B: Testing with ngrok
1. Install ngrok: https://ngrok.com/download
2. Start your bot: `npm start`
3. In another terminal: `ngrok http 8081`
4. Set `WEBHOOK_URL=https://abc123.ngrok.io/webhook`
5. Restart the bot

#### Option C: Reverse Proxy
- Use nginx, Cloudflare Tunnel, or similar
- Ensure HTTPS termination and proper forwarding

### Webhook Endpoints
| Endpoint | Purpose |
|----------|---------|
| `POST /webhook` | Twitch EventSub notifications |
| `POST /kick-webhook` | Kick livestream event notifications |
| `GET /kick-auth/callback` | Kick OAuth authorization callback |
| `GET /health` | Health check for monitoring |

## Troubleshooting

### Common Issues

**Bot not responding to commands:**
- Commands are automatically deployed on startup
- Check bot permissions in Discord server (ManageChannels required)
- Verify `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`

**Twitch webhook verification failing:**
- Ensure `WEBHOOK_URL` is publicly accessible via HTTPS
- Verify SSL certificate is valid
- Check `WEBHOOK_SECRET` matches configuration

**Kick webhook signature verification failing:**
- Ensure webhooks are enabled in Kick developer portal
- Verify webhook URL is set to `https://your-domain.com/kick-webhook`
- Run `/kickauth` to authorize the bot with a user token

**Kick notifications missing data (no thumbnail, category, followers):**
- The bot fetches full livestream data from the API when a webhook fires
- If the unofficial API returns 403, follower count may show as 0
- Stream thumbnail requires the official API to return livestream data

**Clip notifications not working:**
- Verify clip polling service is running (check logs)
- Ensure streamers are followed with `/clips follow` or `/kickclips follow`
- Kick clips require the unofficial API to be accessible (may return 403 from some server IPs)

**Template variables not working:**
- Use exact variable names as shown in the Template Variables section
- For clip templates, use `/cliptemplate setline` for line-by-line editing
- Preview templates with `/template view` or `/cliptemplate preview`

### Logs
- **Development**: Logs to console
- **Production**: Logs to `logs/` directory
- **Docker**: Use `docker-compose logs -f` to view logs

## Security

- Store credentials in `.env` file (never commit to git)
- Use strong `WEBHOOK_SECRET` for EventSub verification
- Kick webhooks use public key signature verification
- All command responses are ephemeral (only visible to the invoker)
- Run with minimal required permissions
- Regularly rotate API keys and tokens

## Acknowledgments

- [Discord.js](https://discord.js.org/) - Discord API library
- [Twitch API](https://dev.twitch.tv/docs/api/) - Twitch integration
- [Kick API](https://kick.com/settings/developer) - Kick integration
- [Express.js](https://expressjs.com/) - Webhook server
- [SQLite](https://www.sqlite.org/) - Database engine
