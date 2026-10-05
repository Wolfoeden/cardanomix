import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { createTestWallet } from "../tests/helpers/wallet";
import { createTestApi } from "../tests/helpers/api";
import { koiosChain } from "../server/escrow/chain";

export async function run(prepare: boolean) {
  const file = process.env.PREPROD_WALLETS_FILE;
  if (!file)
    throw new Error("PREPROD_WALLETS_FILE must point outside the repository");
  let seeds: Record<string, string>;
  try {
    seeds = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (!prepare) throw error;
    seeds = Object.fromEntries(
      ["seller", "buyer", "fee"].map((k) => [
        k,
        randomBytes(32).toString("hex"),
      ]),
    );
    await fs.writeFile(file, JSON.stringify(seeds), {
      flag: "wx",
      mode: 0o600,
    });
  }
  const seller = createTestWallet(seeds.seller, 0),
    buyer = createTestWallet(seeds.buyer, 0),
    fee = createTestWallet(seeds.fee, 0);
  if (prepare) {
    console.log(
      JSON.stringify({
        network: "preprod",
        seller: seller.baseAddress,
        buyer: buyer.baseAddress,
        fee: fee.baseAddress,
        requiredBuyerTestAda: 30,
      }),
    );
    return;
  }
  const chain = koiosChain({ network: "preprod" }),
    funds = await chain.addressUtxos(buyer.baseAddress);
  let previous: { orderId: string; txHash: string; txHex: string } | null =
    null;
  try {
    previous = JSON.parse(await fs.readFile(file + ".order.json", "utf8"));
  } catch {
    /* first run */
  }
  if (!previous && funds.reduce((n, u) => n + u.lovelace, 0) < 30_000_000)
    throw new Error("Buyer needs at least 30 TEST ADA from the Preprod faucet");
  const api = await createTestApi(
    {
      network: "preprod",
      feeAddress: fee.baseAddress,
    },
    file + ".db",
  );
  api.ctx.fetch = fetch;
  api.setNow(new Date());
  async function call(
    method: string,
    path: string,
    cookie: string,
    body?: unknown,
  ) {
    const r = await api.call(method, path, { cookie, body });
    if (r.status >= 400)
      throw new Error(
        `${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`,
      );
    return r.body;
  }
  try {
    const s = await api.login("preprod-seller", seller),
      b = await api.login("preprod-buyer", buyer);
    let orderId: string, txHash: string;
    if (previous) {
      orderId = previous.orderId;
      txHash = previous.txHash;
    } else {
      const made = await call("POST", "/api/listings", s.cookie, {
        title: "Preprod smoke test",
        description: "Disposable Preprod-only delivery test.",
        category: "digital",
        type: "digital",
        priceAda: "20",
        shippingAda: "0",
        delivery: "digital",
        condition: "",
        location: "",
        terms: "Test only",
        serviceScope: "",
        deliveryDays: 0,
      });
      const id = made.listing.id;
      await call("PATCH", `/api/listings/${id}`, s.cookie, {
        status: "active",
      });
      const { order } = await call(
        "POST",
        `/api/listings/${id}/orders`,
        b.cookie,
        {},
      );
      const utxos = funds
        .filter((u) => !u.hasAssets)
        .map((u) =>
          CSL.TransactionUnspentOutput.new(
            CSL.TransactionInput.new(
              CSL.TransactionHash.from_hex(u.txHash),
              u.index,
            ),
            CSL.TransactionOutput.new(
              CSL.Address.from_bech32(buyer.baseAddress),
              CSL.Value.new(CSL.BigNum.from_str(String(u.lovelace))),
            ),
          ).to_hex(),
        );
      const p = await call(
        "POST",
        `/api/orders/${order.id}/payment-tx`,
        b.cookie,
        { utxos, changeAddress: buyer.baseAddressHex },
      );
      await fs.writeFile(
        file + ".order.json",
        JSON.stringify({ orderId: order.id, txHash: p.txHash, txHex: p.txHex }),
        { mode: 0o600 },
      );
      await call("POST", `/api/orders/${order.id}/payment`, b.cookie, {
        txHash: p.txHash,
        witnessSet: buyer.signTx(p.txHex),
      });
      orderId = order.id;
      txHash = p.txHash;
    }
    console.log(
      JSON.stringify({ submitted: true, network: "preprod", txHash }),
    );
    for (let i = 0; i < 120; i++) {
      api.setNow(new Date());
      const status = await api.call("POST", `/api/orders/${orderId}/check`, {
        cookie: b.cookie,
      });
      if (status.status === 502) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
        continue;
      }
      if (status.status >= 400) throw new Error("Preprod status check failed");
      const checked = status.body;
      if (checked.order.status === "paid") {
        await call("POST", `/api/orders/${orderId}/action`, s.cookie, {
          action: "fulfill",
          note: "Preprod test fulfilled",
        });
        const complete = await call(
          "POST",
          `/api/orders/${orderId}/action`,
          b.cookie,
          { action: "complete" },
        );
        console.log(
          JSON.stringify({
            passed: complete.order.status === "completed",
            confirmations: checked.order.confirmations,
            txHash,
          }),
        );
        await fs.writeFile(
          file + ".result.json",
          JSON.stringify({
            passed: true,
            confirmations: checked.order.confirmations,
            txHash,
            checkedAt: new Date().toISOString(),
          }),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    throw new Error(
      "Preprod confirmation timeout; transaction remains submitted",
    );
  } finally {
    await api.pg.close();
  }
}
