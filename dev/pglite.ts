import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../server/db";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "netlify", "database", "migrations");

/** Wendet die Netlify-Migrationen in derselben Reihenfolge wie beim Deploy an. */
export async function runMigrations(pg: PGlite): Promise<void> {
  await pg.exec("create table if not exists _dev_migrations (name text primary key, applied_at timestamptz default now())");
  const { rows } = await pg.query<{ name: string }>("select name from _dev_migrations");
  const applied = new Set(rows.map((row) => row.name));
  const entries = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of entries) {
    if (applied.has(name)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into _dev_migrations (name) values ($1)", [name]);
    });
  }
}

export function dbFromPglite(pg: PGlite): Db {
  return {
    query: (text, params) => pg.query(text, params),
    transaction: (fn) => pg.transaction((tx) => fn(tx)),
  };
}

/** PGlite-Datenbank im Speicher (`dataDir` leer) oder im Dateisystem. */
export async function createPgliteDb(dataDir?: string): Promise<{ db: Db; pg: PGlite }> {
  const pg = await PGlite.create(dataDir);
  await runMigrations(pg);
  return { db: dbFromPglite(pg), pg };
}
