import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "cmx_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

interface SessionPayload {
  /** Nutzer-ID */
  u: string;
  /** Ablauf als Unix-Zeit in Sekunden */
  e: number;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(userId: string, secret: string, nowMs = Date.now()): string {
  const payload: SessionPayload = { u: userId, e: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function readSessionToken(token: string, secret: string, nowMs = Date.now()): string | null {
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof payload.u !== "string" || typeof payload.e !== "number") return null;
    if (payload.e * 1000 < nowMs) return null;
    return payload.u;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
