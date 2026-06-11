import crypto from "node:crypto";
import { JsonStore } from "../store/jsonStore.js";

/**
 * Single-owner authentication. On first run the owner sets a password from
 * the dashboard; afterwards every API call requires a bearer session token.
 */

interface AuthState {
  passwordHash: string | null; // "salt:hash" (scrypt)
  sessions: { token: string; expiresAt: number }[];
}

const store = new JsonStore<AuthState>("auth", {
  passwordHash: null,
  sessions: [],
});

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(password, s, 64).toString("hex");
  return `${s}:${h}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

export function isSetup(): boolean {
  return store.read().passwordHash !== null;
}

export function setupOwner(password: string): string {
  if (isSetup()) throw new Error("Owner password is already set.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  store.update((s) => ({ ...s, passwordHash: hashPassword(password) }));
  return login(password)!;
}

export function login(password: string): string | null {
  const state = store.read();
  if (!state.passwordHash || !verifyPassword(password, state.passwordHash)) {
    return null;
  }
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  store.update((s) => ({
    ...s,
    sessions: [
      ...s.sessions.filter((sess) => sess.expiresAt > now),
      { token, expiresAt: now + SESSION_TTL_MS },
    ],
  }));
  return token;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const now = Date.now();
  return store
    .read()
    .sessions.some((s) => s.token === token && s.expiresAt > now);
}

export function logout(token: string): void {
  store.update((s) => ({
    ...s,
    sessions: s.sessions.filter((sess) => sess.token !== token),
  }));
}

export function changePassword(current: string, next: string): void {
  const state = store.read();
  if (!state.passwordHash || !verifyPassword(current, state.passwordHash)) {
    throw new Error("Current password is incorrect.");
  }
  if (next.length < 8) throw new Error("Password must be at least 8 characters.");
  // Changing the password revokes all existing sessions.
  store.write({ passwordHash: hashPassword(next), sessions: [] });
}
