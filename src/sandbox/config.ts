import { CONFIG_INVALID } from "#veryfront/errors";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { SandboxOptions } from "./types.ts";

export const DEFAULT_SANDBOX_STARTUP_TIMEOUT_MS = 180_000;
export const DEFAULT_SANDBOX_POLL_INTERVAL_MS = 2_000;
export const MAX_SANDBOX_TIMER_MS = 2_147_483_647;
const MAX_SANDBOX_API_URL_BYTES = 16 * 1024;
const MAX_SANDBOX_AUTH_TOKEN_BYTES = 64 * 1024;
export const MAX_SANDBOX_PROJECT_ID_BYTES = 4 * 1024;
const textEncoder = new TextEncoder();

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function resolveHttpBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw CONFIG_INVALID.create({ detail: "Sandbox API URL must be a non-empty string" });
  }
  if (
    normalized.length > MAX_SANDBOX_API_URL_BYTES ||
    textEncoder.encode(normalized).byteLength > MAX_SANDBOX_API_URL_BYTES
  ) {
    throw CONFIG_INVALID.create({
      detail: `Sandbox API URL exceeds ${MAX_SANDBOX_API_URL_BYTES} bytes`,
    });
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch (cause) {
    throw CONFIG_INVALID.create({
      detail: "Sandbox API URL must be an absolute URL",
      cause,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw CONFIG_INVALID.create({
      detail: "Sandbox API URL must use http or https",
    });
  }
  if (url.username || url.password) {
    throw CONFIG_INVALID.create({
      detail: "Sandbox API URL must not contain credentials",
    });
  }
  if (url.search || url.hash) {
    throw CONFIG_INVALID.create({
      detail: "Sandbox API URL must not contain a query string or fragment",
    });
  }
  return normalized;
}

function resolveSafeIntegerOption(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum = MAX_SANDBOX_TIMER_MS,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw CONFIG_INVALID.create({
      detail: `${label} must be a safe integer between ${minimum} and ${maximum}`,
    });
  }
  return resolved;
}

export function resolveSandboxApiUrl(options: SandboxOptions = {}): string {
  if (options.apiUrl !== undefined) {
    if (typeof options.apiUrl !== "string") {
      throw CONFIG_INVALID.create({ detail: "Sandbox API URL must be a string" });
    }
    return resolveHttpBaseUrl(options.apiUrl);
  }
  const ambientUrl = getHostEnv("VERYFRONT_API_URL");
  if (ambientUrl?.trim()) return resolveHttpBaseUrl(ambientUrl);

  // Fail closed: never silently default to the production API while attaching an
  // ambient auth token — a missing VERYFRONT_API_URL in staging/CI would
  // otherwise send credentialed traffic to prod. Require an explicit value.
  throw CONFIG_INVALID.create({
    detail: "Sandbox API URL not configured. Set VERYFRONT_API_URL or pass apiUrl explicitly.",
  });
}

export function resolveSandboxAuthToken(options: SandboxOptions = {}): string {
  let authToken: string | undefined;
  if (options.authToken !== undefined) {
    if (typeof options.authToken !== "string") {
      throw CONFIG_INVALID.create({ detail: "Sandbox auth token must be a string" });
    }
    authToken = options.authToken.trim();
    if (!authToken) {
      throw CONFIG_INVALID.create({
        detail: "Sandbox auth token must be a non-empty string",
      });
    }
  } else {
    authToken = getVeryfrontCloudAuthToken()?.trim();
  }
  if (!authToken) {
    throw CONFIG_INVALID.create({
      detail:
        "Sandbox auth not configured. Set VERYFRONT_API_TOKEN, provide request-scoped Veryfront credentials, or pass authToken explicitly.",
    });
  }

  if (containsControlCharacter(authToken)) {
    throw CONFIG_INVALID.create({
      detail: "Sandbox auth token must not contain control characters",
    });
  }
  if (
    authToken.length > MAX_SANDBOX_AUTH_TOKEN_BYTES ||
    textEncoder.encode(authToken).byteLength > MAX_SANDBOX_AUTH_TOKEN_BYTES
  ) {
    throw CONFIG_INVALID.create({
      detail: `Sandbox auth token exceeds ${MAX_SANDBOX_AUTH_TOKEN_BYTES} bytes`,
    });
  }
  return authToken;
}

export function resolveSandboxProjectId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw CONFIG_INVALID.create({ detail: "Sandbox projectId must be a string" });
  }
  const projectId = value.trim();
  if (!projectId) return undefined;
  if (projectId.includes("\0")) {
    throw CONFIG_INVALID.create({ detail: "Sandbox projectId must not contain NUL characters" });
  }
  if (
    projectId.length > MAX_SANDBOX_PROJECT_ID_BYTES ||
    textEncoder.encode(projectId).byteLength > MAX_SANDBOX_PROJECT_ID_BYTES
  ) {
    throw CONFIG_INVALID.create({
      detail: `Sandbox projectId exceeds ${MAX_SANDBOX_PROJECT_ID_BYTES} bytes`,
    });
  }
  return projectId;
}

export function resolveSandboxStartupTimeoutMs(options: SandboxOptions = {}): number {
  return resolveSafeIntegerOption(
    options.startupTimeoutMs,
    DEFAULT_SANDBOX_STARTUP_TIMEOUT_MS,
    "Sandbox startupTimeoutMs",
    1,
  );
}

export function resolveSandboxPollIntervalMs(options: SandboxOptions = {}): number {
  return resolveSafeIntegerOption(
    options.pollIntervalMs,
    DEFAULT_SANDBOX_POLL_INTERVAL_MS,
    "Sandbox pollIntervalMs",
    1,
  );
}

export function resolveSandboxControlRequestTimeoutMs(
  options: SandboxOptions = {},
  fallback: number,
): number {
  return resolveSafeIntegerOption(
    options.controlRequestTimeoutMs,
    fallback,
    "Sandbox controlRequestTimeoutMs",
    0,
  );
}
