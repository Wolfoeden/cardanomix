import type { Me, PublicUser, UserStats } from "../shared/types";
import { toIso, type AppContext } from "./context";
import type { Queryable } from "./db";

export interface UserRow {
  id: string;
  identity: string;
  receive_address: string;
  display_name: string;
  is_banned: boolean;
  created_at: Date | string;
}

const EMPTY_STATS: UserStats = {
  completedTrades: 0,
  cancelledTrades: 0,
  completionRate: null,
  positiveRatings: 0,
  negativeRatings: 0,
};

export async function findUser(db: Queryable, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>("select * from cardanomix.users where id = $1", [id]);
  return rows[0] ?? null;
}

/** Kennzahlen für mehrere Nutzer in einer Abfrage. */
export async function loadStats(db: Queryable, ids: string[]): Promise<Map<string, UserStats>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, UserStats>();
  if (unique.length === 0) return result;
  const { rows } = await db.query<{
    id: string;
    completed: unknown;
    cancelled: unknown;
    positive: unknown;
    negative: unknown;
  }>(
    `select u.id,
       (select count(*) from cardanomix.trades t
         where t.status = 'completed' and (t.seller_id = u.id or t.buyer_id = u.id)) as completed,
       (select count(*) from cardanomix.trades t
         where t.status = 'cancelled' and t.cancel_fault_user_id = u.id) as cancelled,
       (select count(*) from cardanomix.ratings r where r.ratee_id = u.id and r.positive) as positive,
       (select count(*) from cardanomix.ratings r where r.ratee_id = u.id and not r.positive) as negative
     from cardanomix.users u
     where u.id = any($1::uuid[])`,
    [unique],
  );
  for (const row of rows) {
    const completed = Number(row.completed);
    const cancelled = Number(row.cancelled);
    result.set(row.id, {
      completedTrades: completed,
      cancelledTrades: cancelled,
      completionRate: completed + cancelled > 0 ? completed / (completed + cancelled) : null,
      positiveRatings: Number(row.positive),
      negativeRatings: Number(row.negative),
    });
  }
  return result;
}

export function toPublicUser(row: Pick<UserRow, "id" | "display_name" | "created_at">, stats?: UserStats): PublicUser {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: toIso(row.created_at),
    stats: stats ?? EMPTY_STATS,
  };
}

export async function toMe(ctx: AppContext, row: UserRow): Promise<Me> {
  const stats = await loadStats(ctx.db, [row.id]);
  return {
    ...toPublicUser(row, stats.get(row.id)),
    identity: row.identity,
    receiveAddress: row.receive_address,
    isAdmin: ctx.config.adminIdentities.has(row.identity),
  };
}

export async function completedTradeCount(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: unknown }>(
    "select count(*) as count from cardanomix.trades where status = 'completed' and (seller_id = $1 or buyer_id = $1)",
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export const DISPLAY_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,22}[\p{L}\p{N}]$/u;
