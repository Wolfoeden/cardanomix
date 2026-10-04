import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFile(join(import.meta.dirname, "..", "..", "netlify", "database", "migrations", name, "migration.sql"), "utf8");

describe("Migration 002: PayPal entfernen", () => {
  it("schließt reine PayPal-Angebote und entfernt PayPal aus gemischten", async () => {
    const pg = await PGlite.create();
    await pg.exec(await migration("001_initial-schema"));
    const { rows } = await pg.query<{ id: string }>(
      "insert into users (identity, receive_address, display_name) values ('stake1x', 'addr1x', 'Alt') returning id",
    );
    const user = rows[0].id;
    const insert = (methods: string[]) =>
      pg.query<{ id: string }>(
        `insert into offers (user_id, side, fiat, price_type, fixed_price_micro, available_lovelace,
           min_fiat_cents, max_fiat_cents, payment_methods, payment_window_min)
         values ($1, 'sell', 'EUR', 'fixed', 500000, 10000000, 1000, 5000, $2, 30) returning id`,
        [user, methods],
      );
    const onlyPaypal = (await insert(["PAYPAL"])).rows[0].id;
    const mixed = (await insert(["SEPA", "PAYPAL"])).rows[0].id;
    const untouched = (await insert(["WISE"])).rows[0].id;

    await pg.exec(await migration("002_remove-paypal"));

    const { rows: offers } = await pg.query<{ id: string; status: string; payment_methods: string[] }>(
      "select id, status, payment_methods from offers",
    );
    const byId = new Map(offers.map((offer) => [offer.id, offer]));
    expect(byId.get(onlyPaypal)).toMatchObject({ status: "closed", payment_methods: ["PAYPAL"] });
    expect(byId.get(mixed)).toMatchObject({ status: "active", payment_methods: ["SEPA"] });
    expect(byId.get(untouched)).toMatchObject({ status: "active", payment_methods: ["WISE"] });
  });
});
