
import { serverLogger as logger } from "@veryfront/utils";
import { cwd as getCwd, getEnv, setEnv } from "../../platform/compat/process.ts";
import { createFileSystem, type FileSystem } from "../../platform/compat/fs.ts";
import { isDeno } from "../../platform/compat/runtime.ts";

let _fs: FileSystem | null = null;
function getFs(): FileSystem {
  if (!_fs) {
    _fs = createFileSystem();
  }
  return _fs;
}

async function isNotFoundError(error: unknown, path: string): Promise<boolean> {
  if (error instanceof Error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    if (isDeno && error instanceof Deno.errors.NotFound) {
      return true;
    }
  }
  const fs = getFs();
  const exists = await fs.exists(path);
  return !exists;
}

export async function loadEnv(options: {
  cwd?: string;
  override?: boolean;
  debug?: boolean;
} = {}): Promise<void> {
  const { cwd = getCwd(), override = false, debug = false } = options;

  const env = getEnv("NODE_ENV") || getEnv("DENO_ENV") || "development";

  const envFiles = [
    `${cwd}/.env`,
    `${cwd}/.env.${env}`,
    `${cwd}/.env.local`,
  ];

  let loadedCount = 0;
  let totalVars = 0;
  const fs = getFs();

  for (const file of envFiles) {
    try {
      const content = await fs.readTextFile(file);
      const vars = parseEnvFile(content);

      for (const [key, value] of Object.entries(vars)) {
        const existing = getEnv(key);

        if (!existing || override) {
          setEnv(key, value);
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
      if (await isNotFoundError(error, file)) {
      } else {
        logger.warn(`[env] Failed to load ${file}:`, error);
      }
    }
  }

  if (loadedCount > 0) {
    logger.debug(`[env] Loaded ${totalVars} environment variables from ${loadedCount} file(s)`);
  }
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = content.split("\n");
  let currentKey: string | null = null;
  let currentValue = "";
  let inMultiline = false;
  let quoteChar: '"' | "'" | null = null;

  for (let line of lines) {
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

    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = line.substring(0, equalIndex).trim();
    let value = line.substring(equalIndex + 1).trim();

    if ((value.startsWith('"') || value.startsWith("'"))) {
      quoteChar = value[0] as '"' | "'";
      value = value.substring(1);

      const endQuoteIndex = value.indexOf(quoteChar);
      if (endQuoteIndex !== -1) {
        value = value.substring(0, endQuoteIndex);
        vars[key] = expandVariables(value, vars);
      } else {
        currentKey = key;
        currentValue = value;
        inMultiline = true;
      }
    } else {
      const commentIndex = value.indexOf("#");
      if (commentIndex !== -1) {
        value = value.substring(0, commentIndex).trim();
      }
      vars[key] = expandVariables(value, vars);
    }
  }

  return vars;
}

function expandVariables(value: string, vars: Record<string, string>): string {
  value = value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return vars[varName] || getEnv(varName) || "";
  });

  value = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, varName) => {
    return vars[varName] || getEnv(varName) || "";
  });

  return value;
}

export function supportsEnvFiles(): boolean {
  const fs = getFs();
  return typeof fs.readTextFile === "function";
}
