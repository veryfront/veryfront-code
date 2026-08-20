/**
 * Auth Utilities
 *
 * Shared utilities for authentication-related CLI operations.
 */

import type { AuthMethod } from "./login.ts";
import type { ParsedArgs } from "../shared/types.ts";

/**
 * Parse login method from CLI arguments
 */
export function parseLoginMethod(
  args: ParsedArgs,
): AuthMethod | undefined {
  if (args.google) return "google";
  if (args.github) return "github";
  if (args.microsoft) return "microsoft";
  if (args.token) return "token";
  return undefined;
}

/** Env var that replaces each removed `--provider` target. */
const REMOVED_PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Whether `--provider` was passed, regardless of value. */
export function hasProviderFlag(args: ParsedArgs): boolean {
  return typeof args.provider === "string" && args.provider.length > 0;
}

/**
 * Report that `--provider` was removed, and return whether it was passed.
 *
 * The flag stored an API key that no code path ever read, so it configured
 * nothing while reporting success. Provider credentials come from the
 * environment. Failing loudly beats silently running a platform login,
 * which is what ignoring the flag would do.
 */
export async function reportRemovedProviderFlag(
  command: "login" | "logout",
  args: ParsedArgs,
): Promise<boolean> {
  const provider = typeof args.provider === "string" ? args.provider : undefined;
  if (!provider) return false;

  const { logError } = await import("../utils/index.ts");
  const envKey = REMOVED_PROVIDER_ENV_KEYS[provider] ?? "<PROVIDER>_API_KEY";

  logError(
    `'veryfront ${command} --provider' has been removed. It stored a key that was never used for inference.`,
  );
  console.log(`  Set ${envKey} in your environment or .env file instead.`);
  console.log(
    "  To keep the key out of the project, wrap the command with your secret manager,",
  );
  console.log(
    `  for example: op run --env-file=.env.local -- veryfront dev`,
  );
  console.log(
    `  Any key stored by the old command is still on disk at ~/.config/veryfront/tokens/ and can be deleted.`,
  );
  return true;
}
