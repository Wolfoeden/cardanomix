import fs from "node:fs/promises";
import crypto from "node:crypto";
import pg from "pg";

// Required: pause source writes before snapshot/import. Credentials never printed.
const tables = [
  "users",
  "auth_nonces",
  "offers",
  "trades",
  "trade_messages",
  "ratings",
];
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
const [mode, file] = process.argv.slice(2);
if (!["snapshot", "import", "verify"].includes(mode) || !file)
  throw new Error(
    "Usage: node scripts/migrate-to-supabase.mjs snapshot|import|verify PRIVATE_FILE",
  );
async function connect(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  for (const key of ["sslmode", "sslrootcert"]) url.searchParams.delete(key);
  const ca = process.env.CARDANOMIX_DATABASE_CA_FILE
    ? await fs.readFile(process.env.CARDANOMIX_DATABASE_CA_FILE, "utf8")
    : undefined;
  const client = new pg.Client({
    connectionString: url.href,
    ssl: {
      rejectUnauthorized: true,
      ...(ca && name === "CARDANOMIX_DATABASE_URL" ? { ca } : {}),
    },
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  await client.query("set time zone 'UTC'");
  return client;
}
if (mode === "snapshot") {
  const source = await connect("SOURCE_DATABASE_URL");
  try {
    await source.query("begin isolation level repeatable read read only");
    const data = {
      createdAt: new Date().toISOString(),
      tables: {},
      checksums: {},
    };
    for (const table of tables) {
      const { rows } = await source.query(
        `select row_to_json(t) as data from public.${table} t`,
      );
      data.tables[table] = rows.map((r) => r.data);
      data.checksums[table] = digest(data.tables[table]);
    }
    await source.query("commit");
    await fs.writeFile(file, JSON.stringify(data), { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        snapshot: true,
        counts: Object.fromEntries(
          tables.map((t) => [t, data.tables[t].length]),
        ),
      }),
    );
  } finally {
    await source.end();
  }
} else {
  const snapshot = JSON.parse(await fs.readFile(file, "utf8"));
  for (const t of tables)
    if (digest(snapshot.tables[t]) !== snapshot.checksums[t])
      throw new Error(`Snapshot checksum mismatch: ${t}`);
  const target = await connect("CARDANOMIX_DATABASE_URL");
  try {
    await target.query("begin");
    if (mode === "import") {
      for (const t of tables) {
        const count = await target.query(
          `select count(*) from cardanomix.${t}`,
        );
        if (Number(count.rows[0].count))
          throw new Error(`Target must be empty: ${t}`);
        await target.query(
          `insert into cardanomix.${t} overriding system value select * from json_populate_recordset(null::cardanomix.${t},$1::json)`,
          [JSON.stringify(snapshot.tables[t])],
        );
      }
      const last = Math.max(
        0,
        ...snapshot.tables.trade_messages.map((r) => r.id),
      );
      await target.query(
        "select setval(pg_get_serial_sequence('cardanomix.trade_messages','id'),$1,$2)",
        [Math.max(1, last), last > 0],
      );
    }
    for (const t of tables) {
      const { rows } = await target.query(
        `select row_to_json(t) as data from cardanomix.${t} t`,
      );
      if (digest(rows.map((r) => r.data)) !== snapshot.checksums[t])
        throw new Error(`Full row comparison failed: ${t}`);
    }
    await target.query("commit");
    console.log(
      JSON.stringify({
        verified: true,
        imported: mode === "import",
        counts: Object.fromEntries(
          tables.map((t) => [t, snapshot.tables[t].length]),
        ),
      }),
    );
  } catch (error) {
    await target.query("rollback");
    throw new Error(error.message);
  } finally {
    await target.end();
  }
}
