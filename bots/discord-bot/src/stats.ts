import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  discordHelpRequests,
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

export type HelpRequest = typeof discordHelpRequests.$inferSelect;
export type NewHelpRequest = typeof discordHelpRequests.$inferInsert;
export type HelpRequestEscalation = "admin" | "owner";

export async function createHelpRequest(
  request: NewHelpRequest,
): Promise<HelpRequest> {
  const [createdRequest] = await db
    .insert(discordHelpRequests)
    .values(request)
    .returning();

  if (!createdRequest) {
    throw new Error("לא ניתן היה לשמור את בקשת העזרה.");
  }
  return createdRequest;
}

export async function getHelpRequest(
  requestId: string,
): Promise<HelpRequest | null> {
  const [request] = await db
    .select()
    .from(discordHelpRequests)
    .where(eq(discordHelpRequests.requestId, requestId))
    .limit(1);
  return request ?? null;
}

export async function claimHelpRequest(
  requestId: string,
  guildId: string,
  claimedBy: string,
): Promise<HelpRequest | null> {
  const [request] = await db
    .update(discordHelpRequests)
    .set({ status: "claimed", claimedBy, updatedAt: new Date() })
    .where(
      and(
        eq(discordHelpRequests.requestId, requestId),
        eq(discordHelpRequests.guildId, guildId),
        eq(discordHelpRequests.status, "open"),
      ),
    )
    .returning();
  return request ?? null;
}

export async function closeHelpRequest(
  requestId: string,
  guildId: string,
  closedBy: string,
): Promise<HelpRequest | null> {
  const [request] = await db
    .update(discordHelpRequests)
    .set({ status: "closed", closedBy, updatedAt: new Date() })
    .where(
      and(
        eq(discordHelpRequests.requestId, requestId),
        eq(discordHelpRequests.guildId, guildId),
        ne(discordHelpRequests.status, "closed"),
      ),
    )
    .returning();
  return request ?? null;
}

export async function pingHelpRequestRole(
  requestId: string,
  guildId: string,
  escalation: HelpRequestEscalation,
): Promise<HelpRequest | null> {
  const now = new Date();

  if (escalation === "admin") {
    const [request] = await db
      .update(discordHelpRequests)
      .set({ adminPingedAt: now, updatedAt: now })
      .where(
        and(
          eq(discordHelpRequests.requestId, requestId),
          eq(discordHelpRequests.guildId, guildId),
          ne(discordHelpRequests.status, "closed"),
          isNull(discordHelpRequests.adminPingedAt),
        ),
      )
      .returning();
    return request ?? null;
  }

  const [request] = await db
    .update(discordHelpRequests)
    .set({ ownerPingedAt: now, updatedAt: now })
    .where(
      and(
        eq(discordHelpRequests.requestId, requestId),
        eq(discordHelpRequests.guildId, guildId),
        ne(discordHelpRequests.status, "closed"),
        isNull(discordHelpRequests.ownerPingedAt),
      ),
    )
    .returning();
  return request ?? null;
}

export async function rollbackHelpRequestRolePing(
  request: HelpRequest,
  escalation: HelpRequestEscalation,
) {
  if (escalation === "admin" && request.adminPingedAt) {
    await db
      .update(discordHelpRequests)
      .set({ adminPingedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(discordHelpRequests.requestId, request.requestId),
          eq(discordHelpRequests.guildId, request.guildId),
          eq(discordHelpRequests.adminPingedAt, request.adminPingedAt),
        ),
      );
    return;
  }

  if (escalation === "owner" && request.ownerPingedAt) {
    await db
      .update(discordHelpRequests)
      .set({ ownerPingedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(discordHelpRequests.requestId, request.requestId),
          eq(discordHelpRequests.guildId, request.guildId),
          eq(discordHelpRequests.ownerPingedAt, request.ownerPingedAt),
        ),
      );
  }
}

export async function deleteHelpRequest(requestId: string) {
  await db
    .delete(discordHelpRequests)
    .where(
      and(
        eq(discordHelpRequests.requestId, requestId),
        eq(discordHelpRequests.status, "open"),
      ),
    );
}

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
