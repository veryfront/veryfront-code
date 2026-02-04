import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { CONFIG_DIR_NAME, TOKEN_FILE_NAME, TOKEN_FILE_PERMISSIONS } from "./constants.ts";

function getConfigDir(env: RuntimeEnv = getRuntimeEnv()): string {
  if (env.xdgConfigHome) return join(env.xdgConfigHome, CONFIG_DIR_NAME);
  if (!env.homeDir) throw new Error("Could not determine home directory");
  return join(env.homeDir, ".config", CONFIG_DIR_NAME);
}

function getTokenPath(env: RuntimeEnv = getRuntimeEnv()): string {
  return join(getConfigDir(env), TOKEN_FILE_NAME);
}

export async function readToken(env?: RuntimeEnv): Promise<string | null> {
  try {
    const fs = createFileSystem();
    const tokenPath = getTokenPath(env);

    if (!(await fs.exists(tokenPath))) return null;
    const content = await fs.readTextFile(tokenPath);
    const token = content.trim();
    return token ? token : null;
  } catch {
    return null;
  }
}

export async function saveToken(token: string, env?: RuntimeEnv): Promise<void> {
  const fs = createFileSystem();
  const configDir = getConfigDir(env);
  const tokenPath = getTokenPath(env);

  if (!(await fs.exists(configDir))) {
    await fs.mkdir(configDir, { recursive: true });
  }

  await fs.writeTextFile(tokenPath, `${token}\n`);
  await fs.chmod(tokenPath, TOKEN_FILE_PERMISSIONS);
}

export async function deleteToken(env?: RuntimeEnv): Promise<void> {
  const fs = createFileSystem();
  const tokenPath = getTokenPath(env);

  try {
    if (!(await fs.exists(tokenPath))) return;
    await fs.remove(tokenPath);
  } catch {
    // Ignore errors
  }
}

export async function hasToken(env?: RuntimeEnv): Promise<boolean> {
  return (await readToken(env)) !== null;
}

export function getTokenLocation(env?: RuntimeEnv): string {
  return getTokenPath(env);
}
