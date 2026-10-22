import {
  Client,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { registerStarterCommands, starterCommands } from "./commands.js";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!token) {
  throw new Error(
    "Missing DISCORD_BOT_TOKEN. Add your Discord bot token in Replit Secrets.",
  );
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ping") {
    await interaction.reply({
      content: `Pong! Gateway latency: ${client.ws.ping} ms.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "about") {
    await interaction.reply({
      content: `I'm ${client.user?.username ?? "a Discord bot"}, a starter bot with slash commands.`,
      ephemeral: true,
    });
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await registerStarterCommands(readyClient.application, guildId);
    const scope = guildId ? `test server ${guildId}` : "globally";
    console.info(
      `Ready as ${readyClient.user.tag}; synced ${starterCommands.length} starter commands ${scope}.`,
    );
  } catch (error) {
    console.error("Bot connected, but command registration failed:", error);
    process.exitCode = 1;
    client.destroy();
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`Failed to handle /${interaction.commandName}:`, error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "The command could not be completed. Please try again.",
        ephemeral: true,
      });
    }
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    client.destroy();
    process.exit(0);
  });
}

await client.login(token);
