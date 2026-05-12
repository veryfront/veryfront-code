/**
 * Provider-namespaced token storage for LLM provider API keys.
 *
 * Stores API keys as plaintext with 0600 permissions in
 * ~/.config/veryfront/tokens/<provider>. Same security model
 * as the existing platform token in ~/.config/veryfront/token.
 *
 * @module cli/auth/provider-store
 */

import { getEnvironmentConfig } from "veryfront/config";
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

export type ProviderName = "anthropic" | "openai";

export interface ProviderCredential {
  apiKey: string;
  validatedAt: string;
  provider: ProviderName;
}

function getTokenDir(): string {
  const env = getEnvironmentConfig();
  const configDir = env.xdgConfigHome
    ? join(env.xdgConfigHome, "veryfront")
    : join(env.homeDir!, ".config", "veryfront");
  return join(configDir, "tokens");
}

export async function saveProviderToken(
  provider: ProviderName,
  credential: ProviderCredential,
): Promise<void> {
  const fs = createFileSystem();
  const dir = getTokenDir();
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, provider);
  await fs.writeTextFile(path, JSON.stringify(credential));
  await fs.chmod(path, 0o600);
}

export async function readProviderToken(
  provider: ProviderName,
): Promise<ProviderCredential | null> {
  const fs = createFileSystem();
  try {
    const raw = await fs.readTextFile(join(getTokenDir(), provider));
    return JSON.parse(raw) as ProviderCredential;
  } catch {
    return null;
  }
}

export async function deleteProviderToken(
  provider: ProviderName,
): Promise<void> {
  const fs = createFileSystem();
  try {
    await fs.remove(join(getTokenDir(), provider));
  } catch {
    // Token doesn't exist — fine
  }
}

export async function listProviderTokens(): Promise<ProviderName[]> {
  const fs = createFileSystem();
  const providers: ProviderName[] = [];
  try {
    for await (const entry of fs.readDir(getTokenDir())) {
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
