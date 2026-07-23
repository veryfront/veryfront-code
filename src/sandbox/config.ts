import { CONFIG_INVALID, INVALID_ARGUMENT } from "#veryfront/errors";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { SandboxOptions } from "./types.ts";
import { normalizeSandboxAuthToken, normalizeSandboxBaseUrl } from "./protocol.ts";

function validateSandboxOptions(options: unknown): asserts options is SandboxOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw INVALID_ARGUMENT.create({ detail: "Sandbox options must be an object" });
  }
}

export function resolveSandboxApiUrl(options: SandboxOptions = {}): string {
  validateSandboxOptions(options);
  if (options.apiUrl !== undefined) {
    return normalizeSandboxBaseUrl(options.apiUrl, "Sandbox API URL");
  }
  const environmentUrl = getHostEnv("VERYFRONT_API_URL");
  if (environmentUrl !== undefined) {
    return normalizeSandboxBaseUrl(environmentUrl, "Sandbox API URL");
  }

  // Fail closed: never silently default to the production API while attaching an
  // ambient auth token — a missing VERYFRONT_API_URL in staging/CI would
  // otherwise send credentialed traffic to prod. Require an explicit value.
  throw CONFIG_INVALID.create({
    detail: "Sandbox API URL not configured. Set VERYFRONT_API_URL or pass apiUrl explicitly.",
  });
}

export function resolveSandboxAuthToken(options: SandboxOptions = {}): string {
  validateSandboxOptions(options);
  if (options.authToken !== undefined) {
    return normalizeSandboxAuthToken(options.authToken);
  }
  const cloudAuthToken = getVeryfrontCloudAuthToken();
  if (cloudAuthToken) return normalizeSandboxAuthToken(cloudAuthToken);

  throw CONFIG_INVALID.create({
    detail:
      "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
  });
}
