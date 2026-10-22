import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type MessageCreateOptions,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { registerStarterCommands, starterCommands } from "./commands.js";
import {
  checkpointAllVoiceSessions,
  checkpointVoiceSession,
  claimHelpRequest,
  closeHelpRequest,
  createHelpRequest,
  deleteHelpRequest,
  getGuildLeaderboard,
  getHelpRequest,
  getMemberRankStats,
  type HelpRequest,
  type HelpRequestEscalation,
  LEADERBOARD_LIMIT,
  pingHelpRequestRole,
  recordMessage,
  rollbackHelpRequestRolePing,
  resetVoiceSessions,
  startVoiceSession,
} from "./stats.js";

function readRequiredRoleIds(environmentKey: string) {
  const roleIds = (process.env[environmentKey] ?? "")
    .split(",")
    .map((roleId) => roleId.trim())
    .filter(Boolean);
  if (roleIds.length === 0 || roleIds.some((roleId) => !/^\d{17,20}$/.test(roleId))) {
    throw new Error(`מזהי התפקידים ב־${environmentKey} חסרים או אינם תקינים.`);
  }
  return [...new Set(roleIds)];
}

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const voiceChannelId = process.env.DISCORD_HELP_VOICE_CHANNEL_ID?.trim();
const helpRequestChannelId = process.env.DISCORD_HELP_REQUEST_CHANNEL_ID?.trim();
const helpAlertChannelId = process.env.DISCORD_HELP_ALERT_CHANNEL_ID?.trim();
const voiceAlertChannelId = process.env.DISCORD_VOICE_ALERT_CHANNEL_ID?.trim();
const baseAlertRoleIds = readRequiredRoleIds("DISCORD_BASE_ALERT_ROLE_IDS");
const adminRoleIds = readRequiredRoleIds("DISCORD_ADMIN_ROLE_IDS");
const ownerRoleIds = readRequiredRoleIds("DISCORD_OWNER_ROLE_IDS");
const HELP_COOLDOWN_MS = 10_000;
const helpCooldowns = new Map<string, number>();

if (!token) {
  throw new Error(
    "Missing DISCORD_BOT_TOKEN. Add your Discord bot token in Replit Secrets.",
  );
}

if (
  !voiceChannelId ||
  !helpRequestChannelId ||
  !helpAlertChannelId ||
  !voiceAlertChannelId
) {
  throw new Error(
    "Missing Discord channel configuration. Set the voice, help-request, help-alert, and voice-alert channel IDs.",
  );
}

if (helpAlertChannelId === voiceAlertChannelId) {
  throw new Error("ערוץ ההתראות של !h ושל הקול חייבים להיות שונים.");
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
      content:
        "אני עוזר/ת לקהילה: אפשר לבקש עזרה עם ‎!h, לבדוק נתונים עם ‎/rank ולראות את טבלת המובילים עם ‎/leaderboard.",
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
    return;
  }

  if (interaction.commandName === "leaderboard") {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "הפקודה זמינה בתוך שרת בלבד.",
        ephemeral: true,
      });
      return;
    }

    const entries = await getGuildLeaderboard(
      interaction.guildId,
      LEADERBOARD_LIMIT,
    );
    const description =
      entries.length > 0
        ? entries
            .map(
              ({ userId, xp }, index) =>
                `**${index + 1}.** <@${userId}> — **${xp.toLocaleString("he-IL")} XP** · רמה ${Math.floor(xp / 100) + 1}`,
            )
            .join("\n")
        : "עדיין אין נתוני XP להצגה.";

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("טבלת מובילי ה־XP")
          .setDescription(description)
          .setFooter({
            text: `מוצגים עד ${LEADERBOARD_LIMIT} חברים לפי XP`,
          })
          .setTimestamp(),
      ],
      allowedMentions: { parse: [] },
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
  send: (options: MessageCreateOptions) => Promise<Message>;
};

async function getAlertChannel(channelId: string): Promise<StaffChannel> {
  const channel = await client.channels.fetch(channelId);
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

const getHelpAlertChannel = () => getAlertChannel(helpAlertChannelId!);
const getVoiceAlertChannel = () => getAlertChannel(voiceAlertChannelId!);

function buildHelpRequestEmbed(request: HelpRequest) {
  const statusLabel = {
    open: "ממתינה לטיפול",
    claimed: "בטיפול",
    closed: "נסגרה",
  }[request.status];
  const embed = new EmbedBuilder()
    .setColor(
      request.status === "closed"
        ? 0x2ecc71
        : request.status === "claimed"
          ? 0xf1c40f
          : 0xe74c3c,
    )
    .setTitle(
      request.requestType === "voice"
        ? "חבר/ת קהילה זקוק/ה לעזרת צוות"
        : "בקשת עזרה מהקהילה",
    )
    .setDescription(
      `**חבר/ת הקהילה:** <@${request.requesterId}>\n**ערוץ:** <#${request.sourceChannelId}>`,
    )
    .addFields(
      { name: "פרטים", value: request.details || "לא נמסרו פרטים נוספים." },
      { name: "סטטוס", value: statusLabel, inline: true },
      {
        name: "נלקחה לטיפול על ידי",
        value: request.claimedBy ? `<@${request.claimedBy}>` : "עדיין לא נלקחה",
        inline: true,
      },
      {
        name: "התראת מנהלים",
        value: request.adminPingedAt ? "נשלחה" : "לא נשלחה",
        inline: true,
      },
      {
        name: "התראת בעלים",
        value: request.ownerPingedAt ? "נשלחה" : "לא נשלחה",
        inline: true,
      },
    );

  if (request.sourceMessageUrl) {
    embed.addFields({
      name: "הודעה",
      value: `[פתיחת ההודעה בשרת](${request.sourceMessageUrl})`,
    });
  }
  if (request.closedBy) {
    embed.addFields({
      name: "נסגרה על ידי",
      value: `<@${request.closedBy}>`,
      inline: true,
    });
  }

  return embed.setTimestamp(request.createdAt);
}

function buildHelpRequestButtons(request: HelpRequest) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`help-request:claim:${request.requestId}`)
      .setLabel("לקחת לטיפול")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(request.status !== "open"),
    new ButtonBuilder()
      .setCustomId(`help-request:close:${request.requestId}`)
      .setLabel("סגירת בקשה")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(request.status === "closed"),
    new ButtonBuilder()
      .setCustomId(`help-request:admin:${request.requestId}`)
      .setLabel("הזעקת מנהלים")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(request.status === "closed" || request.adminPingedAt !== null),
    new ButtonBuilder()
      .setCustomId(`help-request:owner:${request.requestId}`)
      .setLabel("הזעקת בעלים")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(request.status === "closed" || request.ownerPingedAt !== null),
  );
}

function getRequestAlertChannel(request: HelpRequest) {
  return request.requestType === "voice"
    ? getVoiceAlertChannel()
    : getHelpAlertChannel();
}

async function sendHelpRequestAlert(input: {
  guildId: string;
  requesterId: string;
  sourceChannelId: string;
  sourceMessageUrl?: string;
  requestType: "message" | "voice";
  details: string;
}) {
  const request = await createHelpRequest({
    requestId: randomUUID(),
    ...input,
    sourceMessageUrl: input.sourceMessageUrl ?? null,
    status: "open",
    claimedBy: null,
    closedBy: null,
  });

  try {
    const alertChannel = await getRequestAlertChannel(request);
    if (alertChannel.guildId !== request.guildId) {
      throw new Error("ההתראה נשלחה מערוץ שאינו שייך לשרת המוגדר.");
    }
    await alertChannel.send({
      content: baseAlertRoleIds.map((roleId) => `<@&${roleId}>`).join(" "),
      embeds: [buildHelpRequestEmbed(request)],
      components: [buildHelpRequestButtons(request)],
      allowedMentions: { parse: [], roles: baseAlertRoleIds },
    });
  } catch (error) {
    await deleteHelpRequest(request.requestId).catch((deleteError) => {
      console.error("מחיקת בקשת עזרה שלא נשלחה נכשלה:", deleteError);
    });
    throw error;
  }
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
    const reason = message.content.slice(2).trim().slice(0, 1000);
    await sendHelpRequestAlert({
      guildId: message.guild!.id,
      requesterId: message.author.id,
      sourceChannelId: message.channelId,
      sourceMessageUrl: message.url,
      requestType: "message",
      details: reason || "לא נמסרו פרטים נוספים.",
    });
  } catch (error) {
    helpCooldowns.delete(cooldownKey);
    console.error("שליחת בקשת העזרה נכשלה:", error);
    await message.reply({
      content: "לא הצלחתי לשלוח את הבקשה לצוות. כדאי לפנות לאחד מאנשי הצוות.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  try {
    await message.reply({
      content: "בקשת העזרה נשלחה לצוות. הצוות יגיע אליך בהקדם.",
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    console.error("אישור שליחת בקשת העזרה נכשל:", error);
  }
}

async function handleRoleEscalationButton(
  interaction: ButtonInteraction,
  requestId: string,
  escalation: HelpRequestEscalation,
) {
  await interaction.deferUpdate();
  const updatedRequest = await pingHelpRequestRole(
    requestId,
    interaction.guildId!,
    escalation,
  );
  const currentRequest = updatedRequest ?? (await getHelpRequest(requestId));

  if (!currentRequest) {
    await interaction.followUp({
      content: "בקשת העזרה לא נמצאה.",
      ephemeral: true,
    });
    return;
  }

  const roleIds = escalation === "admin" ? adminRoleIds : ownerRoleIds;
  const groupName = escalation === "admin" ? "המנהלים" : "הבעלים";

  if (updatedRequest) {
    try {
      const alertChannel = await getRequestAlertChannel(updatedRequest);
      await alertChannel.send({
        content: `${roleIds.map((roleId) => `<@&${roleId}>`).join(" ")}\nבקשת עזרה דורשת כעת טיפול של ${groupName}.`,
        allowedMentions: { parse: [], roles: roleIds },
      });
    } catch (error) {
      await rollbackHelpRequestRolePing(updatedRequest, escalation);
      const retryRequest = await getHelpRequest(requestId);
      if (retryRequest) {
        await interaction.editReply({
          embeds: [buildHelpRequestEmbed(retryRequest)],
          components: [buildHelpRequestButtons(retryRequest)],
          allowedMentions: { parse: [] },
        });
      }
      console.error(`תיגת ${groupName} נכשלה:`, error);
      await interaction.followUp({
        content: `לא הצלחתי לתייג את ${groupName}. אפשר לנסות שוב.`,
        ephemeral: true,
      });
      return;
    }
  }

  await interaction.editReply({
    embeds: [buildHelpRequestEmbed(currentRequest)],
    components: [buildHelpRequestButtons(currentRequest)],
    allowedMentions: { parse: [] },
  });

  if (updatedRequest) {
    await interaction.followUp({
      content: `נשלחה התראה ל${groupName}.`,
      ephemeral: true,
    });
  } else {
    const alreadyPinged =
      escalation === "admin"
        ? currentRequest.adminPingedAt !== null
        : currentRequest.ownerPingedAt !== null;
    await interaction.followUp({
      content:
        currentRequest.status === "closed"
          ? "הבקשה כבר נסגרה, אי אפשר להסלים אותה."
          : alreadyPinged
            ? `כבר נשלחה התראה ל${groupName} עבור הבקשה הזו.`
            : "לא ניתן להסלים את הבקשה כרגע.",
      ephemeral: true,
    });
  }
}

async function handleHelpRequestButton(interaction: ButtonInteraction) {
  const [, action, requestId] =
    interaction.customId.match(
      /^help-request:(claim|close|admin|owner):(.+)$/,
    ) ?? [];
  if (!action || !requestId) return;

  if (!interaction.guildId) {
    await interaction.reply({
      content: "אפשר לעדכן בקשות עזרה בתוך השרת בלבד.",
      ephemeral: true,
    });
    return;
  }

  const request = await getHelpRequest(requestId);
  if (!request || request.guildId !== interaction.guildId) {
    await interaction.reply({
      content: "בקשת העזרה לא נמצאה.",
      ephemeral: true,
    });
    return;
  }

  const expectedAlertChannelId =
    request.requestType === "voice" ? voiceAlertChannelId : helpAlertChannelId;
  if (interaction.channelId !== expectedAlertChannelId) {
    await interaction.reply({
      content: "אפשר לעדכן את הבקשה רק בחדר ההתראות המתאים.",
      ephemeral: true,
    });
    return;
  }

  if (action === "admin" || action === "owner") {
    await handleRoleEscalationButton(interaction, requestId, action);
    return;
  }

  const updatedRequest =
    action === "claim"
      ? await claimHelpRequest(requestId, interaction.guildId, interaction.user.id)
      : await closeHelpRequest(requestId, interaction.guildId, interaction.user.id);
  const currentRequest =
    updatedRequest ?? (await getHelpRequest(requestId));

  if (!currentRequest) {
    await interaction.reply({
      content: "בקשת העזרה לא נמצאה.",
      ephemeral: true,
    });
    return;
  }

  await interaction.update({
    embeds: [buildHelpRequestEmbed(currentRequest)],
    components: [buildHelpRequestButtons(currentRequest)],
    allowedMentions: { parse: [] },
  });

  if (!updatedRequest) {
    const message =
      action === "claim" && currentRequest.status === "claimed"
        ? `הבקשה כבר נלקחה לטיפול על ידי <@${currentRequest.claimedBy}>.`
        : "הבקשה כבר נסגרה או עודכנה.";
    await interaction.followUp({
      content: message,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }
}

async function initializeChannels() {
  const voiceChannel = await client.channels.fetch(voiceChannelId!);
  const helpRequestChannel = await client.channels.fetch(helpRequestChannelId!);
  const helpAlertChannel = await getHelpAlertChannel();
  const voiceAlertChannel = await getVoiceAlertChannel();

  if (!voiceChannel?.isVoiceBased()) {
    throw new Error("המזהה שהוגדר לערוץ הקולי אינו מצביע על ערוץ קולי.");
  }
  if (
    !helpRequestChannel?.isTextBased() ||
    !("guildId" in helpRequestChannel) ||
    typeof helpRequestChannel.guildId !== "string"
  ) {
    throw new Error("המזהה שהוגדר לחדר !h אינו מצביע על חדר טקסט בשרת.");
  }
  if (
    helpRequestChannel.guildId !== voiceChannel.guildId ||
    helpAlertChannel.guildId !== voiceChannel.guildId ||
    voiceAlertChannel.guildId !== voiceChannel.guildId
  ) {
    throw new Error(
      "חדר !h, ערוץ הקול ושני חדרי ההתראות חייבים להיות באותו שרת.",
    );
  }

  const configuredGuild = client.guilds.cache.get(voiceChannel.guildId);
  if (!configuredGuild) {
    throw new Error("הבוט לא נמצא בשרת של ערוצי ההתראות.");
  }
  const guildRoles = await configuredGuild.roles.fetch();
  const configuredRoleIds = [
    ...baseAlertRoleIds,
    ...adminRoleIds,
    ...ownerRoleIds,
  ];
  const missingRoleIds = [...new Set(configuredRoleIds)].filter(
    (roleId) => !guildRoles.has(roleId),
  );
  if (missingRoleIds.length > 0) {
    throw new Error(
      `תפקידים אלה לא נמצאו בשרת: ${missingRoleIds.join(", ")}`,
    );
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
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith("help-request:")) return;

    try {
      await handleHelpRequestButton(interaction);
    } catch (error) {
      console.error("עדכון בקשת עזרה נכשל:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "עדכון הבקשה נכשל. כדאי לנסות שוב.",
          ephemeral: true,
        });
      }
    }
    return;
  }

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
    if (message.channelId !== helpRequestChannelId) {
      await message.reply({
        content: `אפשר להגיש בקשת עזרה רק בחדר <#${helpRequestChannelId}>.`,
        allowedMentions: { repliedUser: false },
      });
      return;
    }
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
    await sendHelpRequestAlert({
      guildId: newState.guild.id,
      requesterId: newState.id,
      sourceChannelId: voiceChannelId!,
      requestType: "voice",
      details: `המשתמש/ת הצטרף/ה לערוץ הקולי וממתין/ה לעזרת צוות: <#${voiceChannelId}>.`,
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
