import { CONFIG_INVALID } from "#veryfront/errors/error-registry.ts";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { SandboxOptions } from "./types.ts";

export function resolveSandboxApiUrl(options: SandboxOptions = {}): string {
  return options.apiUrl ||
    getHostEnv("VERYFRONT_API_URL") ||
    "https://api.veryfront.com";
}

export function resolveSandboxAuthToken(options: SandboxOptions = {}): string {
  const authToken = options.authToken?.trim() || getVeryfrontCloudAuthToken();
  if (authToken) return authToken;

  throw CONFIG_INVALID.create({
    detail:
      "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
  });
}
