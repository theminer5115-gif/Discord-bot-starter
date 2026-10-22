import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  discordMemberStats,
  discordVoiceSessions,
} from "@workspace/db/schema";

export const XP_PER_MESSAGE = 5;
export const XP_PER_VOICE_MINUTE = 1;
export const MESSAGE_XP_COOLDOWN_MS = 60_000;

export interface MemberRankStats {
  messageCount: number;
  voiceSeconds: number;
  xp: number;
}

export interface GuildLeaderboardEntry {
  userId: string;
  xp: number;
}

export const LEADERBOARD_LIMIT = 10;

export async function recordMessage(guildId: string, userId: string) {
  const now = new Date();
  const xpCooldownBoundary = new Date(
    now.getTime() - MESSAGE_XP_COOLDOWN_MS,
  );

  await db
    .insert(discordMemberStats)
    .values({
      guildId,
      userId,
      messageCount: 1,
      xp: XP_PER_MESSAGE,
      lastMessageXpAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [discordMemberStats.guildId, discordMemberStats.userId],
      set: {
        messageCount: sql`${discordMemberStats.messageCount} + 1`,
        xp: sql`${discordMemberStats.xp} + CASE WHEN ${discordMemberStats.lastMessageXpAt} IS NULL OR ${discordMemberStats.lastMessageXpAt} <= ${xpCooldownBoundary} THEN ${XP_PER_MESSAGE} ELSE 0 END`,
        lastMessageXpAt: sql`CASE WHEN ${discordMemberStats.lastMessageXpAt} IS NULL OR ${discordMemberStats.lastMessageXpAt} <= ${xpCooldownBoundary} THEN ${now} ELSE ${discordMemberStats.lastMessageXpAt} END`,
        updatedAt: now,
      },
    });
}

export async function startVoiceSession(
  guildId: string,
  userId: string,
  joinedAt = new Date(),
) {
  await db
    .insert(discordVoiceSessions)
    .values({ guildId, userId, joinedAt, xpRemainderSeconds: 0 })
    .onConflictDoNothing();
}

export async function resetVoiceSessions(
  guildId: string,
  activeUserIds: string[],
  now = new Date(),
) {
  await db.transaction(async (tx) => {
    const previousSessions = await tx
      .select()
      .from(discordVoiceSessions)
      .where(eq(discordVoiceSessions.guildId, guildId));
    const xpRemainders = new Map(
      previousSessions.map((session) => [
        session.userId,
        session.xpRemainderSeconds,
      ]),
    );

    await tx
      .delete(discordVoiceSessions)
      .where(eq(discordVoiceSessions.guildId, guildId));

    if (activeUserIds.length > 0) {
      await tx
        .insert(discordVoiceSessions)
        .values(
          [...new Set(activeUserIds)].map((userId) => ({
            guildId,
            userId,
            joinedAt: now,
            xpRemainderSeconds: xpRemainders.get(userId) ?? 0,
          })),
        )
        .onConflictDoNothing();
    }
  });
}

export async function checkpointVoiceSession(
  guildId: string,
  userId: string,
  now = new Date(),
  finish = false,
) {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(discordVoiceSessions)
      .where(
        and(
          eq(discordVoiceSessions.guildId, guildId),
          eq(discordVoiceSessions.userId, userId),
        ),
      )
      .for("update");

    if (!session) return;

    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - session.joinedAt.getTime()) / 1000),
    );
    const xpSeconds = session.xpRemainderSeconds + elapsedSeconds;
    const voiceXp = Math.floor(xpSeconds / 60) * XP_PER_VOICE_MINUTE;
    const xpRemainderSeconds = xpSeconds % 60;

    if (elapsedSeconds > 0 || voiceXp > 0) {
      await tx
        .insert(discordMemberStats)
        .values({
          guildId,
          userId,
          voiceSeconds: elapsedSeconds,
          xp: voiceXp,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [discordMemberStats.guildId, discordMemberStats.userId],
          set: {
            voiceSeconds: sql`${discordMemberStats.voiceSeconds} + ${elapsedSeconds}`,
            xp: sql`${discordMemberStats.xp} + ${voiceXp}`,
            updatedAt: now,
          },
        });
    }

    if (finish) {
      await tx
        .delete(discordVoiceSessions)
        .where(
          and(
            eq(discordVoiceSessions.guildId, guildId),
            eq(discordVoiceSessions.userId, userId),
          ),
        );
    } else if (elapsedSeconds > 0) {
      await tx
        .update(discordVoiceSessions)
        .set({ joinedAt: now, xpRemainderSeconds })
        .where(
          and(
            eq(discordVoiceSessions.guildId, guildId),
            eq(discordVoiceSessions.userId, userId),
          ),
        );
    }
  });
}

export async function checkpointAllVoiceSessions(now = new Date()) {
  const sessions = await db
    .select({
      guildId: discordVoiceSessions.guildId,
      userId: discordVoiceSessions.userId,
    })
    .from(discordVoiceSessions);

  for (const session of sessions) {
    await checkpointVoiceSession(session.guildId, session.userId, now);
  }
}

export async function getMemberRankStats(
  guildId: string,
  userId: string,
  now = new Date(),
): Promise<MemberRankStats> {
  const [stats] = await db
    .select()
    .from(discordMemberStats)
    .where(
      and(
        eq(discordMemberStats.guildId, guildId),
        eq(discordMemberStats.userId, userId),
      ),
    )
    .limit(1);
  const [session] = await db
    .select()
    .from(discordVoiceSessions)
    .where(
      and(
        eq(discordVoiceSessions.guildId, guildId),
        eq(discordVoiceSessions.userId, userId),
      ),
    )
    .limit(1);

  let voiceSeconds = stats?.voiceSeconds ?? 0;
  let xp = stats?.xp ?? 0;

  if (session) {
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - session.joinedAt.getTime()) / 1000),
    );
    voiceSeconds += elapsedSeconds;
    xp +=
      Math.floor(
        (session.xpRemainderSeconds + elapsedSeconds) / 60,
      ) * XP_PER_VOICE_MINUTE;
  }

  return {
    messageCount: stats?.messageCount ?? 0,
    voiceSeconds,
    xp,
  };
}

export async function getGuildLeaderboard(
  guildId: string,
  limit = LEADERBOARD_LIMIT,
  now = new Date(),
): Promise<GuildLeaderboardEntry[]> {
  const [memberStats, voiceSessions] = await Promise.all([
    db
      .select({
        userId: discordMemberStats.userId,
        xp: discordMemberStats.xp,
      })
      .from(discordMemberStats)
      .where(eq(discordMemberStats.guildId, guildId)),
    db
      .select({
        userId: discordVoiceSessions.userId,
        joinedAt: discordVoiceSessions.joinedAt,
        xpRemainderSeconds: discordVoiceSessions.xpRemainderSeconds,
      })
      .from(discordVoiceSessions)
      .where(eq(discordVoiceSessions.guildId, guildId)),
  ]);

  const xpByUser = new Map(
    memberStats.map(({ userId, xp }) => [userId, xp]),
  );

  for (const session of voiceSessions) {
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - session.joinedAt.getTime()) / 1000),
    );
    const currentVoiceXp =
      Math.floor(
        (session.xpRemainderSeconds + elapsedSeconds) / 60,
      ) * XP_PER_VOICE_MINUTE;

    xpByUser.set(
      session.userId,
      (xpByUser.get(session.userId) ?? 0) + currentVoiceXp,
    );
  }

  return [...xpByUser.entries()]
    .map(([userId, xp]) => ({ userId, xp }))
    .sort((a, b) => b.xp - a.xp || a.userId.localeCompare(b.userId))
    .slice(0, Math.max(0, Math.floor(limit)));
}
