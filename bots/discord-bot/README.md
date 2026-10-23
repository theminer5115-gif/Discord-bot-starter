# Discord Bot Starter

A Hebrew-first Discord community helper with `!h` support requests, staff
notifications for monitored voice-channel joins, persistent message and voice
stats, XP, and `/rank`.

## Setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**
   so the bot can recognize `!h`. The bot does not save message text.
3. Invite the bot using the OAuth2 URL generator with the `bot` and
   `applications.commands` scopes. Grant View Channels, Send Messages, Embed
   Links, and Use Application Commands. If the configured roles are not
   mentionable, also grant **Mention @everyone, @here, and All Roles**.
4. Add the bot token as the Replit Secret `DISCORD_BOT_TOKEN`. Configure
   separate channels for `DISCORD_HELP_REQUEST_CHANNEL_ID` (`!h` input),
   `DISCORD_HELP_ALERT_CHANNEL_ID` (`!h` alerts),
   `DISCORD_HELP_VOICE_CHANNEL_ID` (voice monitoring), and
    `DISCORD_VOICE_ALERT_CHANNEL_ID` (voice alerts). Set comma-separated role
    IDs in `DISCORD_BASE_ALERT_ROLE_IDS` (mentioned on every help alert),
    `DISCORD_ADMIN_ROLE_IDS` (the admin escalation button), and
    `DISCORD_OWNER_ROLE_IDS` (the owners escalation button).
5. Start the **Discord Bot** workflow, or run:

   ```sh
   pnpm --filter @workspace/discord-bot run dev
   ```

## 24/7 operation and UptimeRobot

The bot's public health check is `/bot/healthz` on the published app URL. It
returns HTTP 200 only while the Discord client is ready and HTTP 503 otherwise.
The bot and API are configured as separate services in the Reserved VM
deployment, so the existing API service is preserved.

To monitor the bot, create an HTTP(S) monitor in UptimeRobot for
`https://<published-domain>/bot/healthz` and attach a Discord alert contact to
the monitor. Create that alert contact using a Discord channel webhook in
UptimeRobot; keep the webhook URL private and do not commit it to the repo.
UptimeRobot sends alerts but does not keep the bot process running.

The bot updates its `/ping`, `/about`, and `/rank` command definitions and
leaves other commands registered to the application untouched. The persistent
stats are stored in the project's PostgreSQL database.

## Commands

- `!h [פרטים]` — works only in the configured help-request text channel and
  sends a Hebrew help embed to its separate alert channel,
  mentions the configured support roles, and enforces a 10-second per-user
  cooldown. Staff can claim or close requests, or use one-time admin and owner
  escalation buttons.
- `/rank` — privately shows a member's message count, monitored voice time, XP,
  and level.
- `/ping` and `/about` — Hebrew bot status and information replies.

The bot counts non-bot messages throughout the server. Message XP is 5 per
member per 60 seconds; voice XP is 1 per minute in the configured voice
channel. Voice time is tracked only in that channel. Joining it sends a Hebrew
embed to its separate voice-alert channel and mentions the configured support
roles.

Add new slash command definitions in `src/commands.ts` and handle them in
`src/index.ts`.
