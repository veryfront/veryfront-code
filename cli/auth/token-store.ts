import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { cliLogger } from "#cli/utils";
import { CONFIG_DIR_NAME, TOKEN_FILE_NAME, TOKEN_FILE_PERMISSIONS } from "../shared/constants.ts";

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
}

/** Remove the stored login, and the record of its last accepted check with it. */
export async function deleteToken(env?: EnvironmentConfig): Promise<void> {
  const fs = createFileSystem();

  for (const path of [getTokenPath(env), getLoginCheckPath(env)]) {
    try {
      if (await fs.exists(path)) await fs.remove(path);
    } catch (error) {
      cliLogger.debug("Failed to delete login file:", error);
    }
  }
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
