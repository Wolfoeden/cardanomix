import { getDatabase } from "@netlify/database";
import { readConfig } from "./config";
import type { AppContext } from "./context";
import { dbFromPool, type Db } from "./db";
import { createPriceSource } from "./prices";

/** Datenbank erst beim ersten Zugriff verbinden, damit /api/config und /api/prices auch ohne DB laufen. */
function lazyNetlifyDb(): Db {
  let db: Db | null = null;
  const get = () => (db ??= dbFromPool(getDatabase().pool));
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
      db: lazyNetlifyDb(),
      config,
      prices: createPriceSource({ coingeckoKey: config.coingeckoKey }),
      fetch: (input, init) => fetch(input, init),
      now: () => new Date(),
    };
  }
  return context;
}
