import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const discordMemberStats = pgTable(
  "discord_member_stats",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    messageCount: integer("message_count").notNull().default(0),
    voiceSeconds: integer("voice_seconds").notNull().default(0),
    xp: integer("xp").notNull().default(0),
    lastMessageXpAt: timestamp("last_message_xp_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const discordVoiceSessions = pgTable(
  "discord_voice_sessions",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    xpRemainderSeconds: integer("xp_remainder_seconds").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);
