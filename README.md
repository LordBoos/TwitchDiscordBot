# Twitch → Discord Bot

A comprehensive Discord bot that monitors Twitch streamers and clips, sending real-time notifications to Discord channels using Twitch EventSub webhooks and polling-based clip detection.

## 🎯 Features

### Discord Integration
- **Slash Commands**: `/follow`, `/unfollow`, `/list`, `/status`, `/ping`, `/template`, `/clips`, `/cliptemplate`
- **Dual Command Deployment**: Both global and guild commands for immediate availability and long-term stability
- **Autocomplete**: Discord autosuggests parameters for better UX
- **Per-Channel Management**: Each Discord channel maintains its own list of followed streamers
- **Permission-Based**: All commands require ManageChannels permission for security

### Twitch Integration
- **EventSub Webhooks**: Real-time stream notifications (no polling)
- **Clip Polling**: Automatic detection of new clips with 1-minute intervals
- **Smart Subscription Management**: Automatic deduplication and cleanup
- **OAuth Token Management**: Automatic token renewal
- **Rich Stream Data**: Fetches title, category, thumbnail, viewer count, follower count

### Stream Notifications
- **Rich Embeds**: Beautiful notifications with stream info, thumbnails, and links
- **Customizable Templates**: Per-guild message templates with variable substitution
- **Game Information**: Prominently displayed game/category with optional game banner images
- **Follower Count**: Shows current follower count in notifications
- **Customizable Fields**: Toggle and customize field names (Game, Followers, Watch button text)
- **Anti-Spam Protection**: 30-second cooldown per streamer per channel
- **Role Mentions**: Optional role pings for specific game categories
- **Automatic Cleanup**: Removes unused EventSub subscriptions

### Clip Notifications
- **Real-time Clip Detection**: Polling-based system to detect new clips
- **Customizable Templates**: Line-by-line template editing with `/cliptemplate` command
- **Automatic Deletion Handling**: Removes Discord messages when clips are deleted on Twitch
- **No Cooldown**: Immediate notifications for all new clips
- **Hyperlink Support**: Direct links to clips with proper formatting

### Deployment & Infrastructure
- **Docker Ready**: Complete containerization with health checks
- **SQLite Database**: Persistent storage with automatic schema management and migrations
- **Environment Configuration**: Secure credential management
- **Production Logging**: Comprehensive logging with Winston and console output
- **Health Monitoring**: Built-in health check endpoint for monitoring
- **Automatic Migrations**: Database schema updates applied automatically on startup

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ or Docker
- Discord Bot Token and Client ID
- Twitch Client ID and Secret
- Public webhook URL (ngrok, domain, etc.)

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

# Webhook Configuration
WEBHOOK_SECRET=your_webhook_secret_here
WEBHOOK_PORT=3000
WEBHOOK_URL=https://your-domain.com/webhook

# Database Configuration
DATABASE_PATH=./data/bot.db

# Logging Configuration
LOG_LEVEL=info

# Anti-spam Configuration
NOTIFICATION_COOLDOWN_SECONDS=30
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

**Note**: Commands are automatically deployed on bot startup with dual deployment (global + guild) for immediate availability.

## 🎬 Clip Notification System

The bot features a comprehensive clip notification system that works alongside stream notifications:

### How It Works
1. **Polling-Based Detection**: Checks for new clips every minute using Twitch API
2. **Separate Following**: Use `/clips follow` to track clips independently from stream notifications
3. **Smart Deduplication**: Prevents duplicate notifications using clip ID tracking
4. **Automatic Cleanup**: Removes Discord messages when clips are deleted on Twitch
5. **Customizable Templates**: Line-by-line template editing for perfect formatting

### Setting Up Clip Notifications
```bash
# Follow a streamer for clip notifications
/clips follow streamer:ninja

# Customize the notification template
/cliptemplate view                                    # See current template
/cliptemplate setline line:1 text:🎥 New clip by {creator}!
/cliptemplate setline line:2 text:📺 {streamer} - {title}
/cliptemplate setline line:3 text:🔗 {url}

# Preview your template
/cliptemplate preview
```

### Template Editing Tips
- **Line-by-Line**: Use `/cliptemplate setline` for easy editing
- **Remove Lines**: Use `/cliptemplate removeline` to delete unwanted lines
- **No Escape Characters**: No need for `\n` - each line is handled separately
- **Variables Available**: `{streamer}`, `{creator}`, `{title}`, `{url}`

## 📋 Commands

### Stream Management
| Command | Description | Options |
|---------|-------------|---------|
| `/follow <streamer>` | Start following a Twitch streamer | `streamer`: Twitch username |
| `/unfollow <streamer>` | Stop following a streamer | `streamer`: Autocomplete from followed |
| `/list` | Show all followed streamers in channel | None |

### Stream Notification Templates
| Command | Subcommand | Description | Options |
|---------|------------|-------------|---------|
| `/template` | `set` | Set custom stream notification embed templates | `title`: Title template, `description`: Description template |
| `/template` | `message` | Set plain text message above embed | `text`: Message text (leave empty to remove) |
| `/template` | `fields` | Customize notification field names and visibility | Various field options |
| `/template` | `view` | View current template with variables | None |
| `/template` | `reset` | Reset to default template | None |
| `/template` | `variables` | Show available template variables | None |

### Clip Management
| Command | Subcommand | Description | Options |
|---------|------------|-------------|---------|
| `/clips` | `follow` | Start following clips from a streamer | `streamer`: Twitch username |
| `/clips` | `unfollow` | Stop following clips from a streamer | `streamer`: Autocomplete from followed |
| `/clips` | `list` | Show all followed streamers for clips | None |

### Clip Notification Templates
| Command | Subcommand | Description | Options |
|---------|------------|-------------|---------|
| `/cliptemplate` | `set` | Set entire clip notification template | `template`: Full template text |
| `/cliptemplate` | `setline` | Set a specific line of template | `line`: Line number (1-5), `text`: Line content |
| `/cliptemplate` | `removeline` | Remove a specific line from template | `line`: Line number to remove |
| `/cliptemplate` | `view` | View current template with line numbers | None |
| `/cliptemplate` | `reset` | Reset to default template | None |
| `/cliptemplate` | `preview` | Preview template with sample data | None |

### Bot Management
| Command | Description | Options |
|---------|-------------|---------|
| `/status` | Display bot status and subscriptions | None (ephemeral) |
| `/ping` | Test bot responsiveness | None |

### Template Variables

#### Stream Templates
- `{streamer}` - Channel name
- `{title}` - Stream title
- `{game}` - Game/category being played
- `{viewers}` - Current viewer count
- `{followers}` - Total follower count
- `{url}` - Stream URL

#### Clip Templates
- `{streamer}` - Channel name where clip was created
- `{creator}` - Username who created the clip
- `{title}` - Title of the clip
- `{url}` - Direct link to the clip

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Discord Bot   │    │  Webhook Server  │    │   Twitch API    │
│                 │    │                  │    │                 │
│ • Slash Commands│◄──►│ • EventSub       │◄──►│ • OAuth         │
│ • Notifications │    │ • Verification   │    │ • Stream Data   │
│ • Autocomplete  │    │ • Health Check   │    │ • Subscriptions │
│ • Templates     │    │ • Clip Polling   │    │ • Clip Data     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SQLite Database                             │
│                                                                 │
│ • channel_follows           • eventsub_subscriptions           │
│ • notification_cooldowns    • twitch_tokens                    │
│ • game_role_mentions        • notification_templates           │
│ • clip_follows              • clip_notification_templates      │
│ • clip_polling_state        • sent_clips                       │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### Discord Bot
- **Command Handler**: Processes slash commands with autocomplete
- **Notification System**: Sends rich embeds for streams and clips
- **Template Engine**: Customizable message templates with variable substitution
- **Permission Management**: ManageChannels permission required for all commands

#### Webhook Server
- **EventSub Handler**: Processes Twitch stream.online events
- **Clip Polling Service**: Checks for new clips every minute
- **Health Check**: Monitoring endpoint for uptime checks
- **Security**: Webhook signature verification

#### Database Layer
- **Stream Management**: Tracks followed streamers per Discord channel
- **Clip Management**: Separate tracking for clip notifications
- **Template Storage**: Per-guild customizable notification templates
- **State Management**: Polling state, cooldowns, and sent notifications

## 🔧 Configuration

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
4. Set OAuth Redirect URL (not needed for this bot)

### Webhook Configuration
- **WEBHOOK_URL**: Must be publicly accessible (use ngrok for testing)
- **WEBHOOK_SECRET**: Generate a secure random string
- **WEBHOOK_PORT**: Port for the Express server (default: 3000)

## 📊 Database Schema

The bot uses SQLite with automatic migrations and the following tables:

### Core Tables
- **channel_follows**: Maps Discord channels to followed Twitch streamers for stream notifications
- **clip_follows**: Maps Discord channels to followed Twitch streamers for clip notifications
- **eventsub_subscriptions**: Tracks active Twitch EventSub subscriptions
- **notification_cooldowns**: Prevents spam notifications with configurable cooldowns
- **twitch_tokens**: Stores OAuth tokens for Twitch API with automatic renewal

### Template System
- **notification_templates**: Per-guild customizable stream notification templates
- **clip_notification_templates**: Per-guild customizable clip notification templates

### Clip Management
- **sent_clips**: Tracks sent clip notifications to prevent duplicates and handle deletions
- **clip_polling_state**: Maintains polling state and cursor for efficient clip detection

### Optional Features
- **game_role_mentions**: Optional role mentions for specific games/categories

## 🚨 Troubleshooting

### Common Issues

**Bot not responding to commands:**
- Commands are automatically deployed on startup (no manual deployment needed)
- Check bot permissions in Discord server (ManageChannels required)
- Verify `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`
- Check logs for command deployment success messages

**Webhook verification failing:**
- Ensure `WEBHOOK_URL` is publicly accessible
- Check `WEBHOOK_SECRET` matches Twitch EventSub configuration
- Verify SSL certificate if using HTTPS

**Twitch API errors:**
- Check `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`
- Ensure Twitch application is not suspended
- Check rate limits in logs

**Clip notifications not working:**
- Verify clip polling service is running (check logs for "Polling for new clips...")
- Ensure streamers are followed with `/clips follow`
- Check database permissions for clip-related tables

**Template variables not working:**
- Use exact variable names: `{streamer}`, `{creator}`, `{title}`, `{url}`
- For line-based editing, use `/cliptemplate setline` instead of `\n` characters
- Preview templates with `/template preview` or `/cliptemplate preview`

### Logs
- **Development**: Logs to console
- **Production**: Logs to `logs/` directory
- **Docker**: Use `docker-compose logs -f` to view logs

## 🔒 Security

- Store credentials in `.env` file (never commit to git)
- Use strong `WEBHOOK_SECRET` for EventSub verification
- Run with minimal required permissions
- Regularly rotate API keys and tokens
- Use HTTPS for webhook endpoint in production

## 📈 Monitoring & Features

The bot includes comprehensive monitoring and advanced features:

### Monitoring
- **Health Check Endpoint**: `GET /health` for uptime monitoring
- **Webhook Verification**: Automatic signature validation for security
- **Database Integrity**: Automatic cleanup of orphaned subscriptions
- **Error Handling**: Comprehensive error logging and recovery
- **Migration System**: Automatic database schema updates on startup

### Advanced Features
- **Dual Command Deployment**: Both global and guild commands for immediate availability
- **Template System**: Fully customizable notification templates with variable substitution
- **Line-by-Line Editing**: Advanced clip template editing with `/cliptemplate setline`
- **Automatic Cleanup**: Removes Discord messages when Twitch clips are deleted
- **Permission Security**: All commands require ManageChannels permission
- **Polling Efficiency**: Smart clip detection with cursor-based pagination
- **Anti-Spam Protection**: Configurable cooldowns prevent notification spam

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [Discord.js](https://discord.js.org/) - Discord API library
- [Twitch API](https://dev.twitch.tv/docs/api/) - Twitch integration
- [Express.js](https://expressjs.com/) - Webhook server
- [SQLite](https://www.sqlite.org/) - Database engine