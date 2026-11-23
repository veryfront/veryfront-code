import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import {
  CONFIG_DIR_NAME,
  getApiUrl,
  isSameApiEndpoint,
  TOKEN_FILE_NAME,
  TOKEN_FILE_PERMISSIONS,
} from "../shared/constants.ts";

// Captured before project code runs: `readToken` trims the stored login token
// it reads from disk, so a project that replaces `String.prototype.trim` — or
// `Reflect.apply` itself — must not observe the credential from the method
// receiver or the apply arguments.
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;
// The login fingerprint hashes the token, so the encoder and digest it passes
// through are captured before project code runs too.
const textEncoder = new TextEncoder();
const textEncode = TextEncoder.prototype.encode;
// Read through the instance: not every runtime exposes a global `SubtleCrypto`.
const subtleCrypto = globalThis.crypto.subtle;
const subtleDigest = subtleCrypto.digest;

const LOGIN_CHECK_FILE_NAME = "login-check.json";
/** Records which API the stored login was saved for. */
const TOKEN_API_FILE_NAME = "token-api.json";
/** How long a login the API accepted is trusted before startup checks it again. */
export const LOGIN_CHECK_TTL_MS = 15 * 60_000;

function getConfigDir(env: EnvironmentConfig = getEnvironmentConfig()): string {
  if (env.xdgConfigHome) return join(env.xdgConfigHome, CONFIG_DIR_NAME);
  if (!env.homeDir) throw new Error("Could not determine home directory");
  return join(env.homeDir, ".config", CONFIG_DIR_NAME);
}

function getTokenPath(env: EnvironmentConfig = getEnvironmentConfig()): string {
  return join(getConfigDir(env), TOKEN_FILE_NAME);
}

export async function readToken(env?: EnvironmentConfig): Promise<string | null> {
  try {
    const fs = createFileSystem();
    const tokenPath = getTokenPath(env);

    if (!(await fs.exists(tokenPath))) return null;
    const content = await fs.readTextFile(tokenPath);
    const token = applyIntrinsic(stringTrim, content, []) as string;
    return token || null;
  } catch (error) {
    cliLogger.debug("Failed to read token:", error);
    return null;
  }
}

export async function saveToken(token: string, env?: EnvironmentConfig): Promise<void> {
  const fs = createFileSystem();
  const configDir = getConfigDir(env);
  const tokenPath = getTokenPath(env);

  if (!(await fs.exists(configDir))) {
    await fs.mkdir(configDir, { recursive: true });
  }

  await fs.writeTextFile(tokenPath, `${token}\n`);
  await fs.chmod(tokenPath, TOKEN_FILE_PERMISSIONS);

  const apiPath = getTokenApiPath(env);
  try {
    await fs.writeTextFile(apiPath, JSON.stringify({ apiUrl: getApiUrl(env) }));
    await fs.chmod(apiPath, TOKEN_FILE_PERMISSIONS);
  } catch (error) {
    // Without the record the login is treated like one saved before it existed.
    cliLogger.debug("Failed to record the stored login's API:", error);
    try {
      if (await fs.exists(apiPath)) await fs.remove(apiPath);
    } catch {
      // Nothing more to do: a stale record only keeps a rejected login.
    }
  }
}

/** Remove the stored login, and the record of its last accepted check with it. */
export async function deleteToken(env?: EnvironmentConfig): Promise<void> {
  const fs = createFileSystem();

  for (const path of [getTokenPath(env), getLoginCheckPath(env), getTokenApiPath(env)]) {
    try {
      if (await fs.exists(path)) await fs.remove(path);
    } catch (error) {
      cliLogger.debug("Failed to delete login file:", error);
    }
  }
}

/**
 * Remove the stored login after `apiUrl` rejected it, unless the login was
 * saved for a different API: one host not recognising a login says nothing
 * about whether the host it belongs to still accepts it. A login saved before
 * its API was recorded is removed as before. Returns whether it was removed.
 */
export async function deleteTokenRejectedBy(
  apiUrl: string,
  env?: EnvironmentConfig,
): Promise<boolean> {
  const savedFor = await readTokenApiUrl(env);
  if (savedFor !== null && !isSameApiEndpoint(savedFor, apiUrl)) return false;
  await deleteToken(env);
  return true;
}

async function readTokenApiUrl(env?: EnvironmentConfig): Promise<string | null> {
  try {
    const path = getTokenApiPath(env);
    const fs = createFileSystem();
    if (!(await fs.exists(path))) return null;
    const record = JSON.parse(await fs.readTextFile(path));
    return typeof record?.apiUrl === "string" ? record.apiUrl : null;
  } catch (error) {
    cliLogger.debug("Failed to read the stored login's API:", error);
    return null;
  }
}

function getTokenApiPath(env?: EnvironmentConfig): string {
  return join(getConfigDir(env), TOKEN_API_FILE_NAME);
}

export async function hasToken(env?: EnvironmentConfig): Promise<boolean> {
  return (await readToken(env)) !== null;
}

export function getTokenLocation(env?: EnvironmentConfig): string {
  return getTokenPath(env);
}

/** A hash naming one login at one API, so the check file never holds the token. */
async function loginFingerprint(apiUrl: string, token: string): Promise<string> {
  const bytes = applyIntrinsic(textEncode, textEncoder, [`${apiUrl}\n${token}`]);
  const digest = await (applyIntrinsic(subtleDigest, subtleCrypto, ["SHA-256", bytes]) as Promise<
    ArrayBuffer
  >);
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function getLoginCheckPath(env?: EnvironmentConfig): string {
  return join(getConfigDir(env), LOGIN_CHECK_FILE_NAME);
}

/**
 * Whether the API accepted this login at this API within
 * {@link LOGIN_CHECK_TTL_MS}. A rejected or unchecked login is never
 * remembered, so it is always checked again.
 */
export async function wasLoginAcceptedRecently(
  apiUrl: string,
  token: string,
  env?: EnvironmentConfig,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const record = JSON.parse(await createFileSystem().readTextFile(getLoginCheckPath(env)));
    return record?.fingerprint === await loginFingerprint(apiUrl, token) &&
      typeof record.acceptedAt === "number" && record.acceptedAt <= now &&
      now - record.acceptedAt < LOGIN_CHECK_TTL_MS;
  } catch {
    return false;
  }
}

/** Remember that the API accepted this login at this API just now. */
export async function rememberAcceptedLogin(
  apiUrl: string,
  token: string,
  env?: EnvironmentConfig,
  now: number = Date.now(),
): Promise<void> {
  try {
    const fs = createFileSystem();
    const path = getLoginCheckPath(env);
    const fingerprint = await loginFingerprint(apiUrl, token);
    await fs.writeTextFile(path, JSON.stringify({ fingerprint, acceptedAt: now }));
    await fs.chmod(path, TOKEN_FILE_PERMISSIONS);
  } catch (error) {
    cliLogger.debug("Failed to remember the login check:", error);
  }
}
