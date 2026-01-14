/**
 * Token storage for CLI authentication
 *
 * Stores authentication tokens in ~/.config/veryfront/token
 * following the XDG Base Directory specification.
 *
 * @module cli/auth/token-store
 */

import { join } from "@veryfront/platform/compat/path/index.ts";
import { getEnv } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";

/**
 * Get the config directory path
 * Uses XDG_CONFIG_HOME if set, otherwise ~/.config
 */
function getConfigDir(): string {
  const xdgConfig = getEnv("XDG_CONFIG_HOME");
  if (xdgConfig) {
    return join(xdgConfig, "veryfront");
  }

  const home = getEnv("HOME") || getEnv("USERPROFILE");
  if (!home) {
    throw new Error("Could not determine home directory");
  }

  return join(home, ".config", "veryfront");
}

/**
 * Get the token file path
 */
function getTokenPath(): string {
  return join(getConfigDir(), "token");
}

/**
 * Read the stored authentication token
 * @returns The token string or null if not found
 */
export async function readToken(): Promise<string | null> {
  const fs = createFileSystem();
  const tokenPath = getTokenPath();

  try {
    if (!(await fs.exists(tokenPath))) {
      return null;
    }

    const content = await fs.readTextFile(tokenPath);
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Save an authentication token
 * Creates the config directory if it doesn't exist
 * Sets file permissions to 600 (owner read/write only) on Unix systems
 *
 * @param token - The token to save
 */
export async function saveToken(token: string): Promise<void> {
  const fs = createFileSystem();
  const configDir = getConfigDir();
  const tokenPath = getTokenPath();

  // Ensure config directory exists
  if (!(await fs.exists(configDir))) {
    await fs.mkdir(configDir, { recursive: true });
  }

  // Write token to file
  await fs.writeTextFile(tokenPath, token + "\n");

  // Set restrictive permissions on Unix (Deno only for now)
  if (isDeno) {
    try {
      // @ts-ignore - Deno global
      await Deno.chmod(tokenPath, 0o600);
    } catch {
      // Ignore permission errors on Windows
    }
  }
}

/**
 * Delete the stored authentication token
 */
export async function deleteToken(): Promise<void> {
  const fs = createFileSystem();
  const tokenPath = getTokenPath();

  try {
    if (await fs.exists(tokenPath)) {
      await fs.remove(tokenPath);
    }
  } catch {
    // Ignore errors if file doesn't exist
  }
}

/**
 * Check if a token is stored
 */
export async function hasToken(): Promise<boolean> {
  const token = await readToken();
  return token !== null;
}

/**
 * Get the token storage location for display purposes
 */
export function getTokenLocation(): string {
  return getTokenPath();
}
