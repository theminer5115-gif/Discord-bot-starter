# Discord Bot Starter

A TypeScript Discord bot starter with slash commands, secure token configuration, and a persistent bot workflow.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/discord-bot run dev` — run the Discord bot
- `pnpm --filter @workspace/discord-bot run typecheck` — check the bot package
- `pnpm --filter @workspace/db run push` — apply development database schema changes
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_BOT_TOKEN`
- Required env: `DISCORD_HELP_VOICE_CHANNEL_ID`, `DISCORD_HELP_REQUEST_CHANNEL_ID`, `DISCORD_HELP_ALERT_CHANNEL_ID`, `DISCORD_VOICE_ALERT_CHANNEL_ID`, `DISCORD_BASE_ALERT_ROLE_IDS`, `DISCORD_ADMIN_ROLE_IDS`, `DISCORD_OWNER_ROLE_IDS`
- Optional env: `DISCORD_GUILD_ID` — register slash commands to a test server for immediate availability; otherwise commands are registered globally

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `bots/discord-bot/src` — Discord client, Hebrew help/rank handlers, and persistent activity tracking
- `bots/discord-bot/README.md` — Discord application setup and operating instructions
- `lib/db/src/schema/discord.ts` — persistent Discord member stats and voice sessions

## Architecture decisions

- The bot runs as a persistent worker rather than a web artifact.
- Slash command synchronization updates only its own commands and preserves other commands.
- XP and activity totals use the shared PostgreSQL database; voice sessions checkpoint periodically.

## Product

- Hebrew help requests, role-based staff alerts and escalations, XP, message and voice tracking, and `/rank`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
