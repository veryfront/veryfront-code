import { serverLogger as logger } from "./logger/index.ts";
import { cwd as getCwd, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";

let _fs: FileSystem | null = null;
const envSources = new Map<string, string>();
let envLoaded = false;

function getFs(): FileSystem {
  _fs ??= createFileSystem();
  return _fs;
}

async function isNotFoundError(error: unknown, path: string): Promise<boolean> {
  const nodeError = error as NodeJS.ErrnoException | undefined;
  if (nodeError?.code === "ENOENT") return true;
  if (error instanceof Error && error.name === "NotFound") return true;
  return !(await getFs().exists(path));
}

export async function loadEnv(
  options: {
    cwd?: string;
    override?: boolean;
    debug?: boolean;
  } = {},
): Promise<void> {
  if (envLoaded) return;
  const { cwd = getCwd(), override = false, debug = false } = options;

  const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  const envFiles = [`${cwd}/.env`, `${cwd}/.env.${env}`, `${cwd}/.env.local`];

  let loadedCount = 0;
  let totalVars = 0;
  const fs = getFs();

  for (const file of envFiles) {
    try {
      const content = await fs.readTextFile(file);
      const vars = parseEnvFile(content);

      for (const [key, value] of Object.entries(vars)) {
        const existing = getEnv(key);
        if (existing && !override) continue;

        setEnv(key, value);
        envSources.set(key, file);
        totalVars++;

        if (debug) {
          logger.debug(
            `[env] ${key}=${value.substring(0, 20)}${value.length > 20 ? "..." : ""}`,
          );
        }
        if (key === "VERYFRONT_API_BASE_URL") {
          logger.info(`[env] VERYFRONT_API_BASE_URL loaded: ${value}`);
        }
      }

      loadedCount++;
      if (debug) logger.debug(`[env] Loaded ${file}`);
    } catch (error) {
      if (await isNotFoundError(error, file)) continue;
      logger.warn(`[env] Failed to load ${file}:`, error);
    }
  }

  envLoaded = true;
  if (loadedCount === 0) return;

  logger.debug(
    `[env] Loaded ${totalVars} environment variables from ${loadedCount} file(s)`,
  );
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
      if (endQuoteIndex === -1) {
        currentValue += `\n${line}`;
        continue;
      }

      currentValue += `\n${line.substring(0, endQuoteIndex)}`;
      vars[currentKey!] = expandVariables(currentValue, vars);

      currentKey = null;
      currentValue = "";
      inMultiline = false;
      quoteChar = null;
      continue;
    }

    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const equalIndex = line.indexOf("=");
    if (equalIndex === -1) continue;

    const key = line.substring(0, equalIndex).trim();
    let value = line.substring(equalIndex + 1).trim();

    if (value.startsWith('"') || value.startsWith("'")) {
      quoteChar = value[0] as '"' | "'";
      value = value.substring(1);

      const endQuoteIndex = value.indexOf(quoteChar);
      if (endQuoteIndex !== -1) {
        vars[key] = expandVariables(value.substring(0, endQuoteIndex), vars);
        continue;
      }

      currentKey = key;
      currentValue = value;
      inMultiline = true;
      continue;
    }

    const commentIndex = value.indexOf("#");
    if (commentIndex !== -1) value = value.substring(0, commentIndex).trim();

    vars[key] = expandVariables(value, vars);
  }

  return vars;
}

function expandVariables(value: string, vars: Record<string, string>): string {
  value = value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    return vars[varName] ?? getEnv(varName) ?? "";
  });

  value = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, varName: string) => {
    return vars[varName] ?? getEnv(varName) ?? "";
  });

  return value;
}

export function supportsEnvFiles(): boolean {
  const fs = getFs();
  return typeof fs.readTextFile === "function";
}

export function markEnvLoaded(): void {
  envLoaded = true;
}

export function hasEnvLoaded(): boolean {
  return envLoaded;
}

export function getEnvSource(
  key: string,
): { source: "env-file"; file: string } | { source: "process" } | { source: "unset" } {
  const file = envSources.get(key);
  if (file) return { source: "env-file", file };

  const value = getEnv(key);
  if (value !== undefined) return { source: "process" };

  return { source: "unset" };
}

export function __resetEnvLoaderForTests(): void {
  envLoaded = false;
  envSources.clear();
}
