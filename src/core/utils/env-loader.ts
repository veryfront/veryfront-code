/**
 * Environment Variables Loader
 * Automatically loads .env files on startup
 * @module
 */

import { serverLogger as logger } from "@veryfront/utils";

/**
 * Load environment variables from .env file
 * Supports multiple .env file variants in order of precedence:
 * 1. .env.local (highest priority, not committed)
 * 2. .env.{NODE_ENV} (e.g., .env.development, .env.production)
 * 3. .env (base configuration)
 *
 * @param options Configuration options
 * @returns Promise that resolves when env vars are loaded
 */
export async function loadEnv(options: {
  /** Base directory to search for .env files (defaults to cwd) */
  cwd?: string;
  /** Whether to override existing environment variables (defaults to false) */
  override?: boolean;
  /** Whether to log loaded variables (defaults to false for security) */
  debug?: boolean;
} = {}): Promise<void> {
  const { cwd = Deno.cwd(), override = false, debug = false } = options;

  // Determine environment
  const env = Deno.env.get("NODE_ENV") || Deno.env.get("DENO_ENV") || "development";

  // Files to load in order (later files override earlier ones if override=true)
  const envFiles = [
    `${cwd}/.env`,
    `${cwd}/.env.${env}`,
    `${cwd}/.env.local`,
  ];

  let loadedCount = 0;
  let totalVars = 0;

  for (const file of envFiles) {
    try {
      const content = await Deno.readTextFile(file);
      const vars = parseEnvFile(content);

      for (const [key, value] of Object.entries(vars)) {
        const existing = Deno.env.get(key);

        if (!existing || override) {
          Deno.env.set(key, value);
          totalVars++;

          if (debug) {
            logger.debug(`[env] ${key}=${value.substring(0, 20)}${value.length > 20 ? "..." : ""}`);
          }
        }
      }

      loadedCount++;
      if (debug) {
        logger.debug(`[env] Loaded ${file}`);
      }
    } catch (error) {
      // Ignore if file doesn't exist
      if (!(error instanceof Deno.errors.NotFound)) {
        logger.warn(`[env] Failed to load ${file}:`, error);
      }
    }
  }

  if (loadedCount > 0) {
    logger.debug(`[env] Loaded ${totalVars} environment variables from ${loadedCount} file(s)`);
  }
}

/**
 * Parse .env file content into key-value pairs
 * Supports:
 * - Comments (# or //)
 * - Empty lines
 * - Single quotes ('value')
 * - Double quotes ("value")
 * - Multiline values (using quotes)
 * - Variable expansion ($VAR or ${VAR})
 *
 * @param content The .env file content
 * @returns Object with environment variables
 */
function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = content.split("\n");
  let currentKey: string | null = null;
  let currentValue = "";
  let inMultiline = false;
  let quoteChar: '"' | "'" | null = null;

  for (let line of lines) {
    // Handle multiline values
    if (inMultiline) {
      const endQuoteIndex = line.indexOf(quoteChar!);
      if (endQuoteIndex !== -1) {
        currentValue += "\n" + line.substring(0, endQuoteIndex);
        vars[currentKey!] = expandVariables(currentValue, vars);
        currentKey = null;
        currentValue = "";
        inMultiline = false;
        quoteChar = null;
        continue;
      } else {
        currentValue += "\n" + line;
        continue;
      }
    }

    // Trim and skip empty lines and comments
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    // Parse KEY=VALUE
    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = line.substring(0, equalIndex).trim();
    let value = line.substring(equalIndex + 1).trim();

    // Handle quoted values
    if ((value.startsWith('"') || value.startsWith("'"))) {
      quoteChar = value[0] as '"' | "'";
      value = value.substring(1);

      const endQuoteIndex = value.indexOf(quoteChar);
      if (endQuoteIndex !== -1) {
        // Single-line quoted value
        value = value.substring(0, endQuoteIndex);
        vars[key] = expandVariables(value, vars);
      } else {
        // Multi-line quoted value
        currentKey = key;
        currentValue = value;
        inMultiline = true;
      }
    } else {
      // Unquoted value - strip inline comments
      const commentIndex = value.indexOf("#");
      if (commentIndex !== -1) {
        value = value.substring(0, commentIndex).trim();
      }
      vars[key] = expandVariables(value, vars);
    }
  }

  return vars;
}

/**
 * Expand variable references in a value
 * Supports $VAR and ${VAR} syntax
 *
 * @param value The value potentially containing variable references
 * @param vars The available variables for expansion
 * @returns The expanded value
 */
function expandVariables(value: string, vars: Record<string, string>): string {
  // Expand ${VAR} syntax
  value = value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return vars[varName] || Deno.env.get(varName) || "";
  });

  // Expand $VAR syntax (word boundary)
  value = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, varName) => {
    return vars[varName] || Deno.env.get(varName) || "";
  });

  return value;
}

/**
 * Check if running in a runtime that supports .env loading
 * (Deno, Node.js, Bun - not Cloudflare Workers)
 */
export function supportsEnvFiles(): boolean {
  try {
    // Check if we have file system access
    return typeof Deno !== "undefined" && typeof Deno.readTextFile === "function";
  } catch {
    return false;
  }
}
