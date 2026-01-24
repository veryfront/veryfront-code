/**
 * Portable @std/dotenv shim for Node.js and Bun.
 *
 * In Deno: Uses @std/dotenv
 * In Node.js/Bun: Provides a minimal .env file loader
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

export interface LoadOptions {
  envPath?: string;
  export?: boolean;
  examplePath?: string | null;
  allowEmptyValues?: boolean;
  defaultsPath?: string | null;
}

function parseEnvFile(content: string, allowEmptyValues: boolean): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;

    let value = trimmed.slice(eqIndex + 1).trim();
    if (!value && !allowEmptyValues) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value.includes("\\")) {
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\");
    }

    result[key] = value;
  }

  return result;
}

async function nodeLoad(options: LoadOptions = {}): Promise<Record<string, string>> {
  const { readFile } = await import("node:fs/promises");
  const { resolve: pathResolve, join } = await import("node:path");
  const { cwd } = await import("node:process");

  const envPath = options.envPath ?? join(cwd(), ".env");
  const shouldExport = options.export ?? false;

  try {
    const content = await readFile(pathResolve(envPath), "utf-8");
    const parsed = parseEnvFile(content, options.allowEmptyValues ?? false);

    if (shouldExport) {
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    }

    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export let load: (options?: LoadOptions) => Promise<Record<string, string>>;

if (isDeno) {
  const stdDotenv = await import("#std/dotenv.ts");
  load = stdDotenv.load;
} else {
  load = nodeLoad;
}
