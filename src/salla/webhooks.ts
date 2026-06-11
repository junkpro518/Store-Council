import crypto from "node:crypto";
import { getSettings } from "../settings/settings.js";
import { JsonStore } from "../store/jsonStore.js";
import { saveTokensFromWebhook, disconnectStore } from "./auth.js";
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
  const secret = getSettings().salla.webhookSecret;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface SallaWebhookBody {
  event?: string;
  merchant?: number;
  data?: Record<string, unknown>;
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

/** Process a verified webhook. Returns the action taken (for logging). */
export function handleWebhook(body: SallaWebhookBody): string {
  const event = body.event ?? "unknown";
  const data = body.data ?? {};

  switch (event) {
    case "app.store.authorize": {
      const { access_token, refresh_token, expires } = data as {
        access_token?: string;
        refresh_token?: string;
        expires?: number;
      };
      if (access_token && refresh_token) {
        saveTokensFromWebhook({ access_token, refresh_token, expires }, body.merchant);
        clearStoreInfoCache();
      }
      break;
    }
    case "app.uninstalled":
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
