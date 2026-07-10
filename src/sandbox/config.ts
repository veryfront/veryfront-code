import { CONFIG_INVALID } from "#veryfront/errors/error-registry.ts";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { logger } from "#veryfront/utils";
import type { SandboxOptions } from "./types.ts";

const PRODUCTION_API_URL = "https://api.veryfront.com";

export function resolveSandboxApiUrl(options: SandboxOptions = {}): string {
  const url = options.apiUrl || getHostEnv("VERYFRONT_API_URL");
  if (url) return url;

  // No explicit URL configured — fall back to production. Log a warning so
  // staging or CI environments that forget VERYFRONT_API_URL are visible.
  logger.warn(
    "[sandbox] VERYFRONT_API_URL is not set; falling back to production API. " +
      "Set VERYFRONT_API_URL explicitly in non-production environments.",
  );
  return PRODUCTION_API_URL;
}

export function resolveSandboxAuthToken(options: SandboxOptions = {}): string {
  const authToken = options.authToken?.trim() || getVeryfrontCloudAuthToken();
  if (authToken) return authToken;

  throw CONFIG_INVALID.create({
    detail:
      "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
  });
}
