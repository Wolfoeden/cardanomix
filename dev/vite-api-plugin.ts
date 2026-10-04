import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import type { AppContext } from "../server/context.ts";

/**
 * Führt die API lokal im Vite-Dev-Server aus – mit PGlite statt Netlify Database.
 * Umgebungsvariablen:
 * - CMX_DB=memory        Datenbank nur im Speicher (Standard: .data/pglite)
 * - CMX_FAKE_PRICES=1    feste Kurse statt CoinGecko
 * - CMX_FAKE_CHAIN=1     simulierte Blockchain (FakeLedger); Guthaben über POST /__dev/ledger/fund
 */
export function devApiPlugin(): Plugin {
  let contextPromise: Promise<AppContext> | null = null;
  let ledger: import("./fake-ledger").FakeLedger | null = null;

  async function createContext(server: ViteDevServer): Promise<AppContext> {
    const { createPgliteDb } = (await server.ssrLoadModule("/dev/pglite.ts")) as typeof import("./pglite");
    const { fakePriceSource } = (await server.ssrLoadModule("/dev/fakes.ts")) as typeof import("./fakes");
    const { FakeLedger } = (await server.ssrLoadModule("/dev/fake-ledger.ts")) as typeof import("./fake-ledger");
    const { readConfig } = (await server.ssrLoadModule("/server/config.ts")) as typeof import("../server/config");
    const { createPriceSource } = (await server.ssrLoadModule("/server/prices.ts")) as typeof import("../server/prices");

    const { db } = await createPgliteDb(process.env.CMX_DB === "memory" ? undefined : ".data/pglite");
    const config = readConfig((name) => process.env[name]);
    config.sessionSecret ??= "lokaler-entwicklungs-schluessel-nicht-produktiv";
    config.arbiterSecret ??= "lokaler-schlichter-schluessel-nicht-produktiv";
    if (process.env.CMX_FAKE_CHAIN) ledger = new FakeLedger(config.network);
    return {
      db,
      config,
      prices: process.env.CMX_FAKE_PRICES ? fakePriceSource() : createPriceSource({ coingeckoKey: config.coingeckoKey }),
      fetch: ledger ? ledger.fetch : fetch,
      now: () => new Date(),
    };
  }

  async function toRequest(req: IncomingMessage): Promise<Request> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value != null) headers.set(name, value);
    }
    const method = req.method ?? "GET";
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = new Uint8Array(Buffer.concat(chunks));
    }
    return new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, { method, headers, body });
  }

  async function send(res: ServerResponse, response: Response): Promise<void> {
    res.statusCode = response.status;
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") res.setHeader(name, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) res.setHeader("set-cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  return {
    name: "cardanomix-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.pathname;
        if (!path.startsWith("/api/") && !path.startsWith("/__dev/")) return next();
        try {
          contextPromise ??= createContext(server);
          const ctx = await contextPromise;
          // Nur lokal: simulierte Blockchain für Tests und Entwicklung
          if (path === "/__dev/ledger/fund" && ledger && req.method === "POST") {
            const input = (await (await toRequest(req)).json()) as { address: string; lovelace: number };
            await send(res, Response.json({ txHash: ledger.fund(input.address, input.lovelace) }));
            return;
          }
          if (path === "/__dev/ledger/utxos" && ledger) {
            const address = url.searchParams.get("address") ?? "";
            const utxos = ledger.utxosAt(address);
            await send(
              res,
              Response.json({ utxos: utxos.map((utxo) => utxo.outputHex), lovelace: utxos.reduce((sum, u) => sum + u.lovelace, 0) }),
            );
            return;
          }
          if (path === "/__dev/expire" && req.method === "POST") {
            const { expireOverdueTrades } = (await server.ssrLoadModule("/server/trades.ts")) as typeof import("../server/trades");
            await send(res, Response.json({ cancelled: await expireOverdueTrades(ctx) }));
            return;
          }
          const { createApp } = (await server.ssrLoadModule("/server/app.ts")) as typeof import("../server/app");
          await send(res, await createApp(ctx)(await toRequest(req)));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
