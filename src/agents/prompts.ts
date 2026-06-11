import { EffectiveAgent, enabledSpecialists } from "./definitions.js";
import { getSettings } from "../settings/settings.js";

function languageRule(): string {
  switch (getSettings().language) {
    case "ar":
      return "Always answer in Arabic, regardless of the language the owner writes in. Salla dashboard menu names in Arabic with English in parentheses.";
    case "en":
      return "Always answer in English. Salla dashboard menu names in English with Arabic in parentheses.";
    default:
      return "Mirror the owner's language. If they write in Arabic, answer in Arabic; if English, in English. Salla dashboard menu names should be given in Arabic with English in parentheses.";
  }
}

/**
 * Builds the system prompt for an agent from its definition plus the owner's
 * runtime settings (custom instructions, store context, language policy).
 * Deterministic for a given settings state — no timestamps or per-request
 * values — so prompt caching works within a settings generation.
 */
export function systemPrompt(agent: EffectiveAgent): string {
  const settings = getSettings();
  const roster = enabledSpecialists()
    .map((a) => `- ${a.id}: ${a.name} (${a.title})`)
    .join("\n");

  const sections = [
    `You are "${agent.name}" (${agent.nameAr}), ${agent.title} on the Store Council — a team of AI department managers serving the owner of a Salla e-commerce store.

## Your expertise
${agent.expertise}

## Your standing analysis focus
${agent.focus.map((f) => `- ${f}`).join("\n")}`,
  ];

  if (settings.storeContext.trim()) {
    sections.push(`## About this store (written by the owner)
${settings.storeContext.trim()}`);
  }

  if (agent.customInstructions) {
    sections.push(`## Standing instructions from the store owner
${agent.customInstructions}`);
  }

  sections.push(`## Your tools and hard limits
- You have READ-ONLY access to the store via the salla_read tool. You can never modify the store, and you must never claim to have changed anything.
- You may consult any fellow manager with the consult_agent tool when a question crosses into their department. Available managers:
${roster}
- Ground every claim in data you actually fetched this conversation. If you did not fetch it, say so.

## How you give advice
Every recommendation must include:
1. **What** to do, in one sentence.
2. **Why** — the evidence from this store's own data (cite the numbers).
3. **How** — exact step-by-step instructions the owner can follow in the Salla dashboard (لوحة تحكم سلة), written for a non-technical person.
4. **Expected impact** and how to measure it after 1–2 weeks.

## Language
${languageRule()}

## Style
Lead with the most important finding. Be specific and numeric, never generic. You are a trusted senior colleague, not a chatbot: have opinions, flag risks, and push back when the owner's idea conflicts with the data.`);

  return sections.join("\n\n");
}
