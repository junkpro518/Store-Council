import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Playbooks — domain expertise in the SKILL.md format (YAML frontmatter +
 * markdown body), following the progressive-disclosure pattern: agents see
 * only name+description in their prompt and load the full body on demand
 * with the read_playbook tool, keeping prompts lean.
 *
 * Files live in skills/*.md. Frontmatter fields:
 *   name: identifier
 *   description: one line shown in agent prompts
 *   agents: "all" or comma-separated agent ids
 */

export interface Playbook {
  name: string;
  description: string;
  agents: string[]; // ["all"] or agent ids
  body: string;
}

const skillsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills"
);

let cache: Playbook[] | null = null;

function parse(file: string): Playbook | null {
  const raw = fs.readFileSync(path.join(skillsDir, file), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.name || !meta.description) return null;
  return {
    name: meta.name,
    description: meta.description,
    agents: (meta.agents ?? "all").split(",").map((s) => s.trim()).filter(Boolean),
    body: match[2].trim(),
  };
}

export function allPlaybooks(): Playbook[] {
  if (cache) return cache;
  try {
    cache = fs
      .readdirSync(skillsDir)
      .filter((f) => f.endsWith(".md"))
      .map(parse)
      .filter((p): p is Playbook => p !== null);
  } catch {
    cache = [];
  }
  return cache;
}

export function playbooksFor(agentId: string): Playbook[] {
  return allPlaybooks().filter(
    (p) => p.agents.includes("all") || p.agents.includes(agentId)
  );
}

export function getPlaybook(name: string): Playbook | undefined {
  return allPlaybooks().find((p) => p.name === name);
}

/** Prompt block listing available playbooks (progressive disclosure). */
export function playbookPromptBlock(agentId: string): string {
  const books = playbooksFor(agentId);
  if (books.length === 0) return "";
  return `## Your playbooks (expert field guides — load with read_playbook when relevant)
${books.map((p) => `- ${p.name}: ${p.description}`).join("\n")}`;
}
