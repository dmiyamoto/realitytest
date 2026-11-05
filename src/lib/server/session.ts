/**
 * Signed HttpOnly guest sessions for the TEST-MODE demo.
 *
 * Cookie value: `<sessionId>.<base64url HMAC-SHA256(sessionId)>`.
 * This is NOT production-grade account security: there is no login, and
 * anyone holding the cookie owns the session. Live billing would require real
 * authentication (see docs/ARCHITECTURE.md).
 */
import crypto from "node:crypto";
import { prisma } from "./db";

export const SESSION_COOKIE = "rt_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (≥ 32 chars) must be set in production.");
  }
  // Development fallback: stable per process. Sessions reset on restart.
  const g = globalThis as unknown as { __rtDevSecret?: string };
  g.__rtDevSecret ??= crypto.randomBytes(32).toString("hex");
  return g.__rtDevSecret;
}

function sign(id: string): string {
  return crypto.createHmac("sha256", secret()).update(id).digest("base64url");
}

export function encodeSessionCookie(id: string): string {
  return `${id}.${sign(id)}`;
}

export function verifySessionCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  const expected = sign(id);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Session id from a Request's cookie header, if validly signed. */
export function sessionIdFromRequest(req: Request): string | null {
  return verifySessionCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export function sessionCookieHeader(id: string): string {
  const secure = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(encodeSessionCookie(id))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

/**
 * Return the existing guest session for this request, or create one.
 * `setCookie` is non-null when the caller must send a Set-Cookie header.
 */
export async function ensureSession(req: Request): Promise<{ id: string; setCookie: string | null }> {
  const existing = sessionIdFromRequest(req);
  if (existing) {
    await prisma.guestSession.upsert({ where: { id: existing }, create: { id: existing }, update: {} });
    return { id: existing, setCookie: null };
  }
  const id = crypto.randomBytes(18).toString("base64url");
  await prisma.guestSession.create({ data: { id } });
  return { id, setCookie: sessionCookieHeader(id) };
}

export function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}
