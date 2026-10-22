import { SlashCommandBuilder } from "discord.js";

export const starterCommands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("בדיקת זמינות הבוט"),
  new SlashCommandBuilder()
    .setName("about")
    .setDescription("מידע על הבוט ועל הפקודות שלו"),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("הצגת נתוני ההודעות, הזמן הקולי והניסיון שלך"),
];

export async function registerStarterCommands(
  application: {
    commands: {
      fetch: (options?: { guildId?: string }) => Promise<{
        find: (
          predicate: (command: { name: string; id: string }) => boolean,
        ) => { name: string; id: string } | undefined;
      }>;
      edit: (
        id: string,
        command: ReturnType<(typeof starterCommands)[number]["toJSON"]>,
        guildId?: string,
      ) => Promise<unknown>;
      create: (
        command: ReturnType<(typeof starterCommands)[number]["toJSON"]>,
        guildId?: string,
      ) => Promise<unknown>;
    };
    id: string;
  },
  guildId?: string,
) {
  const commands = await application.commands.fetch(
    guildId ? { guildId } : undefined,
  );

  for (const command of starterCommands) {
    const definition = command.toJSON();
    const existing = commands.find(
      (registeredCommand) => registeredCommand.name === definition.name,
    );

    if (existing) {
      await application.commands.edit(existing.id, definition, guildId);
    } else {
      await application.commands.create(definition, guildId);
    }
  }
}
