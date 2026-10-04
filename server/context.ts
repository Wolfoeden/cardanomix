import type { AppConfig } from "./config";
import type { Db } from "./db";
import type { PriceSource } from "./prices";

export interface AppContext {
  db: Db;
  config: AppConfig;
  prices: PriceSource;
  fetch: typeof fetch;
  now: () => Date;
}

export function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export function toIsoOrNull(value: unknown): string | null {
  return value == null ? null : toIso(value);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres-Fehlercode für verletzte Unique-Constraints. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, constraint: name, message } = error as { code?: string; constraint?: string; message?: string };
  if (code !== "23505") return false;
  if (!constraint) return true;
  return name === constraint || Boolean(message?.includes(constraint));
}
