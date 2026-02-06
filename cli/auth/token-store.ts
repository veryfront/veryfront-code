import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { cliLogger } from "#veryfront/utils";
import { CONFIG_DIR_NAME, TOKEN_FILE_NAME, TOKEN_FILE_PERMISSIONS } from "../shared/constants.ts";

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
    const token = content.trim();
    return token ? token : null;
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

export async function deleteToken(env?: EnvironmentConfig): Promise<void> {
  const fs = createFileSystem();
  const tokenPath = getTokenPath(env);

  try {
    if (!(await fs.exists(tokenPath))) return;
    await fs.remove(tokenPath);
  } catch (error) {
    cliLogger.debug("Failed to delete token:", error);
  }
}

export async function hasToken(env?: EnvironmentConfig): Promise<boolean> {
  return (await readToken(env)) !== null;
}

export function getTokenLocation(env?: EnvironmentConfig): string {
  return getTokenPath(env);
}
