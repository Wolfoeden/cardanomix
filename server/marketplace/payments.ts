import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { z } from "zod";
import {
  PLATFORM_FEE_LOVELACE,
  type PaymentPreview,
} from "../../shared/marketplace";
import { addressToBech32, parseAddress, sameBytes } from "../cardano/address";
import { type AppContext } from "../context";
import { ChainError } from "../escrow/chain";
import { chainFor } from "../escrow/service";
import { slotAt } from "../escrow/script";
import { txBuilder, finish, validWitnesses } from "../escrow/tx";
import { badRequest, conflict, forbidden, HttpError } from "../http";
import type { UserRow } from "../users";
import { orderRow, requireParty, toOrder, type OrderRow } from "./orders";
export const paymentInput = z
  .object({
    utxos: z
      .array(
        z
          .string()
          .regex(/^[0-9a-f]+$/i)
          .max(20000),
      )
      .min(1)
      .max(40),
    changeAddress: z.string().max(300),
  })
  .strict();
export const paymentSubmitInput = z
  .object({
    txHash: z.string().regex(/^[0-9a-f]{64}$/),
    witnessSet: z
      .string()
      .regex(/^[0-9a-f]+$/i)
      .max(40000),
  })
  .strict();
interface PaymentRow {
  tx_hash: string;
  tx_hex: string;
  signed_tx_hex: string | null;
  required_keys: string[];
  ttl_slot: unknown;
  status: string;
  last_checked_at: Date | string | null;
  confirmations: number;
}
async function payment(ctx: AppContext, id: string) {
  const { rows } = await ctx.db.query<PaymentRow>(
    "select * from cardanomix.order_payments where order_id=$1",
    [id],
  );
  return rows[0];
}
function preview(o: OrderRow, p: PaymentRow): PaymentPreview {
  return {
    txHex: p.tx_hex,
    txHash: p.tx_hash,
    sellerAddress: o.seller_address,
    sellerLovelace: Number(o.price_lovelace) + Number(o.shipping_lovelace),
    feeAddress: o.fee_address,
    feeLovelace: Number(o.fee_lovelace),
    networkFeeLovelace: Number(
      CSL.FixedTransaction.from_hex(p.tx_hex).body().fee().to_str(),
    ),
    expiresAt: new Date(o.payment_deadline).toISOString(),
  };
}
function chainHttp(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof ChainError)
    throw new HttpError(502, "chain_unavailable", error.message);
  throw badRequest(error instanceof Error ? error.message : String(error));
}
export async function preparePayment(
  ctx: AppContext,
  user: UserRow,
  id: string,
  input: z.infer<typeof paymentInput>,
) {
  try {
    return await ctx.db.transaction(async (tx) => {
      const o = await orderRow(tx, id, true);
      requireParty(o, user);
      if (o.buyer_id !== user.id)
        throw forbidden("Nur der Käufer kann bezahlen.");
      if (
        o.status !== "awaiting_payment" ||
        new Date(o.payment_deadline) <= ctx.now()
      )
        throw conflict("Diese Bestellung kann nicht mehr bezahlt werden.");
      const old = await tx.query<PaymentRow>(
        "select * from cardanomix.order_payments where order_id=$1",
        [id],
      );
      if (old.rows[0]) return preview(o, old.rows[0]);
      const expected = ctx.config.network === "mainnet" ? 1 : 0,
        change = parseAddress(input.changeAddress),
        owner = parseAddress(user.receive_address);
      if (
        !change?.paymentKeyHash ||
        change.networkId !== expected ||
        !owner ||
        (owner.stakeCredential
          ? !sameBytes(change.stakeCredential, owner.stakeCredential)
          : !sameBytes(change.bytes, owner.bytes))
      )
        throw badRequest(
          "Wechselgeldadresse gehört nicht zur angemeldeten Wallet oder zum Netzwerk.",
        );
      const chain = chainFor(ctx),
        params = await chain.protocolParams(true),
        utxos = CSL.TransactionUnspentOutputs.new(),
        keys = new Map<string, string>(),
        seen = new Set<string>();
      const sources = new Map<
        string,
        Awaited<ReturnType<typeof chain.addressUtxos>>
      >();
      for (const hex of input.utxos) {
        const u = CSL.TransactionUnspentOutput.from_hex(hex),
          source = u.output(),
          a = parseAddress(source.address().to_bech32(undefined));
        if (
          !a?.paymentKeyHash ||
          a.networkId !== expected ||
          (owner.stakeCredential
            ? !sameBytes(a.stakeCredential, owner.stakeCredential)
            : !sameBytes(a.bytes, owner.bytes))
        )
          throw badRequest("Wallet-UTxO gehört nicht zum angemeldeten Käufer.");
        if (source.amount().multiasset()) continue;
        const address = addressToBech32(a.bytes);
        if (!sources.has(address))
          sources.set(address, await chain.addressUtxos(address));
        const hash = u.input().transaction_id().to_hex(),
          index = u.input().index(),
          key = `${hash}#${index}`;
        if (seen.has(key)) throw badRequest("Doppelter Wallet-UTxO.");
        seen.add(key);
        const onchain = sources
          .get(address)!
          .find((x) => x.txHash === hash && x.index === index && !x.hasAssets);
        if (
          !onchain ||
          onchain.lovelace !== Number(source.amount().coin().to_str())
        )
          throw badRequest(
            "Wallet-Guthaben hat sich geändert. Bitte erneut verbinden.",
          );
        keys.set(key, Buffer.from(a.paymentKeyHash).toString("hex"));
        utxos.add(u);
      }
      if (!utxos.len())
        throw badRequest("Keine verfügbaren ADA-UTxOs ohne Tokens gefunden.");
      const builder = txBuilder(params),
        sellerAmount = Number(o.price_lovelace) + Number(o.shipping_lovelace);
      const outputs: [string, number][] = [
        [o.seller_address, sellerAmount],
        [o.fee_address, PLATFORM_FEE_LOVELACE],
      ];
      for (const [address, amount] of outputs) {
        const out = CSL.TransactionOutput.new(
          CSL.Address.from_bech32(address),
          CSL.Value.new(CSL.BigNum.from_str(String(amount))),
        );
        const minimum = Number(
          CSL.min_ada_for_output(
            out,
            CSL.DataCost.new_coins_per_byte(
              CSL.BigNum.from_str(String(params.coinsPerUtxoByte)),
            ),
          ).to_str(),
        );
        if (amount < minimum)
          throw badRequest(
            "Der feste Betrag unterschreitet das aktuelle Cardano-Mindest-ADA. Die Gebühr wird nicht erhöht.",
          );
        builder.add_output(out);
      }
      builder.add_inputs_from(
        utxos,
        CSL.CoinSelectionStrategyCIP2.LargestFirst,
      );
      const ttl = slotAt(ctx.config.network, new Date(o.payment_deadline));
      builder.set_ttl_bignum(CSL.BigNum.from_str(String(ttl)));
      builder.add_change_if_needed(CSL.Address.from_bytes(change.bytes));
      const built = finish(builder.build_tx()),
        body = CSL.FixedTransaction.from_hex(built.txHex).body(),
        required: string[] = [];
      for (let i = 0; i < body.inputs().len(); i++) {
        const u = body.inputs().get(i);
        const key = keys.get(`${u.transaction_id().to_hex()}#${u.index()}`);
        if (!key) throw badRequest("Unbekannter Transaktionseingang.");
        if (!required.includes(key)) required.push(key);
      }
      await tx.query(
        "insert into cardanomix.order_payments (order_id,tx_hash,tx_hex,required_keys,ttl_slot) values ($1,$2,$3,$4,$5)",
        [id, built.txHash, built.txHex, JSON.stringify(required), ttl],
      );
      return preview(o, {
        tx_hash: built.txHash,
        tx_hex: built.txHex,
        required_keys: required,
        ttl_slot: ttl,
        signed_tx_hex: null,
        status: "prepared",
        last_checked_at: null,
        confirmations: 0,
      });
    });
  } catch (error) {
    return chainHttp(error);
  }
}
export async function submitPayment(
  ctx: AppContext,
  user: UserRow,
  id: string,
  input: z.infer<typeof paymentSubmitInput>,
) {
  const hash = await ctx.db.transaction(async (tx) => {
    const o = await orderRow(tx, id, true);
    requireParty(o, user);
    if (o.buyer_id !== user.id) throw forbidden();
    const { rows } = await tx.query<PaymentRow>(
        "select * from cardanomix.order_payments where order_id=$1",
        [id],
      ),
      p = rows[0];
    if (!p || p.tx_hash !== input.txHash)
      throw badRequest("Die Signatur passt nicht zur vorbereiteten Zahlung.");
    if (
      o.status === "payment_pending" ||
      ["paid", "fulfilled", "completed", "disputed"].includes(o.status)
    )
      return p.tx_hash;
    if (
      o.status !== "awaiting_payment" ||
      new Date(o.payment_deadline) <= ctx.now()
    )
      throw conflict("Zahlungsfrist abgelaufen.");
    const fixed = CSL.FixedTransaction.from_hex(p.tx_hex);
    let witnesses: ReturnType<typeof validWitnesses>;
    try {
      witnesses = validWitnesses(fixed, input.witnessSet);
    } catch {
      throw badRequest("Ungültige Wallet-Signatur.");
    }
    if (
      !p.required_keys.every((key) => witnesses.some((w) => w.keyHash === key))
    )
      throw badRequest("Es fehlen gültige Signaturen der Käufer-Wallet.");
    for (const w of witnesses)
      if (p.required_keys.includes(w.keyHash))
        fixed.add_vkey_witness(w.witness);
    // Persist before calling the network: a timeout can occur after acceptance.
    await tx.query(
      "update cardanomix.order_payments set signed_tx_hex=$2,status='submitted' where order_id=$1",
      [id, fixed.to_hex()],
    );
    await tx.query(
      "update cardanomix.orders set status='payment_pending',updated_at=$2 where id=$1",
      [id, ctx.now()],
    );
    return p.tx_hash;
  });
  await syncPayment(ctx, id, true);
  return { txHash: hash };
}
async function indexedTip(ctx: AppContext) {
  const base =
    ctx.config.network === "mainnet"
      ? "https://api.koios.rest/api/v1"
      : "https://preprod.koios.rest/api/v1";
  const response = await ctx.fetch(`${base}/tip`, {
    headers: ctx.config.koiosToken
      ? { authorization: `Bearer ${ctx.config.koiosToken}` }
      : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new ChainError("Blockchain-Status nicht erreichbar.");
  const rows = (await response.json()) as {
    abs_slot: number;
    block_time: number;
  }[];
  const tip = rows[0];
  if (
    !tip ||
    !Number.isSafeInteger(tip.abs_slot) ||
    Math.abs(ctx.now().getTime() / 1000 - tip.block_time) > 120
  )
    throw new ChainError("Blockchain-Index ist noch nicht aktuell.");
  return tip.abs_slot;
}
export async function syncPayment(ctx: AppContext, id: string, force = false) {
  const p = await payment(ctx, id);
  if (!p || !["prepared", "submitted", "confirmed"].includes(p.status)) return;
  if (
    !force &&
    p.last_checked_at &&
    ctx.now().getTime() - new Date(p.last_checked_at).getTime() < 15000
  )
    return;
  const chain = chainFor(ctx);
  try {
    const confirmations = await chain.confirmations(p.tx_hash);
    await ctx.db.query(
      "update cardanomix.order_payments set last_checked_at=$2 where order_id=$1",
      [id, ctx.now()],
    );
    if (confirmations != null) {
      await ctx.db.transaction(async (tx) => {
        const o = await orderRow(tx, id, true);
        await tx.query(
          "update cardanomix.order_payments set confirmations=$2,status=case when $2>=10 then 'confirmed' else status end where order_id=$1",
          [id, confirmations],
        );
        if (
          confirmations >= 10 &&
          ["awaiting_payment", "payment_pending"].includes(o.status)
        ) {
          await tx.query(
            "update cardanomix.orders set status='paid',updated_at=$2 where id=$1",
            [id, ctx.now()],
          );
          await tx.query(
            "update cardanomix.listings set status='sold' where id=$1 and status='reserved'",
            [o.listing_id],
          );
        } else if (
          confirmations < 10 &&
          ["paid", "fulfilled"].includes(o.status)
        ) {
          await tx.query(
            "update cardanomix.orders set status='payment_pending',updated_at=$2 where id=$1",
            [id, ctx.now()],
          );
          await tx.query(
            "update cardanomix.order_payments set status='submitted' where order_id=$1",
            [id],
          );
        }
      });
      return;
    }
    if (p.status === "confirmed") {
      await ctx.db.query(
        "update cardanomix.orders set status='disputed',dispute_reason='Die zuvor bestätigte Zahlung ist im Blockchain-Index nicht mehr sichtbar. Bitte vor Lieferung prüfen.' where id=$1 and status in ('paid','fulfilled','completed')",
        [id],
      );
      return;
    }
    if (
      slotAt(ctx.config.network, ctx.now()) <= Number(p.ttl_slot) &&
      p.signed_tx_hex
    ) {
      const returned = await chain.submit(Buffer.from(p.signed_tx_hex, "hex"));
      if (returned !== p.tx_hash)
        throw new ChainError(
          "Unerwarteter Transaktionshash. Die Reservierung bleibt bestehen.",
        );
      return;
    }
    // Do not free pending payments on a wall-clock timeout or an unavailable/stale index.
    if ((await indexedTip(ctx)) > Number(p.ttl_slot) + 300)
      await ctx.db.transaction(async (tx) => {
        const o = await orderRow(tx, id, true);
        if (!["awaiting_payment", "payment_pending"].includes(o.status)) return;
        await tx.query(
          "update cardanomix.order_payments set status='expired',confirmations=0 where order_id=$1",
          [id],
        );
        await tx.query(
          "update cardanomix.orders set status='expired',updated_at=$2 where id=$1",
          [id, ctx.now()],
        );
        await tx.query(
          "update cardanomix.listings set status='active' where id=$1 and status='reserved'",
          [o.listing_id],
        );
      });
  } catch (error) {
    if (force) chainHttp(error);
    else console.warn("Payment reconciliation deferred", id);
  }
}
export async function checkOrder(ctx: AppContext, user: UserRow, id: string) {
  const row = await orderRow(ctx.db, id);
  requireParty(row, user);
  await syncPayment(ctx, id, true);
  return toOrder(await orderRow(ctx.db, id));
}
export async function reconcilePayments(ctx: AppContext) {
  const { rows } = await ctx.db.query<{ order_id: string }>(
    "select p.order_id from cardanomix.order_payments p join cardanomix.orders o on o.id=p.order_id where p.status in ('prepared','submitted') or p.status='confirmed' and o.status in ('paid','fulfilled') order by p.last_checked_at nulls first limit 30",
  );
  for (const p of rows) await syncPayment(ctx, p.order_id);
  return rows.length;
}
