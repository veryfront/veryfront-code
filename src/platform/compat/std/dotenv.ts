/**
 * Portable @std/dotenv shim for Node.js and Bun.
 *
 * In Deno: Uses @std/dotenv
 * In Node.js/Bun: Provides a minimal .env file loader
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

// ============================================================================
// Types
// ============================================================================

export interface LoadOptions {
  envPath?: string;
  export?: boolean;
  examplePath?: string | null;
  allowEmptyValues?: boolean;
  defaultsPath?: string | null;
}

// ============================================================================
// Node.js/Bun implementation
// ============================================================================

async function nodeLoad(options: LoadOptions = {}): Promise<Record<string, string>> {
  const { readFile } = await import("node:fs/promises");
  const { resolve: pathResolve, join } = await import("node:path");
  const { cwd } = await import("node:process");

  const envPath = options.envPath || join(cwd(), ".env");
  const shouldExport = options.export ?? false;

  try {
    const content = await readFile(pathResolve(envPath), "utf-8");
    const parsed = parseEnvFile(content, options.allowEmptyValues ?? false);

    if (shouldExport) {
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    }

    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

function parseEnvFile(content: string, allowEmptyValues: boolean): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Find the first = sign
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Skip if key is empty
    if (!key) {
      continue;
    }

    // Skip if value is empty and allowEmptyValues is false
    if (!value && !allowEmptyValues) {
      continue;
    }

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle escape sequences in double-quoted values
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

// ============================================================================
// Exports
// ============================================================================

export let load: (options?: LoadOptions) => Promise<Record<string, string>>;

if (isDeno) {
  // Deno: Use @std/dotenv
  const stdDotenv = await import("#std/dotenv.ts");
  load = stdDotenv.load;
} else {
  // Node.js/Bun: Use our implementation
  load = nodeLoad;
}
