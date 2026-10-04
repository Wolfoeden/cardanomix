import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { addressToBech32, parseAddress, rewardAddressFor, sameBytes } from "./cardano/address";
import { SignatureError, verifyDataSignature } from "./cardano/cip8";
import { networkId } from "./config";
import { isUniqueViolation, type AppContext } from "./context";
import { badRequest, forbidden, HttpError, unauthorized } from "./http";
import { findUser, type UserRow } from "./users";
import { parseCookies, readSessionToken, SESSION_COOKIE } from "./session";

const NONCE_TTL_MINUTES = 10;

export const loginSchema = z.object({
  nonce: z.string().regex(/^[0-9a-f]{32}$/, "Ungültige Anmeldeanfrage."),
  signature: z.string().min(10).max(8000),
  key: z.string().min(10).max(1000),
  receiveAddress: z.string().min(10).max(300).optional(),
});

export function loginMessage(host: string, nonce: string, issuedAt: Date): string {
  return [
    "CardanoMix P2P – Anmeldung",
    `Domain: ${host}`,
    `Nonce: ${nonce}`,
    `Ausgestellt: ${issuedAt.toISOString()}`,
    "Mit dieser Signatur meldest du dich an. Es wird keine Transaktion ausgelöst und nichts bezahlt.",
  ].join("\n");
}

export async function createChallenge(ctx: AppContext, host: string): Promise<{ nonce: string; message: string }> {
  const nonce = randomBytes(16).toString("hex");
  const now = ctx.now();
  const message = loginMessage(host, nonce, now);
  await ctx.db.query("delete from auth_nonces where expires_at < $1", [now]);
  await ctx.db.query("insert into auth_nonces (nonce, message, expires_at) values ($1, $2, $3)", [
    nonce,
    message,
    new Date(now.getTime() + NONCE_TTL_MINUTES * 60_000),
  ]);
  return { nonce, message };
}

function defaultDisplayName(identity: string, attempt: number): string {
  const hash = createHash("sha256").update(identity).digest("hex");
  const suffix = attempt === 0 ? hash.slice(0, 6) : `${hash.slice(0, 4)}${randomBytes(2).toString("hex")}`;
  return `Trader-${suffix}`;
}

/**
 * Prüft die Wallet-Signatur zur Anmeldenachricht und legt den Nutzer bei Bedarf an.
 * Identität ist die Stake-Adresse; Wallets ohne Stake-Schlüssel nutzen ihre Adresse.
 */
export async function login(ctx: AppContext, input: z.infer<typeof loginSchema>): Promise<UserRow> {
  if (!ctx.config.sessionSecret) {
    throw new HttpError(503, "not_configured", "Anmeldung ist noch nicht eingerichtet (SESSION_SECRET fehlt).");
  }

  const { rows } = await ctx.db.query<{ message: string }>(
    "delete from auth_nonces where nonce = $1 and expires_at > $2 returning message",
    [input.nonce, ctx.now()],
  );
  const message = rows[0]?.message;
  if (!message) throw unauthorized("Die Anmeldeanfrage ist abgelaufen. Bitte erneut versuchen.");

  let verified;
  try {
    verified = verifyDataSignature(input.signature, input.key, message);
  } catch (error) {
    if (error instanceof SignatureError) throw unauthorized(`Signatur abgelehnt: ${error.message}`);
    throw error;
  }

  const expectedNetwork = networkId(ctx.config.network);
  if (verified.address.networkId !== expectedNetwork) {
    throw badRequest(
      ctx.config.network === "mainnet"
        ? "Bitte die Wallet auf das Cardano-Mainnet umstellen."
        : "Bitte die Wallet auf das Preprod-Testnetz umstellen.",
      "wrong_network",
    );
  }

  const rewardAddress = rewardAddressFor(verified.address);
  const identity = rewardAddress ? addressToBech32(rewardAddress) : verified.addressBech32;

  // Empfangsadresse: muss zur selben Wallet gehören (gleicher Stake-Schlüssel bzw. dieselbe Adresse).
  let receiveAddress: string;
  if (input.receiveAddress) {
    const receive = parseAddress(input.receiveAddress);
    if (!receive || (receive.kind !== "base" && receive.kind !== "enterprise") || receive.networkId !== expectedNetwork) {
      throw badRequest("Die Empfangsadresse ist ungültig.");
    }
    const sameWallet = rewardAddress
      ? sameBytes(receive.stakeCredential, verified.address.stakeCredential)
      : sameBytes(receive.bytes, verified.address.bytes);
    if (!sameWallet) throw badRequest("Die Empfangsadresse gehört nicht zur angemeldeten Wallet.");
    receiveAddress = addressToBech32(receive.bytes);
  } else if (verified.address.kind === "base" || verified.address.kind === "enterprise") {
    receiveAddress = verified.addressBech32;
  } else {
    throw badRequest("Es fehlt eine Empfangsadresse der Wallet.");
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { rows: users } = await ctx.db.query<UserRow>(
        `insert into users (identity, receive_address, display_name)
         values ($1, $2, $3)
         on conflict (identity) do update
           set receive_address = excluded.receive_address, last_login_at = now()
         returning *`,
        [identity, receiveAddress, defaultDisplayName(identity, attempt)],
      );
      const user = users[0];
      if (user.is_banned) throw forbidden("Dieses Konto ist gesperrt.");
      return user;
    } catch (error) {
      if (isUniqueViolation(error, "users_display_name_lower_idx")) continue;
      throw error;
    }
  }
  throw new HttpError(500, "internal", "Konto konnte nicht angelegt werden.");
}

export async function viewerFromRequest(ctx: AppContext, request: Request): Promise<UserRow | null> {
  if (!ctx.config.sessionSecret) return null;
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const userId = readSessionToken(token, ctx.config.sessionSecret, ctx.now().getTime());
  if (!userId) return null;
  const user = await findUser(ctx.db, userId);
  if (!user || user.is_banned) return null;
  return user;
}
