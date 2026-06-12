import crypto from "node:crypto";
import { getSettings } from "../settings/settings.js";
import { platformConfig } from "../platform/config.js";
import { JsonStore } from "../store/jsonStore.js";
import { saveTokensFromWebhook, disconnectStore, isConnected, connectionInfo } from "./auth.js";
import { clearStoreInfoCache } from "./storeInfo.js";

/**
 * Salla webhook handling — required for Salla App Store listing.
 *
 * Salla signs each delivery with HMAC-SHA256 over the raw request body using
 * the webhook secret from the Partners portal, sent in the x-salla-signature
 * header. Deliveries that fail verification are rejected.
 */

export interface WebhookEvent {
  event: string;
  merchant?: number;
  receivedAt: string;
  summary: string;
}

const eventLog = new JsonStore<WebhookEvent[]>("webhook-events", []);
const MAX_EVENTS = 200;

export function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  // One Salla app serves all tenants, so the signing secret is platform-level
  // when configured; the default tenant's settings remain the fallback.
  const secret = platformConfig.sallaWebhookSecret || getSettings().salla.webhookSecret;
  if (!secret || !signature) return false;
  const mac = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const provided = signature.trim();
  // Salla signs in hex; accept base64 too in case a flow differs. Compare the
  // raw MAC bytes (timing-safe), not the string forms.
  for (const enc of ["hex", "base64"] as const) {
    let got: Buffer;
    try {
      got = Buffer.from(provided, enc);
    } catch {
      continue;
    }
    if (got.length === mac.length && crypto.timingSafeEqual(got, mac)) return true;
  }
  return false;
}

interface SallaWebhookBody {
  event?: string;
  merchant?: number;
  /** Salla delivery time (unix seconds) — used for replay protection. */
  created_at?: number;
  data?: Record<string, unknown>;
}

// Replay protection: remember recently-seen delivery fingerprints.
const seenDeliveries = new Map<string, number>();
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

function isReplay(body: SallaWebhookBody, rawBody: Buffer): boolean {
  const now = Date.now();
  for (const [k, t] of seenDeliveries) {
    if (now - t > REPLAY_WINDOW_MS) seenDeliveries.delete(k);
  }
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${body.event ?? ""}:${body.merchant ?? ""}:`)
    .update(rawBody)
    .digest("hex");
  if (seenDeliveries.has(fingerprint)) return true;
  seenDeliveries.set(fingerprint, now);
  return false;
}

function summarize(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case "app.store.authorize":
      return "Store authorized via Salla App Store (tokens received).";
    case "app.installed":
      return "App installed on the store.";
    case "app.uninstalled":
      return "App uninstalled — store disconnected.";
    case "order.created":
      return `New order${data.reference_id ? ` #${data.reference_id}` : ""}.`;
    case "order.updated":
      return `Order updated${data.reference_id ? ` #${data.reference_id}` : ""}.`;
    case "product.created":
      return `Product created${data.name ? `: ${String(data.name).slice(0, 60)}` : ""}.`;
    case "product.updated":
      return `Product updated${data.name ? `: ${String(data.name).slice(0, 60)}` : ""}.`;
    case "review.added":
      return "New review received.";
    case "abandoned.cart":
      return "Cart abandoned.";
    case "customer.created":
      return "New customer registered.";
    default:
      return event;
  }
}

/**
 * Process a signature-verified webhook. Returns the action taken (for logging).
 * `rawBody` is required for replay protection.
 */
export function handleWebhook(body: SallaWebhookBody, rawBody: Buffer): string {
  const event = body.event ?? "unknown";
  const data = body.data ?? {};

  if (isReplay(body, rawBody)) {
    return "(duplicate delivery ignored)";
  }

  switch (event) {
    case "app.store.authorize": {
      const { access_token, refresh_token, expires } = data as {
        access_token?: string;
        refresh_token?: string;
        expires?: number;
      };
      // Merchant binding: never let an authorize event replace a connected
      // store's tokens with a DIFFERENT merchant's (token-injection defense).
      const current = connectionInfo();
      if (
        current.merchantId !== undefined &&
        body.merchant !== undefined &&
        current.merchantId !== body.merchant
      ) {
        return `(ignored authorize for merchant ${body.merchant}; store already bound to ${current.merchantId})`;
      }
      if (access_token && refresh_token) {
        saveTokensFromWebhook({ access_token, refresh_token, expires }, body.merchant);
        clearStoreInfoCache();
      }
      break;
    }
    case "app.uninstalled":
      // Only disconnect if the event is for the merchant we're bound to.
      if (
        isConnected() &&
        body.merchant !== undefined &&
        connectionInfo().merchantId !== undefined &&
        connectionInfo().merchantId !== body.merchant
      ) {
        return `(ignored uninstall for unrelated merchant ${body.merchant})`;
      }
      disconnectStore();
      clearStoreInfoCache();
      break;
  }

  const record: WebhookEvent = {
    event,
    merchant: body.merchant,
    receivedAt: new Date().toISOString(),
    summary: summarize(event, data),
  };
  eventLog.update((events) => [record, ...events].slice(0, MAX_EVENTS));
  return record.summary;
}

export function recentEvents(limit = 30): WebhookEvent[] {
  return eventLog.read().slice(0, limit);
}
