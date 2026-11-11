import { refreshLoggerConfig, serverLogger } from "./logger/logger.ts";
import { sanitizeUrlCredentials } from "./logger/redact.ts";
import {
  __resetVeryfrontApiKeyAliasForTests,
  clearEnvFileValueSource,
  clearEnvFileValueSources,
  deleteEnv,
  getEnv,
  markEnvFileValue,
  setEnv,
  settleVeryfrontApiKeyAlias,
  VERYFRONT_API_KEY_ENV,
} from "#veryfront/platform/compat/process/env.ts";
import { cwd as getCwd, getOsType } from "#veryfront/platform/compat/process/lifecycle.ts";
import { isNotFoundError, readTextFile } from "#veryfront/platform/compat/fs.ts";

const logger = serverLogger.component("env");

interface EnvSourceRecord {
  file: string;
  source: "env-file" | "config-file";
  /**
   * True when `$NAME` expansion pulled part of this value out of the real
   * process environment. The file supplied the template, but the secret came
   * from the operator's shell, so the value is not purely repository content.
   */
  expandedFromProcessEnv: boolean;
}

const envSources = new Map<string, EnvSourceRecord>();
const applyIntrinsic = Reflect.apply;
const mapDelete = Map.prototype.delete;
const mapForEach = Map.prototype.forEach;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapClear = Map.prototype.clear;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;
let envLoaded = false;
// One load per directory, kept while it runs so concurrent callers await the
// same read. The CLI loads the cwd before a command knows its project, and
// `--project <dir>` then loads that directory too.
const envDirLoads = new Map<string, Promise<void>>();
let osTypeOverride: string | undefined;
// Test seam: a case-sensitive host can stand in for Windows' case-insensitive
// environment when the precedence check reads an existing value.
let existingEnvReaderOverride: ((key: string) => string | undefined) | undefined;

function envLoaderOsType(): string {
  return osTypeOverride ?? getOsType();
}

function readExistingEnv(key: string): string | undefined {
  return existingEnvReaderOverride ? existingEnvReaderOverride(key) : getEnv(key);
}

interface EnvDirLoadOptions {
  override: boolean;
  debug: boolean;
  /** Keep every value defined before this load, even an empty one. */
  keepDefined: boolean;
}

/**
 * Load environment variables from `.env` files (`.env`, `.env.{NODE_ENV|DENO_ENV}`, `.env.local`).
 *
 * Skipped once a load finished or `markEnvLoaded()` was called. A caller that
 * arrives while the same directory is still loading awaits that load.
 */
export async function loadEnv(
  options: {
    cwd?: string;
    override?: boolean;
    debug?: boolean;
  } = {},
): Promise<void> {
  const { cwd = getCwd(), override = false, debug = false } = options;
  const pending = applyIntrinsic(mapGet, envDirLoads, [cwd]) as Promise<void> | undefined;
  if (pending) return await pending;
  if (envLoaded) return;
  await startEnvDirLoad(cwd, { override, debug, keepDefined: false });
}

/**
 * Load a second directory's `.env` files after the primary load.
 *
 * For `veryfront dev --project <dir>`: CLI startup loads the cwd and marks the
 * environment loaded before the project is known. This ignores that marker,
 * reads each directory at most once, and never replaces a value that was
 * defined before it started, empty values included, so the shell and the cwd
 * keep precedence.
 */
export async function loadAdditionalEnv(
  options: { cwd: string; debug?: boolean },
): Promise<void> {
  const { cwd, debug = false } = options;
  const pending = applyIntrinsic(mapGet, envDirLoads, [cwd]) as Promise<void> | undefined;
  if (pending) return await pending;
  await startEnvDirLoad(cwd, { override: false, debug, keepDefined: true });
}

function startEnvDirLoad(cwd: string, options: EnvDirLoadOptions): Promise<void> {
  const load = readEnvDirFiles(cwd, options);
  applyIntrinsic(mapSet, envDirLoads, [cwd, load]);
  return load;
}

/**
 * The value an env load must respect for `key`. A token copied from
 * `VERYFRONT_API_KEY` is derived, not set by the user, so a later file's
 * explicit `VERYFRONT_API_TOKEN` replaces it, as it would without the alias.
 */
function readExistingValueForLoad(key: string): string | undefined {
  const existing = readExistingEnv(key);
  if (existing === undefined) return undefined;
  const isTokenSlot = envLoaderOsType() === "windows"
    ? applyIntrinsic(stringToLowerCase, key, []) === "veryfront_api_token"
    : key === VERYFRONT_API_TOKEN_ENV;
  return isTokenSlot && isVeryfrontApiTokenFromKey() ? undefined : existing;
}

/** Whether a value already in the environment must stay, given the load mode. */
function keepsExistingValue(
  existing: string | undefined,
  setByThisLoad: boolean,
  options: EnvDirLoadOptions,
): boolean {
  if (options.override) return false;
  // An earlier file of this same load set it: later files rank higher.
  if (setByThisLoad) return false;
  // An empty value set before this load counts as set for an additional load.
  if (options.keepDefined) return existing !== undefined;
  return Boolean(existing);
}

async function readEnvDirFiles(cwd: string, options: EnvDirLoadOptions): Promise<void> {
  const { debug } = options;
  const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  const envFiles = [`${cwd}/.env`, `${cwd}/.env.${env}`, `${cwd}/.env.local`];
  // Everything this load tracks per key is keyed by the case-folded name where
  // the environment ignores case (Windows). A later file's `api_url` then
  // replaces an earlier file's `API_URL` in the precedence check, in the
  // values later `$NAME` references see, and in their expansion taint.
  const caseInsensitive = envLoaderOsType() === "windows";
  const foldKey = (key: string): string =>
    caseInsensitive ? applyIntrinsic(stringToLowerCase, key, []) as string : key;
  const loadedVars: Record<string, string> = {};
  const taintedLoadedVars = new Set<string>();
  const keysSetByThisLoad = new Set<string>();

  let loadedCount = 0;
  let totalVars = 0;

  for (const file of envFiles) {
    try {
      const content = await readTextFile(file);
      const vars = parseEnvFile(content, loadedVars, taintedLoadedVars);

      for (const [key, { value, expandedFromProcessEnv }] of Object.entries(vars)) {
        const foldedKey = foldKey(key);
        const setByThisLoad = keysSetByThisLoad.has(foldedKey);
        if (keepsExistingValue(readExistingValueForLoad(key), setByThisLoad, options)) continue;

        if (foldedKey === foldKey(VERYFRONT_API_TOKEN_ENV)) veryfrontApiTokenAliasValue = undefined;
        setEnv(key, value);
        keysSetByThisLoad.add(foldedKey);
        markEnvFileValue(key);
        // Drop provenance recorded under another spelling of this variable, so
        // no stale record outlives the value that replaced it.
        clearEnvSourceAliases(key);
        applyIntrinsic(mapSet, envSources, [
          key,
          { file, source: "env-file", expandedFromProcessEnv },
        ]);
        loadedVars[foldedKey] = value;
        if (expandedFromProcessEnv) taintedLoadedVars.add(foldedKey);
        else taintedLoadedVars.delete(foldedKey);
        totalVars++;

        // Log only the key name and value length — never any part of the value.
        // Env files routinely carry credentials (VERYFRONT_API_TOKEN, DSNs), and
        // a 20-char prefix is enough to leak most of a token.
        if (debug) {
          logger.debug(`[env] ${key} (${value.length} chars)`);
        }
        if (key === "VERYFRONT_API_BASE_URL") {
          // Hybrid setups can embed userinfo credentials in the URL. An
          // expansion can also place an arbitrary shell secret in any URL
          // component, which structural URL sanitization cannot identify.
          logger.info(
            expandedFromProcessEnv
              ? "VERYFRONT_API_BASE_URL loaded from an expanded project env value"
              : `VERYFRONT_API_BASE_URL loaded: ${sanitizeUrlCredentials(value)}`,
          );
        }
      }

      loadedCount++;
      if (debug) logger.debug(`[env] Loaded ${file}`);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      logger.warn(`Failed to load ${file}:`, error);
    }
  }

  applyVeryfrontApiKeyAlias();
  envLoaded = true;
  refreshLoggerConfig();
  if (loadedCount === 0) return;

  logger.debug(
    `[env] Loaded ${totalVars} environment variables from ${loadedCount} file(s)`,
  );
}

/** One `.env` entry, with the provenance of the value after expansion. */
interface ParsedEnvEntry {
  value: string;
  expandedFromProcessEnv: boolean;
}

interface EnvParserState {
  currentKey: string | null;
  currentValue: string;
  inMultiline: boolean;
  quoteChar: '"' | "'" | null;
}

function parseEnvLine(
  originalLine: string,
  state: EnvParserState,
  record: (key: string, raw: string) => void,
): void {
  if (state.inMultiline) {
    const endQuoteIndex = originalLine.indexOf(state.quoteChar!);
    if (endQuoteIndex === -1) {
      state.currentValue += `\n${originalLine}`;
      return;
    }
    state.currentValue += `\n${originalLine.substring(0, endQuoteIndex)}`;
    record(state.currentKey!, state.currentValue);
    state.currentKey = null;
    state.currentValue = "";
    state.inMultiline = false;
    state.quoteChar = null;
    return;
  }

  const line = originalLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return;
  const equalIndex = line.indexOf("=");
  if (equalIndex === -1) return;

  const key = line.substring(0, equalIndex).trim();
  let value = line.substring(equalIndex + 1).trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    state.quoteChar = value[0] as '"' | "'";
    value = value.substring(1);
    const endQuoteIndex = value.indexOf(state.quoteChar);
    if (endQuoteIndex !== -1) record(key, value.substring(0, endQuoteIndex));
    else {
      state.currentKey = key;
      state.currentValue = value;
      state.inMultiline = true;
    }
    return;
  }

  const commentMatch = value.match(/\s#/);
  if (commentMatch?.index !== undefined) value = value.substring(0, commentMatch.index).trim();
  record(key, value);
}

function parseEnvFile(
  content: string,
  priorVars: Readonly<Record<string, string>> = {},
  priorTaintedVars: ReadonlySet<string> = new Set(),
): Record<string, ParsedEnvEntry> {
  const entries: Record<string, ParsedEnvEntry> = {};
  const caseInsensitive = envLoaderOsType() === "windows";
  const normalizeKey = (key: string) => caseInsensitive ? key.toLowerCase() : key;
  // Plain values for `$NAME` references to entries loaded from earlier project
  // env files or declared earlier in this file.
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(priorVars)) vars[normalizeKey(key)] = value;
  // Keys whose value already carries something from the process environment.
  // Referencing one of them taints the referring value in turn.
  const tainted = new Set<string>();
  for (const key of priorTaintedVars) tainted.add(normalizeKey(key));

  const record = (key: string, raw: string): void => {
    const { value, expandedFromProcessEnv } = expandVariables(
      raw,
      vars,
      tainted,
      caseInsensitive,
    );
    const normalizedKey = normalizeKey(key);
    entries[key] = { value, expandedFromProcessEnv };
    vars[normalizedKey] = value;
    if (expandedFromProcessEnv) tainted.add(normalizedKey);
    else tainted.delete(normalizedKey);
  };

  const state: EnvParserState = {
    currentKey: null,
    currentValue: "",
    inMultiline: false,
    quoteChar: null,
  };
  for (const line of content.split("\n")) parseEnvLine(line, state, record);

  return entries;
}

/**
 * Substitute `$NAME` and `${NAME}` references, reporting where they resolved.
 *
 * A reference resolves against earlier entries in the same file first and falls
 * back to the real process environment. That fallback is how a checked-in
 * `.env` can quote the operator's own shell secret, so the caller is told when
 * it happened: the resulting value is no longer purely repository content.
 */
function expandVariables(
  value: string,
  vars: Record<string, string>,
  taintedVars: ReadonlySet<string>,
  caseInsensitive = false,
): { value: string; expandedFromProcessEnv: boolean } {
  let expandedFromProcessEnv = false;

  const substitute = (varName: string): string => {
    const lookupName = caseInsensitive ? varName.toLowerCase() : varName;
    const fromFile = vars[lookupName];
    if (fromFile !== undefined) {
      if (taintedVars.has(lookupName)) expandedFromProcessEnv = true;
      return fromFile;
    }
    const fromProcess = getEnv(varName);
    if (fromProcess !== undefined) {
      expandedFromProcessEnv = true;
      return fromProcess;
    }
    return "";
  };

  value = value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => substitute(varName));
  value = value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, varName: string) => substitute(varName));

  return { value, expandedFromProcessEnv };
}

/** Check whether `.env` file loading is supported in the current runtime. */
export function supportsEnvFiles(): boolean {
  return typeof readTextFile === "function";
}

/** Mark environment variables as loaded so subsequent calls to `loadEnv` are skipped. */
export function markEnvLoaded(): void {
  applyVeryfrontApiKeyAlias();
  envLoaded = true;
}

const VERYFRONT_API_TOKEN_ENV = "VERYFRONT_API_TOKEN";
const VERYFRONT_API_TOKEN_FILE_ENV = "VERYFRONT_API_TOKEN_FILE";
let veryfrontApiTokenAliasValue: string | undefined;

function isBlank(value: string | undefined): boolean {
  return value === undefined || (applyIntrinsic(stringTrim, value, []) as string) === "";
}

/**
 * Let `VERYFRONT_API_KEY`, the name Veryfront tells users to set, supply the
 * credential the CLI and runtime read from `VERYFRONT_API_TOKEN`.
 *
 * Runs after each env load and copies the key only when the token is unset or
 * blank, so an exported or file-provided `VERYFRONT_API_TOKEN` always wins.
 * The copy keeps the key's provenance: a key from a project `.env` file is
 * judged by exactly the rules that file's `VERYFRONT_API_TOKEN` would be,
 * including the expansion taint of a value that names a shell variable.
 */
function applyVeryfrontApiKeyAlias(): void {
  settleVeryfrontApiKeyAlias();
  // A token file supplies the credential ahead of the token variable. An alias
  // would attach the key's `.env` provenance to the token file's secret, so a
  // repository-steered API URL could receive it. A token file can also appear
  // in a later load (`dev --project` reads the project's `.env` after the
  // cwd's), so an alias applied earlier is removed too.
  if (!isBlank(readExistingEnv(VERYFRONT_API_TOKEN_FILE_ENV))) {
    revokeVeryfrontApiKeyAlias();
    return;
  }
  if (!isBlank(readExistingEnv(VERYFRONT_API_TOKEN_ENV))) return;
  const apiKey = readExistingEnv(VERYFRONT_API_KEY_ENV);
  if (apiKey === undefined || isBlank(apiKey)) return;

  setEnv(VERYFRONT_API_TOKEN_ENV, apiKey);
  clearEnvSourceAliases(VERYFRONT_API_TOKEN_ENV);
  const keySource = getEnvSource(VERYFRONT_API_KEY_ENV);
  if (keySource.source === "env-file") {
    markEnvFileValue(VERYFRONT_API_TOKEN_ENV);
    applyIntrinsic(mapSet, envSources, [
      VERYFRONT_API_TOKEN_ENV,
      {
        file: keySource.file,
        source: "env-file",
        expandedFromProcessEnv: keySource.expandedFromProcessEnv,
      },
    ]);
  } else {
    clearEnvFileValueSource(VERYFRONT_API_TOKEN_ENV);
  }
  veryfrontApiTokenAliasValue = apiKey;
}

/** Remove the credential copied from `VERYFRONT_API_KEY`, with its provenance. */
function revokeVeryfrontApiKeyAlias(): void {
  if (isVeryfrontApiTokenFromKey()) {
    deleteEnv(VERYFRONT_API_TOKEN_ENV);
    markProcessEnvSource(VERYFRONT_API_TOKEN_ENV);
  }
  veryfrontApiTokenAliasValue = undefined;
}

/** The variable the user set for the credential now in `VERYFRONT_API_TOKEN`, for messages. */
export function veryfrontApiCredentialEnvName(): string {
  return isVeryfrontApiTokenFromKey() ? VERYFRONT_API_KEY_ENV : VERYFRONT_API_TOKEN_ENV;
}

/** True while the credential in `VERYFRONT_API_TOKEN` is the one copied from `VERYFRONT_API_KEY`. */
export function isVeryfrontApiTokenFromKey(): boolean {
  return veryfrontApiTokenAliasValue !== undefined &&
    readExistingEnv(VERYFRONT_API_TOKEN_ENV) === veryfrontApiTokenAliasValue;
}

/** Check whether environment variables have already been loaded from `.env` files. */
export function hasEnvLoaded(): boolean {
  return envLoaded;
}

/** Where a variable's value came from, for callers that must trust one origin. */
export type EnvSource =
  | {
    source: "env-file";
    file: string;
    /**
     * True when `$NAME` expansion copied part of the value out of the process
     * environment. The file chose the shape, the shell supplied the secret, so
     * such a value must not be treated as content the repository owns.
     */
    expandedFromProcessEnv: boolean;
  }
  | { source: "config-file"; file: string }
  | { source: "process" }
  | { source: "unset" };

function toFileSource(record: EnvSourceRecord): EnvSource {
  if (record.source === "config-file") {
    return { source: "config-file", file: record.file };
  }
  return {
    source: "env-file",
    file: record.file,
    expandedFromProcessEnv: record.expandedFromProcessEnv,
  };
}

/**
 * Find a differently-cased `.env` entry that set this very variable.
 *
 * Windows process environment names are case-insensitive, so a `.env` line
 * written as `veryfront_api_url=...` sets the real `VERYFRONT_API_URL` while
 * provenance was recorded under the spelling the file used. Callers that must
 * trust one origin would then read repository content as an operator shell
 * value. The alias is confirmed against the live environment instead of
 * assumed from the platform: both spellings must resolve to the same value, so
 * on a case-sensitive host this only matches when the file really did supply
 * the value being asked about.
 */
function findAliasedEnvSource(key: string, value: string): EnvSourceRecord | undefined {
  if (envLoaderOsType() !== "windows") return undefined;
  const folded = applyIntrinsic(stringToLowerCase, key, []) as string;

  for (const [recordedKey, record] of envSources) {
    if (recordedKey === key) continue;
    if ((applyIntrinsic(stringToLowerCase, recordedKey, []) as string) !== folded) continue;
    if (getEnv(recordedKey) !== value) continue;
    return record;
  }

  return undefined;
}

export function getEnvSource(key: string): EnvSource {
  const record = applyIntrinsic(mapGet, envSources, [key]) as EnvSourceRecord | undefined;
  if (record) return toFileSource(record);

  const value = getEnv(key);
  if (value === undefined) return { source: "unset" };

  const aliased = findAliasedEnvSource(key, value);
  if (aliased) return toFileSource(aliased);

  return { source: "process" };
}

/** Remove stale provenance for every spelling of one Windows environment key. */
function clearEnvSourceAliases(key: string): void {
  applyIntrinsic(mapDelete, envSources, [key]);
  if (envLoaderOsType() !== "windows") return;

  const folded = applyIntrinsic(stringToLowerCase, key, []) as string;
  applyIntrinsic(mapForEach, envSources, [
    (_record: EnvSourceRecord, recordedKey: string) => {
      if ((applyIntrinsic(stringToLowerCase, recordedKey, []) as string) === folded) {
        applyIntrinsic(mapDelete, envSources, [recordedKey]);
      }
    },
  ]);
}

/** Preserve config-file provenance when exporting a derived environment value. */
export function markConfigFileSource(
  key: string,
  file: string,
): void {
  clearEnvFileValueSource(key);
  clearEnvSourceAliases(key);
  applyIntrinsic(mapSet, envSources, [
    key,
    { file, source: "config-file", expandedFromProcessEnv: false },
  ]);
}

/** Record that a process write replaced any earlier file-derived value. */
export function markProcessEnvSource(key: string): void {
  clearEnvFileValueSource(key);
  clearEnvSourceAliases(key);
}

/** Preserve env-file provenance when exporting a derived environment value. */
export function markEnvFileSource(
  key: string,
  file: string,
  expandedFromProcessEnv = false,
): void {
  markEnvFileValue(key);
  applyIntrinsic(mapSet, envSources, [key, { file, source: "env-file", expandedFromProcessEnv }]);
}

export function __resetEnvLoaderForTests(): void {
  envLoaded = false;
  applyIntrinsic(mapClear, envDirLoads, []);
  applyIntrinsic(mapClear, envSources, []);
  clearEnvFileValueSources();
  osTypeOverride = undefined;
  existingEnvReaderOverride = undefined;
  veryfrontApiTokenAliasValue = undefined;
  __resetVeryfrontApiKeyAliasForTests();
}

export function __setEnvLoaderOsTypeForTests(os: string | undefined): void {
  osTypeOverride = os;
}

export function __setEnvLoaderExistingEnvReaderForTests(
  reader: ((key: string) => string | undefined) | undefined,
): void {
  existingEnvReaderOverride = reader;
}
