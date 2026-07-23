import { refreshLoggerConfig, serverLogger } from "./logger/index.ts";
import { cwd as getCwd, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { isNotFoundError, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { CONFIG_INVALID, CONFIG_PARSE_ERROR } from "#veryfront/errors/error-registry/config.ts";

const logger = serverLogger.component("env");

const envSources = new Map<string, string>();
let envLoaded = false;
let envLoadPromise: Promise<void> | null = null;

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface EnvLoadOptions {
  cwd: string;
  override: boolean;
  debug: boolean;
}

interface EnvFileCandidate {
  path: string;
  kind: "base" | "environment" | "local";
}

function snapshotOptions(
  options: { cwd?: string; override?: boolean; debug?: boolean },
): EnvLoadOptions {
  let cwd: unknown;
  let override: unknown;
  let debug: unknown;

  try {
    cwd = options.cwd ?? getCwd();
    override = options.override ?? false;
    debug = options.debug ?? false;
  } catch {
    throw CONFIG_INVALID.create({
      message: "Environment loader options could not be read",
      detail: "Environment loader options could not be read",
    });
  }

  if (typeof cwd !== "string" || cwd.length === 0) {
    throw CONFIG_INVALID.create({
      message: "Environment loader cwd must be a non-empty string",
      detail: "Environment loader cwd must be a non-empty string",
    });
  }
  if (typeof override !== "boolean" || typeof debug !== "boolean") {
    throw CONFIG_INVALID.create({
      message: "Environment loader flags must be booleans",
      detail: "Environment loader flags must be booleans",
    });
  }

  return { cwd, override, debug };
}

function getEnvironmentName(): string {
  const environment = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  if (ENVIRONMENT_NAME_PATTERN.test(environment)) return environment;

  throw CONFIG_INVALID.create({
    message: "Environment name must use letters, numbers, underscores, or hyphens",
    detail: "Environment name must use letters, numbers, underscores, or hyphens",
  });
}

function getEnvFiles(cwd: string, environment: string): EnvFileCandidate[] {
  const candidates: EnvFileCandidate[] = [
    { path: join(cwd, ".env"), kind: "base" },
    { path: join(cwd, `.env.${environment}`), kind: "environment" },
    { path: join(cwd, ".env.local"), kind: "local" },
  ];
  const seen = new Set<string>();
  return candidates.filter(({ path }) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

/** Load environment variables from `.env` files (`.env`, `.env.{NODE_ENV|DENO_ENV}`, `.env.local`). */
export async function loadEnv(
  options: {
    cwd?: string;
    override?: boolean;
    debug?: boolean;
  } = {},
): Promise<void> {
  if (envLoaded) return;
  if (envLoadPromise) return await envLoadPromise;

  const snapshot = snapshotOptions(options);
  const promise = loadEnvFiles(snapshot);
  envLoadPromise = promise;

  try {
    await promise;
    envLoaded = true;
  } finally {
    if (envLoadPromise === promise) envLoadPromise = null;
  }
}

async function loadEnvFiles(options: EnvLoadOptions): Promise<void> {
  const environment = getEnvironmentName();
  const envFiles = getEnvFiles(options.cwd, environment);
  const pending = new Map<string, { value: string; file: string }>();
  const inherited: Record<string, string> = Object.create(null);

  let loadedFileCount = 0;

  for (const file of envFiles) {
    try {
      const content = await readTextFile(file.path);
      const vars = parseEnvFile(content, inherited);

      for (const [key, value] of Object.entries(vars)) {
        pending.set(key, { value, file: file.path });
        inherited[key] = value;
      }

      loadedFileCount++;
      if (options.debug) {
        logger.debug("Environment file loaded", {
          fileKind: file.kind,
          variableCount: Object.keys(vars).length,
        });
      }
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw CONFIG_PARSE_ERROR.create({
        message: "Failed to load an environment file",
        detail: "Failed to load an environment file",
        context: { fileKind: file.kind },
      });
    }
  }

  let appliedVariableCount = 0;
  for (const [key, entry] of pending) {
    if (!options.override && getEnv(key) !== undefined) continue;
    setEnv(key, entry.value);
    envSources.set(key, entry.file);
    appliedVariableCount++;
  }

  refreshLoggerConfig();
  if (loadedFileCount === 0 || !options.debug) return;

  logger.debug("Environment files loaded", {
    loadedFileCount,
    appliedVariableCount,
  });
}

function findClosingQuote(value: string, quote: '"' | "'"): number {
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "\\") {
      index++;
      continue;
    }
    if (value[index] === quote) return index;
  }
  return -1;
}

function decodeQuotedValue(value: string, quote: '"' | "'"): string {
  let decoded = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character !== "\\" || index + 1 >= value.length) {
      decoded += character;
      continue;
    }

    const next = value[index + 1]!;
    if (next === quote || next === "\\") {
      decoded += next;
      index++;
      continue;
    }
    decoded += `\\${next}`;
    index++;
  }
  return decoded;
}

function validateQuotedRemainder(value: string): void {
  const remainder = value.trim();
  if (remainder === "" || remainder.startsWith("#") || remainder.startsWith("//")) return;
  throw new SyntaxError("Unexpected content after quoted environment value");
}

function parseEnvFile(
  content: string,
  inherited: Readonly<Record<string, string>>,
): Record<string, string> {
  const vars: Record<string, string> = Object.create(null);
  const lines = content.split("\n");

  let currentKey: string | null = null;
  let currentValue = "";
  let inMultiline = false;
  let quoteChar: '"' | "'" | null = null;

  for (let line of lines) {
    if (inMultiline) {
      const endQuoteIndex = findClosingQuote(line, quoteChar!);
      if (endQuoteIndex === -1) {
        currentValue += `\n${line}`;
        continue;
      }

      validateQuotedRemainder(line.substring(endQuoteIndex + 1));
      currentValue += `\n${line.substring(0, endQuoteIndex)}`;
      const decodedValue = decodeQuotedValue(currentValue, quoteChar!);
      vars[currentKey!] = quoteChar === '"'
        ? expandVariables(decodedValue, vars, inherited)
        : decodedValue;

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

    const assignment = line.startsWith("export ") ? line.slice("export ".length) : line;
    const assignmentEqualIndex = assignment.indexOf("=");
    if (assignmentEqualIndex === -1) continue;

    const key = assignment.substring(0, assignmentEqualIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) continue;
    let value = assignment.substring(assignmentEqualIndex + 1).trim();

    if (value.startsWith('"') || value.startsWith("'")) {
      quoteChar = value[0] as '"' | "'";
      value = value.substring(1);

      const endQuoteIndex = findClosingQuote(value, quoteChar);
      if (endQuoteIndex !== -1) {
        validateQuotedRemainder(value.substring(endQuoteIndex + 1));
        const quotedValue = decodeQuotedValue(value.substring(0, endQuoteIndex), quoteChar);
        vars[key] = quoteChar === '"' ? expandVariables(quotedValue, vars, inherited) : quotedValue;
        continue;
      }

      currentKey = key;
      currentValue = value;
      inMultiline = true;
      continue;
    }

    // Strip inline comments only when the `#` is preceded by whitespace. A `#`
    // that is part of the value itself (e.g. a URL fragment like
    // `rediss://host:6379/0#pool=5`) has no leading space and must be preserved.
    const commentMatch = value.match(/\s#/);
    if (commentMatch?.index !== undefined) {
      value = value.substring(0, commentMatch.index).trim();
    }

    vars[key] = expandVariables(value, vars, inherited);
  }

  if (inMultiline) throw new SyntaxError("Unterminated quoted environment value");

  return vars;
}

function expandVariables(
  value: string,
  vars: Readonly<Record<string, string>>,
  inherited: Readonly<Record<string, string>>,
): string {
  value = value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    return vars[varName] ?? inherited[varName] ?? getEnv(varName) ?? "";
  });

  value = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, varName: string) => {
    return vars[varName] ?? inherited[varName] ?? getEnv(varName) ?? "";
  });

  return value;
}

/** Check whether `.env` file loading is supported in the current runtime. */
export function supportsEnvFiles(): boolean {
  return typeof readTextFile === "function";
}

/** Mark environment variables as loaded so subsequent calls to `loadEnv` are skipped. */
export function markEnvLoaded(): void {
  envLoaded = true;
}

/** Check whether environment variables have already been loaded from `.env` files. */
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
  envLoadPromise = null;
  envSources.clear();
}
