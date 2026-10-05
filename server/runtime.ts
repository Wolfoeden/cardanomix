import { Pool } from "pg";
import { readConfig } from "./config";
import type { AppContext } from "./context";
import { dbFromPool, type Db } from "./db";
import { createPriceSource } from "./prices";

/** Datenbank erst beim ersten Zugriff verbinden, damit /api/config und /api/prices auch ohne DB laufen. */
function lazySupabaseDb(): Db {
  let db: Db | null = null;
  const get = () => {
    if (db) return db;
    const env = (key: string) => Netlify.env.get(key);
    if (
      env("CARDANOMIX_ENVIRONMENT") !== "production" &&
      env("CMX_ALLOW_LOCAL_DATABASE") !== "1"
    )
      throw new Error("Production database unavailable to preview deploys");
    const connectionString = env("CARDANOMIX_DATABASE_URL");
    if (!connectionString)
      throw new Error("CARDANOMIX_DATABASE_URL is not configured");
    const url = new URL(connectionString);
    if (
      !url.username.startsWith("cardanomix_backend") ||
      !url.hostname.endsWith("pooler.supabase.com")
    )
      throw new Error(
        "A dedicated Supabase backend role and pooler are required",
      );
    // URL SSL flags override pg's explicit SSL object; retain our CA and hostname validation.
    for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"])
      url.searchParams.delete(key);
    const ca = env("CARDANOMIX_DATABASE_CA");
    const pool = new Pool({
      connectionString: url.href,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    });
    db = dbFromPool(pool);
    return db;
  };
  return {
    query: (text, params) => get().query(text, params),
    transaction: (fn) => get().transaction(fn),
  };
}

let context: AppContext | null = null;

/** Kontext für Netlify Functions; wird pro Instanz einmal aufgebaut. */
export function netlifyContext(): AppContext {
  if (!context) {
    const config = readConfig((name) => Netlify.env.get(name));
    context = {
      db: lazySupabaseDb(),
      config,
      prices: createPriceSource({ coingeckoKey: config.coingeckoKey }),
      fetch: (input, init) => fetch(input, init),
      now: () => new Date(),
    };
  }
  return context;
}
