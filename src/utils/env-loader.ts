import { refreshLoggerConfig, serverLogger } from "./logger/index.ts";
import {
  cwd as getCwd,
  deleteEnv,
  getHostEnv,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
import { isNotFoundError, readTextFile } from "#veryfront/platform/compat/fs.ts";

const logger = serverLogger.component("env");
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const envSources = new Map<string, string>();
let envLoaded = false;
let envLoadPromise: Promise<void> | null = null;

interface StagedEnvValue {
  value: string;
  file: string;
}

interface StagedEnvFiles {
  values: Map<string, StagedEnvValue>;
  files: string[];
}

/**
 * Load environment variables from `.env` files (`.env`, `.env.{NODE_ENV|DENO_ENV}`,
 * `.env.local`). A malformed or unreadable file rejects the load without changing
 * the process environment.
 */
export function loadEnv(
  options: {
    cwd?: string;
    override?: boolean;
    debug?: boolean;
  } = {},
): Promise<void> {
  if (envLoaded) return Promise.resolve();
  if (envLoadPromise) return envLoadPromise;

  const operation = loadEnvOnce(options);
  const trackedOperation = operation.then(
    () => {
      if (envLoadPromise === trackedOperation) envLoadPromise = null;
    },
    (error) => {
      if (envLoadPromise === trackedOperation) envLoadPromise = null;
      throw error;
    },
  );
  envLoadPromise = trackedOperation;
  return trackedOperation;
}

async function loadEnvOnce(
  options: {
    cwd?: string;
    override?: boolean;
    debug?: boolean;
  },
): Promise<void> {
  const { cwd = getCwd(), override = false, debug = false } = options;

  const env = getHostEnv("NODE_ENV") ?? getHostEnv("DENO_ENV") ?? "development";
  const envFiles = [`${cwd}/.env`, `${cwd}/.env.${env}`, `${cwd}/.env.local`];

  const staged = await stageEnvFiles(envFiles, override);
  const appliedValues = applyStagedValues(staged.values, override);

  for (const [key, value] of appliedValues) {
    envSources.set(key, value.file);

    if (debug) logger.debug(`[env] Loaded ${key}`);
    if (key === "VERYFRONT_API_BASE_URL") {
      logger.info("VERYFRONT_API_BASE_URL loaded from environment file");
    }
  }

  envLoaded = true;
  if (staged.files.length === 0) return;

  if (debug) {
    for (const file of staged.files) logger.debug(`[env] Loaded ${file}`);
  }

  logger.debug(
    `[env] Loaded ${appliedValues.length} environment variables from ${staged.files.length} file(s)`,
  );
}

async function stageEnvFiles(
  files: string[],
  override: boolean,
): Promise<StagedEnvFiles> {
  const staged: StagedEnvFiles = {
    values: new Map<string, StagedEnvValue>(),
    files: [],
  };

  for (const file of files) {
    let content: string;
    try {
      content = await readTextFile(file);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }

    const vars = parseEnvFile(
      content,
      (key) => staged.values.get(key)?.value ?? getHostEnv(key),
      (key) => override ? undefined : getHostEnv(key),
    );

    for (const [key, value] of Object.entries(vars)) {
      if (!override && getHostEnv(key) !== undefined) continue;
      staged.values.set(key, { value, file });
    }
    staged.files.push(file);
  }

  return staged;
}

function applyStagedValues(
  stagedValues: Map<string, StagedEnvValue>,
  override: boolean,
): Array<[string, StagedEnvValue]> {
  const previousValues = new Map<string, string | undefined>();
  const attemptedKeys: string[] = [];
  const appliedValues: Array<[string, StagedEnvValue]> = [];

  try {
    for (const [key, staged] of stagedValues) {
      if (!override && getHostEnv(key) !== undefined) continue;

      previousValues.set(key, getHostEnv(key));
      attemptedKeys.push(key);
      setEnv(key, staged.value);
      appliedValues.push([key, staged]);
    }

    refreshLoggerConfig();
  } catch (error) {
    const rollbackErrors = restoreEnvValues(attemptedKeys, previousValues);

    try {
      refreshLoggerConfig();
    } catch (refreshError) {
      rollbackErrors.push(refreshError);
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Failed to load environment files and restore the previous environment",
      );
    }
    throw error;
  }

  return appliedValues;
}

function restoreEnvValues(
  attemptedKeys: string[],
  previousValues: Map<string, string | undefined>,
): unknown[] {
  const rollbackErrors: unknown[] = [];
  for (let index = attemptedKeys.length - 1; index >= 0; index--) {
    const key = attemptedKeys[index];
    if (key === undefined) continue;

    try {
      const previous = previousValues.get(key);
      if (previous === undefined) deleteEnv(key);
      else setEnv(key, previous);
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  return rollbackErrors;
}

function parseEnvFile(
  content: string,
  resolveExternal: (key: string) => string | undefined,
  resolveAuthoritative: (key: string) => string | undefined,
): Record<string, string> {
  const vars = Object.create(null) as Record<string, string>;
  const lines = content.split("\n");

  let currentKey: string | null = null;
  let currentValue = "";
  let inMultiline = false;
  let quoteChar: '"' | "'" | null = null;
  let quoteStartLine = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex] ?? "";
    if (inMultiline) {
      const endQuoteIndex = line.indexOf(quoteChar!);
      if (endQuoteIndex === -1) {
        currentValue += `\n${line}`;
        continue;
      }

      currentValue += `\n${line.substring(0, endQuoteIndex)}`;
      assignParsedValue(
        vars,
        currentKey!,
        expandVariables(currentValue, vars, resolveExternal),
        resolveAuthoritative,
      );

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
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment variable name at line ${lineIndex + 1}`);
    }

    let value = line.substring(equalIndex + 1).trim();

    if (value.startsWith('"') || value.startsWith("'")) {
      quoteChar = value[0] as '"' | "'";
      value = value.substring(1);

      const endQuoteIndex = value.indexOf(quoteChar);
      if (endQuoteIndex !== -1) {
        assignParsedValue(
          vars,
          key,
          expandVariables(
            value.substring(0, endQuoteIndex),
            vars,
            resolveExternal,
          ),
          resolveAuthoritative,
        );
        continue;
      }

      currentKey = key;
      currentValue = value;
      inMultiline = true;
      quoteStartLine = lineIndex + 1;
      continue;
    }

    // Strip inline comments only when the `#` is preceded by whitespace. A `#`
    // that is part of the value itself (e.g. a URL fragment like
    // `rediss://host:6379/0#pool=5`) has no leading space and must be preserved.
    const commentMatch = value.match(/\s#/);
    if (commentMatch?.index !== undefined) {
      value = value.substring(0, commentMatch.index).trim();
    }

    assignParsedValue(
      vars,
      key,
      expandVariables(value, vars, resolveExternal),
      resolveAuthoritative,
    );
  }

  if (inMultiline) {
    throw new Error(`Unterminated quoted environment value at line ${quoteStartLine}`);
  }

  return vars;
}

/**
 * Preserve an existing host value inside the parser's local expansion scope
 * when `override` is disabled. Otherwise a skipped `FOO=file` assignment could
 * make a later `BAR=${FOO}` disagree with the process environment where FOO
 * remains the host value.
 */
function assignParsedValue(
  vars: Record<string, string>,
  key: string,
  parsedValue: string,
  resolveAuthoritative: (key: string) => string | undefined,
): void {
  const authoritativeValue = resolveAuthoritative(key);
  vars[key] = authoritativeValue === undefined ? parsedValue : authoritativeValue;
}

function expandVariables(
  value: string,
  vars: Record<string, string>,
  resolveExternal: (key: string) => string | undefined,
): string {
  const resolve = (key: string): string => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key] ?? "";
    return resolveExternal(key) ?? "";
  };

  value = value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    return resolve(varName);
  });

  value = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, varName: string) => {
    return resolve(varName);
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

  const value = getHostEnv(key);
  if (value !== undefined) return { source: "process" };

  return { source: "unset" };
}

export function __resetEnvLoaderForTests(): void {
  if (envLoadPromise) {
    throw new Error("Cannot reset the environment loader while a load is in progress");
  }
  envLoaded = false;
  envSources.clear();
}
