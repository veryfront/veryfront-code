import { join } from "@veryfront/platform/compat/path/index.ts";
import { getEnv } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import { CONFIG_DIR_NAME, TOKEN_FILE_NAME, TOKEN_FILE_PERMISSIONS } from "./constants.ts";

function getConfigDir(): string {
  const xdgConfig = getEnv("XDG_CONFIG_HOME");
  if (xdgConfig) return join(xdgConfig, CONFIG_DIR_NAME);

  const home = getEnv("HOME") || getEnv("USERPROFILE");
  if (!home) throw new Error("Could not determine home directory");

  return join(home, ".config", CONFIG_DIR_NAME);
}

function getTokenPath(): string {
  return join(getConfigDir(), TOKEN_FILE_NAME);
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

  if (isDeno) {
    try {
      // @ts-ignore - Deno global
      await Deno.chmod(tokenPath, TOKEN_FILE_PERMISSIONS);
    } catch {
      // Ignore permission errors on Windows
    }
  }
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
