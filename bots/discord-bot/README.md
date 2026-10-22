# Discord Bot Starter

A small TypeScript bot that connects through Discord's Gateway and provides
`/ping` and `/about` slash commands. It requests only the `Guilds` gateway
intent; it does not read message content or require privileged intents.

## Setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Add a bot user and copy its token into the Replit Secret named
   `DISCORD_BOT_TOKEN`. Never put the token in source files or chat.
3. Invite the bot using the OAuth2 URL generator with the `bot` and
   `applications.commands` scopes. Grant only the server permissions it needs,
   such as View Channels and Send Messages.
4. Optionally set `DISCORD_GUILD_ID` to a test server ID. Guild commands appear
   quickly; without it, commands are registered globally and may take time to
   appear.
5. Start the **Discord Bot** workflow, or run:

   ```sh
   pnpm --filter @workspace/discord-bot run dev
   ```

The bot updates only its `/ping` and `/about` command definitions and leaves
other commands registered to the application untouched.

## Commands

- `/ping` — replies with the current Gateway latency.
- `/about` — describes the starter bot.

Add new slash command definitions in `src/commands.ts` and handle them in
`src/index.ts`.
