import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Minimal file-backed JSON store. Keeps the platform dependency-free for v1;
 * swap for Postgres/Supabase when multi-tenant.
 */
export class JsonStore<T> {
  private file: string;

  constructor(name: string, private fallback: T) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.file = path.join(config.dataDir, `${name}.json`);
  }

  read(): T {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as T;
    } catch {
      return structuredClone(this.fallback);
    }
  }

  write(value: T): void {
    // Atomic write: a crash mid-write must never corrupt existing data.
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, this.file);
  }

  update(fn: (current: T) => T): T {
    const next = fn(this.read());
    this.write(next);
    return next;
  }
}
