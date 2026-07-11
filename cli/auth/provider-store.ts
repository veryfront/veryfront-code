/**
 * Provider-namespaced token storage for LLM provider API keys.
 *
 * Stores API keys as plaintext with 0600 permissions in
 * ~/.config/veryfront/tokens/<provider>. Same security model
 * as the existing platform token in ~/.config/veryfront/token.
 *
 * @module cli/auth/provider-store
 */

import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { CONFIG_DIR_NAME, TOKEN_FILE_PERMISSIONS } from "../shared/constants.ts";

export type ProviderName = "anthropic" | "openai";

export interface ProviderCredential {
  apiKey: string;
  validatedAt: string;
  provider: ProviderName;
}

function getTokenDir(env: EnvironmentConfig = getEnvironmentConfig()): string {
  const configDir = env.xdgConfigHome
    ? join(env.xdgConfigHome, CONFIG_DIR_NAME)
    : env.homeDir
    ? join(env.homeDir, ".config", CONFIG_DIR_NAME)
    : null;
  if (!configDir) throw new Error("Could not determine home directory");
  return join(configDir, "tokens");
}

export async function saveProviderToken(
  provider: ProviderName,
  credential: ProviderCredential,
  env?: EnvironmentConfig,
): Promise<void> {
  const fs = createFileSystem();
  const dir = getTokenDir(env);
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, provider);
  await fs.writeTextFile(path, JSON.stringify(credential));
  await fs.chmod(path, TOKEN_FILE_PERMISSIONS);
}

export async function readProviderToken(
  provider: ProviderName,
  env?: EnvironmentConfig,
): Promise<ProviderCredential | null> {
  const fs = createFileSystem();
  try {
    const raw = await fs.readTextFile(join(getTokenDir(env), provider));
    return JSON.parse(raw) as ProviderCredential;
  } catch {
    return null;
  }
}

export async function deleteProviderToken(
  provider: ProviderName,
  env?: EnvironmentConfig,
): Promise<void> {
  const fs = createFileSystem();
  try {
    await fs.remove(join(getTokenDir(env), provider));
  } catch {
    // Token doesn't exist — fine
  }
}

export async function listProviderTokens(env?: EnvironmentConfig): Promise<ProviderName[]> {
  const fs = createFileSystem();
  const providers: ProviderName[] = [];
  try {
    for await (const entry of fs.readDir(getTokenDir(env))) {
      if (
        entry.isFile &&
        (entry.name === "anthropic" || entry.name === "openai")
      ) {
        providers.push(entry.name as ProviderName);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return providers;
}
