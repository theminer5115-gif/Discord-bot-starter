import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type Message,
  type MessageCreateOptions,
} from "discord.js";
import { registerStarterCommands, starterCommands } from "./commands.js";
import {
  checkpointAllVoiceSessions,
  checkpointVoiceSession,
  getMemberRankStats,
  recordMessage,
  resetVoiceSessions,
  startVoiceSession,
} from "./stats.js";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const voiceChannelId = process.env.DISCORD_HELP_VOICE_CHANNEL_ID?.trim();
const staffChannelId = process.env.DISCORD_STAFF_CHANNEL_ID?.trim();
const HELP_COOLDOWN_MS = 10_000;
const helpCooldowns = new Map<string, number>();

if (!token) {
  throw new Error(
    "Missing DISCORD_BOT_TOKEN. Add your Discord bot token in Replit Secrets.",
  );
}

if (!voiceChannelId || !staffChannelId) {
  throw new Error(
    "Missing Discord channel configuration. Set DISCORD_HELP_VOICE_CHANNEL_ID and DISCORD_STAFF_CHANNEL_ID.",
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ping") {
    await interaction.reply({
      content: `הבוט פועל. זמן התגובה לשרת: ${client.ws.ping} מילישניות.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "about") {
    await interaction.reply({
      content: "אני עוזר/ת לקהילה: אפשר לבקש עזרה עם ‎!h ולבדוק נתונים עם ‎/rank.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "rank") {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "הפקודה זמינה בתוך שרת בלבד.",
        ephemeral: true,
      });
      return;
    }

    const stats = await getMemberRankStats(
      interaction.guildId,
      interaction.user.id,
    );
    const level = Math.floor(stats.xp / 100) + 1;
    const progress = stats.xp % 100;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`הנתונים של ${interaction.user.username}`)
          .setThumbnail(interaction.user.displayAvatarURL())
          .addFields(
            {
              name: "הודעות שנשלחו",
              value: stats.messageCount.toLocaleString("he-IL"),
              inline: true,
            },
            {
              name: "זמן בערוץ הקולי",
              value: formatVoiceTime(stats.voiceSeconds),
              inline: true,
            },
            {
              name: "ניסיון (XP)",
              value: stats.xp.toLocaleString("he-IL"),
              inline: true,
            },
            {
              name: "רמה",
              value: `${level} · ${progress}/100 XP לרמה הבאה`,
              inline: true,
            },
          )
          .setFooter({
            text: "XP מתקבל מהודעות ומהשתתפות בערוץ הקולי המוגדר",
          })
          .setTimestamp(),
      ],
      ephemeral: true,
    });
  }
}

function formatVoiceTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours} שעות`);
  if (minutes > 0) parts.push(`${minutes} דקות`);
  if (parts.length === 0 || (hours === 0 && minutes === 0)) {
    parts.push(`${seconds} שניות`);
  }

  return parts.join(" ו־");
}

type StaffChannel = {
  guildId: string;
  send: (options: MessageCreateOptions) => Promise<unknown>;
};

async function getStaffChannel(): Promise<StaffChannel> {
  const channel = await client.channels.fetch(staffChannelId!);
  if (
    !channel?.isTextBased() ||
    !("guildId" in channel) ||
    !("send" in channel) ||
    typeof channel.send !== "function" ||
    typeof channel.guildId !== "string"
  ) {
    throw new Error("ערוץ ההתראות לצוות אינו ערוץ טקסט זמין.");
  }
  return channel as StaffChannel;
}

async function handleHelpRequest(message: Message) {
  const now = Date.now();
  const cooldownEndsAt = helpCooldowns.get(message.author.id) ?? 0;

  if (cooldownEndsAt > now) {
    const secondsRemaining = Math.ceil((cooldownEndsAt - now) / 1000);
    await message.reply({
      content: `אפשר לשלוח בקשת עזרה נוספת בעוד ${secondsRemaining} שניות.`,
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const cooldownKey = message.author.id;
  helpCooldowns.set(cooldownKey, now + HELP_COOLDOWN_MS);

  try {
    const staffChannel = await getStaffChannel();
    const reason = message.content.slice(2).trim().slice(0, 1000);
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("בקשת עזרה מהקהילה")
      .setDescription(
        `**חבר/ת הקהילה:** <@${message.author.id}>\n**ערוץ:** <#${message.channelId}>`,
      )
      .addFields({
        name: "פרטים",
        value: reason || "לא נמסרו פרטים נוספים.",
      })
      .addFields({
        name: "הודעה",
        value: `[פתיחת ההודעה בשרת](${message.url})`,
      })
      .setTimestamp();

    await staffChannel.send({
      content: "@here",
      embeds: [embed],
      allowedMentions: { parse: ["everyone"] },
    });
    await message.reply({
      content: "בקשת העזרה נשלחה לצוות. הצוות יגיע אליך בהקדם.",
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    helpCooldowns.delete(cooldownKey);
    console.error("שליחת בקשת העזרה נכשלה:", error);
    await message.reply({
      content: "לא הצלחתי לשלוח את הבקשה לצוות. כדאי לפנות לאחד מאנשי הצוות.",
      allowedMentions: { repliedUser: false },
    });
  }
}

async function initializeChannels() {
  const voiceChannel = await client.channels.fetch(voiceChannelId!);
  const staffChannel = await getStaffChannel();

  if (!voiceChannel?.isVoiceBased()) {
    throw new Error("המזהה שהוגדר לערוץ הקולי אינו מצביע על ערוץ קולי.");
  }
  if (staffChannel.guildId !== voiceChannel.guildId) {
    throw new Error("ערוץ הקול וערוץ הצוות חייבים להיות באותו שרת.");
  }

  const activeMemberIds = [...voiceChannel.members.values()]
    .filter((member) => !member.user.bot)
    .map((member) => member.id);
  await resetVoiceSessions(voiceChannel.guildId, activeMemberIds);

  return voiceChannel.guildId;
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    const configuredGuildId = await initializeChannels();
    await registerStarterCommands(readyClient.application, guildId);
    const scope = guildId ? `בשרת ${guildId}` : "באופן גלובלי";
    console.info(
      `הבוט מחובר כ־${readyClient.user.tag}; סונכרנו ${starterCommands.length} פקודות ${scope}.`,
    );
    console.info(
      `מעקב הפעילות הופעל בשרת ${configuredGuildId}; תזכורות עזרה נשלחות לערוץ הצוות שהוגדר.`,
    );

    const checkpointTimer = setInterval(() => {
      void checkpointAllVoiceSessions().catch((error) => {
        console.error("שמירת זמן השיחה הקולית נכשלה:", error);
      });
    }, 60_000);
    checkpointTimer.unref();
  } catch (error) {
    console.error("הפעלת הבוט נכשלה:", error);
    process.exitCode = 1;
    client.destroy();
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`הפעלת הפקודה /${interaction.commandName} נכשלה:`, error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "הפקודה לא הצליחה. כדאי לנסות שוב בעוד רגע.",
        ephemeral: true,
      });
    }
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  try {
    await recordMessage(message.guild.id, message.author.id);
  } catch (error) {
    console.error("שמירת ספירת ההודעות נכשלה:", error);
  }

  if (/^!h(?:\s|$)/i.test(message.content)) {
    await handleHelpRequest(message);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (!newState.guild || newState.member?.user.bot) return;

  const leftMonitoredChannel = oldState.channelId === voiceChannelId;
  const joinedMonitoredChannel = newState.channelId === voiceChannelId;
  if (leftMonitoredChannel === joinedMonitoredChannel) return;

  if (leftMonitoredChannel) {
    await checkpointVoiceSession(
      oldState.guild.id,
      oldState.id,
      new Date(),
      true,
    );
    return;
  }

  try {
    await startVoiceSession(newState.guild.id, newState.id);
    const staffChannel = await getStaffChannel();
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("חבר/ת קהילה זקוק/ה לעזרת צוות")
      .setDescription(
        `**חבר/ת הקהילה:** <@${newState.id}>\n**ערוץ קולי:** <#${voiceChannelId}>\nהמשתמש/ת הצטרף/ה וממתין/ה לעזרת צוות.`,
      )
      .setTimestamp();

    await staffChannel.send({
      content: "@here",
      embeds: [embed],
      allowedMentions: { parse: ["everyone"] },
    });
  } catch (error) {
    console.error("שליחת התראת כניסה לערוץ הקולי נכשלה:", error);
  }
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await checkpointAllVoiceSessions();
  } catch (error) {
    console.error("שמירת נתוני השיחה הקולית לפני עצירה נכשלה:", error);
  }
  client.destroy();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown());
}

await client.login(token);
