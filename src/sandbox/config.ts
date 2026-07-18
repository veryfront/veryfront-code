import { CONFIG_INVALID } from "#veryfront/errors";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { SandboxOptions } from "./types.ts";

export function resolveSandboxApiUrl(options: SandboxOptions = {}): string {
  const url = options.apiUrl || getHostEnv("VERYFRONT_API_URL");
  if (url) return url;

  // Fail closed: never silently default to the production API while attaching an
  // ambient auth token — a missing VERYFRONT_API_URL in staging/CI would
  // otherwise send credentialed traffic to prod. Require an explicit value.
  throw CONFIG_INVALID.create({
    detail: "Sandbox API URL not configured. Set VERYFRONT_API_URL or pass apiUrl explicitly.",
  });
}

export function resolveSandboxAuthToken(options: SandboxOptions = {}): string {
  const authToken = options.authToken?.trim() || getVeryfrontCloudAuthToken();
  if (authToken) return authToken;

  throw CONFIG_INVALID.create({
    detail:
      "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
  });
}
