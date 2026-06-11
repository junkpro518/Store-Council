import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey, getSettings } from "../settings/settings.js";

/**
 * Anthropic client built from current settings (the owner can change the API
 * key from the dashboard at any time, so construct lazily per use).
 */
export function llm(): Anthropic {
  const apiKey = anthropicKey();
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key configured. Add it in Settings (الإعدادات) on the dashboard."
    );
  }
  return new Anthropic({ apiKey });
}

export function modelId(): string {
  return getSettings().model || "claude-opus-4-8";
}
