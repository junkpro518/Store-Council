import crypto from "node:crypto";
import { JsonStore } from "../store/jsonStore.js";

/**
 * Central-panel (platform owner) authentication — fully independent of
 * merchant auth: separate password, separate session space. A merchant token
 * can never call /admin/*, and an admin token never unlocks merchant routes.
 */

interface AdminAuthState {
  passwordHash: string | null;
  sessions: { token: string; expiresAt: number }[];
}

const store = new JsonStore<AdminAuthState>("admin-auth", {
  passwordHash: null,
  sessions: [],
});

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — operator sessions stay short

function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString("hex");
  return `${s}:${crypto.scryptSync(password, s, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

export function adminIsSetup(): boolean {
  return store.read().passwordHash !== null;
}

export function adminSetup(password: string): string {
  if (adminIsSetup()) throw new Error("Admin password is already set.");
  if (password.length < 10) throw new Error("Admin password must be at least 10 characters.");
  store.update((s) => ({ ...s, passwordHash: hashPassword(password) }));
  return adminLogin(password)!;
}

export function adminLogin(password: string): string | null {
  const state = store.read();
  if (!state.passwordHash || !verifyPassword(password, state.passwordHash)) return null;
  const token = "sc_adm_" + crypto.randomBytes(32).toString("hex");
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

export function adminVerify(token: string | undefined): boolean {
  if (!token) return false;
  const now = Date.now();
  return store.read().sessions.some((s) => s.token === token && s.expiresAt > now);
}

export function adminLogout(token: string): void {
  store.update((s) => ({
    ...s,
    sessions: s.sessions.filter((sess) => sess.token !== token),
  }));
}
