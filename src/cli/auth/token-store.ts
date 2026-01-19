import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { CONFIG_DIR_NAME, TOKEN_FILE_NAME, TOKEN_FILE_PERMISSIONS } from "./constants.ts";

/**
 * Get config directory path.
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
function getConfigDir(env: RuntimeEnv = getRuntimeEnv()): string {
  if (env.xdgConfigHome) return join(env.xdgConfigHome, CONFIG_DIR_NAME);

  if (!env.homeDir) throw new Error("Could not determine home directory");

  return join(env.homeDir, ".config", CONFIG_DIR_NAME);
}

/**
 * Get token file path.
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
function getTokenPath(env: RuntimeEnv = getRuntimeEnv()): string {
  return join(getConfigDir(env), TOKEN_FILE_NAME);
}

export async function readToken(): Promise<string | null> {
  const fs = createFileSystem();
  const tokenPath = getTokenPath();

  try {
    if (!(await fs.exists(tokenPath))) return null;
    const content = await fs.readTextFile(tokenPath);
    return content.trim() || null;
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  const fs = createFileSystem();
  const configDir = getConfigDir();
  const tokenPath = getTokenPath();

  if (!(await fs.exists(configDir))) {
    await fs.mkdir(configDir, { recursive: true });
  }

  await fs.writeTextFile(tokenPath, token + "\n");
  await fs.chmod(tokenPath, TOKEN_FILE_PERMISSIONS);
}

export async function deleteToken(): Promise<void> {
  const fs = createFileSystem();
  const tokenPath = getTokenPath();

  try {
    if (await fs.exists(tokenPath)) {
      await fs.remove(tokenPath);
    }
  } catch {
    // Ignore errors
  }
}

export async function hasToken(): Promise<boolean> {
  return (await readToken()) !== null;
}

export function getTokenLocation(): string {
  return getTokenPath();
}
