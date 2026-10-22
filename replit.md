# Discord Bot Starter

A TypeScript Discord bot starter with slash commands, secure token configuration, and a persistent bot workflow.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/discord-bot run dev` — run the Discord bot
- `pnpm --filter @workspace/discord-bot run typecheck` — check the bot package
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_BOT_TOKEN`
- Optional env: `DISCORD_GUILD_ID` — register starter slash commands to a test server for immediate availability; otherwise commands are registered globally

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `bots/discord-bot/src` — Discord client, slash command handlers, and command registration
- `bots/discord-bot/README.md` — Discord application setup and operating instructions

## Architecture decisions

- The bot runs as a persistent worker rather than a web artifact.
- Slash command synchronization updates only the starter commands and preserves other commands.

## Product

- Starter `/ping` and `/about` slash commands.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
