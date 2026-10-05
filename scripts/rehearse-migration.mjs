import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createServer } from "vite";
const server = await createServer({ server: { middlewareMode: true } });
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const digest = (rows) =>
  crypto
    .createHash("sha256")
    .update(rows.map(canonical).sort().join("\n"))
    .digest("hex");
try {
  const { createPgliteDb } = await server.ssrLoadModule("/dev/pglite.ts");
  const { db, pg } = await createPgliteDb();
  await db.query("set time zone 'UTC'");
  try {
    const snapshot = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
    await db.transaction(async (tx) => {
      for (const [table, rows] of Object.entries(snapshot.tables)) {
        if (
          ![
            "users",
            "auth_nonces",
            "offers",
            "trades",
            "trade_messages",
            "ratings",
          ].includes(table)
        )
          throw new Error("Unexpected table");
        if (digest(rows) !== snapshot.checksums[table])
          throw new Error("Invalid snapshot checksum");
        await tx.query(
          `insert into cardanomix.${table} overriding system value select * from json_populate_recordset(null::cardanomix.${table},$1::json)`,
          [JSON.stringify(rows)],
        );
        const result = await tx.query(
          `select row_to_json(t) as data from cardanomix.${table} t`,
        );
        if (
          digest(result.rows.map((r) => r.data)) !== snapshot.checksums[table]
        )
          throw new Error(`Import mismatch: ${table}`);
      }
    });
    console.log(
      JSON.stringify({
        rehearsalPassed: true,
        counts: Object.fromEntries(
          Object.entries(snapshot.tables).map(([t, r]) => [t, r.length]),
        ),
        fullRowComparison: true,
        escrowFieldsPreserved: true,
      }),
    );
  } catch (error) {
    throw new Error(error.message);
  } finally {
    await pg.close();
  }
} finally {
  await server.close();
}
