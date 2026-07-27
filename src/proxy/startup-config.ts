import { ENV_VAR_MISSING } from "#veryfront/errors";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { isProduction } from "#veryfront/platform/environment.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalProjectSlug,
} from "#veryfront/utils/project-identity.ts";
import { isAbsolute, normalize } from "#veryfront/compat/path/index.ts";
import { isIP } from "node:net";
import type { ProxyConfig } from "./handler.ts";
import { parseProxyDrainTimeoutMs } from "./request-drain.ts";
import { MAX_PROXY_TIMER_DELAY_MS } from "./timing.ts";

const DEFAULT_API_BASE_URL = "https://api.veryfront.com";
const DEFAULT_DEVELOPMENT_SERVER_URL = "http://localhost:3001";
const DEFAULT_BIND_HOST = "0.0.0.0";
const DEFAULT_BIND_PORT = 8_080;
const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_SERVER_RETRY_COUNT = 1;
const DEFAULT_SERVER_RETRY_DELAY_MS = 100;
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;
const DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS = 4_000;
const MAX_URL_CODE_UNITS = 4_096;
const MAX_ENVIRONMENT_VALUE_CODE_UNITS = 1024 * 1_024;
const MAX_LOCAL_PROJECTS = 1_000;
const MAX_API_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_SERVER_REQUEST_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_SERVER_RETRY_COUNT = 5;
const MAX_SERVER_RETRY_DELAY_MS = 60_000;
const MAX_EXPECTED_REPLICAS = 10_000;
const MAX_OAUTH_CLIENT_ID_CODE_UNITS = 4_096;
const MAX_OAUTH_CLIENT_SECRET_CODE_UNITS = 64 * 1_024;
const LOCAL_PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type ReadEnvironment = (name: string) => string | undefined;

export interface ProxyStartupConfig {
  readonly production: boolean;
  readonly proxyConfig: ProxyConfig;
  readonly binding: Readonly<{
    hostname: string;
    port: number;
  }>;
  readonly productionServerUrl: string;
  readonly apiInternalUrl: string;
  readonly apiInternalUser: string;
  readonly apiInternalPass: string;
  readonly apiRequestTimeoutMs: number;
  readonly serverRequestTimeoutMs: number;
  readonly serverRetryCount: number;
  readonly serverRetryDelayMs: number;
  readonly shutdownDrainTimeoutMs: number;
  readonly shutdownCleanupTimeoutMs: number;
  readonly routingInvalidationSecret: string;
  readonly expectedReplicas: number | undefined;
}

function readEnvironmentValue(
  readEnvironment: ReadEnvironment,
  name: string,
): string | undefined {
  const value = readEnvironment(name);
  if (
    value !== undefined &&
    (typeof value !== "string" ||
      value.length > MAX_ENVIRONMENT_VALUE_CODE_UNITS)
  ) {
    throw new TypeError(`${name} must be a bounded string`);
  }
  return value;
}

function parseInteger(
  rawValue: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (rawValue === undefined || rawValue === "") return fallback;
  if (!/^\d+$/.test(rawValue)) {
    throw new TypeError(`${name} must be a decimal integer`);
  }
  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${name} must be between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function parseOptionalPositiveInteger(
  rawValue: string | undefined,
  name: string,
  maximum: number,
): number | undefined {
  if (rawValue === undefined || rawValue === "") return undefined;
  return parseInteger(rawValue, 1, name, 1, maximum);
}

function parseHttpUrl(
  value: unknown,
  label: string,
  allowPath: boolean,
): URL {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_URL_CODE_UNITS ||
    value !== value.trim() ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (!allowPath && parsed.pathname !== "/")
  ) {
    throw new TypeError(
      `${label} must be an HTTP(S) ${allowPath ? "URL" : "origin"}`,
    );
  }
  return parsed;
}

function normalizeApiBaseUrl(value: string): string {
  const parsed = parseHttpUrl(value, "Proxy API base URL", true);
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${path}`;
}

function normalizeServerOrigin(value: string): string {
  return parseHttpUrl(value, "Production server URL", false).origin;
}

function normalizeBindHostname(value: string): string {
  if (
    value.length === 0 ||
    value.length > 253 ||
    value !== value.trim() ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("Proxy bind hostname is invalid");
  }
  const unwrapped = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (isIP(unwrapped) !== 0) return unwrapped;
  const normalized = unwrapped.toLowerCase();
  if (/^[0-9.]+$/.test(normalized)) {
    throw new TypeError("Proxy bind hostname is invalid");
  }
  const labels = normalized.endsWith(".")
    ? normalized.slice(0, -1).split(".")
    : normalized.split(".");
  if (
    labels.length === 0 ||
    labels.some((label) =>
      label.length === 0 ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    throw new TypeError("Proxy bind hostname is invalid");
  }
  return normalized;
}

function parseBinding(
  proxyUrlValue: string | undefined,
  hostValue: string | undefined,
  portValue: string | undefined,
): ProxyStartupConfig["binding"] {
  if (proxyUrlValue) {
    if (hostValue || portValue) {
      throw new TypeError(
        "VERYFRONT_PROXY_URL cannot be combined with HOST or PORT",
      );
    }
    const parsed = parseHttpUrl(proxyUrlValue, "VERYFRONT_PROXY_URL", false);
    const port = parsed.port
      ? parseInteger(parsed.port, 0, "VERYFRONT_PROXY_URL port", 1, 65_535)
      : parsed.protocol === "https:"
      ? 443
      : 80;
    return Object.freeze({
      hostname: normalizeBindHostname(parsed.hostname),
      port,
    });
  }
  return Object.freeze({
    hostname: normalizeBindHostname(hostValue || DEFAULT_BIND_HOST),
    port: parseInteger(
      portValue,
      DEFAULT_BIND_PORT,
      "PORT",
      1,
      65_535,
    ),
  });
}

function parseLocalProjects(
  rawValue: string | undefined,
): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  if (rawValue === undefined || rawValue === "") return Object.freeze(result);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue) as unknown;
  } catch (error) {
    throw new TypeError("LOCAL_PROJECTS must be valid JSON", { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("LOCAL_PROJECTS must be a JSON object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(parsed);
  const entries = Object.entries(descriptors);
  if (entries.length > MAX_LOCAL_PROJECTS) {
    throw new RangeError(
      `LOCAL_PROJECTS cannot contain more than ${MAX_LOCAL_PROJECTS} entries`,
    );
  }
  for (const [slug, descriptor] of entries) {
    const path = "value" in descriptor ? descriptor.value : undefined;
    if (
      !isCanonicalProjectSlug(slug) ||
      !LOCAL_PROJECT_SLUG_PATTERN.test(slug) ||
      typeof path !== "string" ||
      path.length === 0 ||
      !isAbsolute(path) ||
      normalize(path) !== path ||
      hasProjectIdentityControlCharacters(path)
    ) {
      throw new TypeError(`LOCAL_PROJECTS contains an invalid entry: ${slug}`);
    }
    Object.defineProperty(result, slug, {
      configurable: false,
      enumerable: true,
      value: path,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function validateCredential(
  value: string,
  label: string,
  maximum: number,
  requireCanonicalWhitespace: boolean,
): string {
  if (
    value.length > maximum ||
    hasProjectIdentityControlCharacters(value) ||
    (requireCanonicalWhitespace && value !== value.trim())
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function readProxyStartupConfig(
  readEnvironment: ReadEnvironment = getEnv,
  production: boolean = isProduction(),
): ProxyStartupConfig {
  if (typeof readEnvironment !== "function") {
    throw new TypeError("Proxy environment reader must be a function");
  }
  if (typeof production !== "boolean") {
    throw new TypeError("Proxy production flag must be a boolean");
  }
  const read = (name: string): string | undefined => readEnvironmentValue(readEnvironment, name);

  const apiClientId = validateCredential(
    read("VERYFRONT_PROXY_API_CLIENT_ID") || "",
    "VERYFRONT_PROXY_API_CLIENT_ID",
    MAX_OAUTH_CLIENT_ID_CODE_UNITS,
    true,
  );
  const apiClientSecret = validateCredential(
    read("VERYFRONT_PROXY_API_CLIENT_SECRET") || "",
    "VERYFRONT_PROXY_API_CLIENT_SECRET",
    MAX_OAUTH_CLIENT_SECRET_CODE_UNITS,
    false,
  );
  const apiBaseUrl = normalizeApiBaseUrl(
    read("VERYFRONT_PROXY_API_BASE_URL") || DEFAULT_API_BASE_URL,
  );
  const localProjects = parseLocalProjects(read("LOCAL_PROJECTS"));
  if (production && Object.keys(localProjects).length > 0) {
    throw new Error("LOCAL_PROJECTS is development-only and cannot be configured in production");
  }

  const serverUrlValue = read("VERYFRONT_SERVER_URL");
  if (!serverUrlValue && production) {
    throw ENV_VAR_MISSING.create({
      detail:
        "VERYFRONT_SERVER_URL is required in production: refusing to fall back to http://localhost:3001.",
    });
  }
  const productionServerUrl = normalizeServerOrigin(
    serverUrlValue || DEFAULT_DEVELOPMENT_SERVER_URL,
  );
  const apiInternalUrl = normalizeApiBaseUrl(
    read("VERYFRONT_API_INTERNAL_URL") || apiBaseUrl,
  );
  const apiInternalUser = read("VERYFRONT_API_INTERNAL_USER") || "";
  const apiInternalPass = read("VERYFRONT_API_INTERNAL_PASS") || "";

  const expectedReplicas = parseOptionalPositiveInteger(
    read("VERYFRONT_PROXY_EXPECTED_REPLICAS"),
    "VERYFRONT_PROXY_EXPECTED_REPLICAS",
    MAX_EXPECTED_REPLICAS,
  );
  if (production && expectedReplicas === undefined) {
    throw new Error(
      "VERYFRONT_PROXY_EXPECTED_REPLICAS must be a positive integer in production",
    );
  }
  const routingInvalidationSecret = read("VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET") ?? "";
  if (
    production &&
    new TextEncoder().encode(routingInvalidationSecret).byteLength < 32
  ) {
    throw new Error(
      "VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET must contain at least 32 bytes in production",
    );
  }

  const proxyConfig: ProxyConfig = Object.freeze({
    apiBaseUrl,
    apiClientId,
    apiClientSecret,
    previewApiClientId: apiClientId,
    previewApiClientSecret: apiClientSecret,
    localProjects,
  });

  return Object.freeze({
    production,
    proxyConfig,
    binding: parseBinding(
      read("VERYFRONT_PROXY_URL"),
      read("HOST"),
      read("PORT"),
    ),
    productionServerUrl,
    apiInternalUrl,
    apiInternalUser,
    apiInternalPass,
    apiRequestTimeoutMs: parseInteger(
      read("VERYFRONT_API_REQUEST_TIMEOUT_MS"),
      DEFAULT_API_REQUEST_TIMEOUT_MS,
      "VERYFRONT_API_REQUEST_TIMEOUT_MS",
      1,
      MAX_API_REQUEST_TIMEOUT_MS,
    ),
    serverRequestTimeoutMs: parseInteger(
      read("VERYFRONT_SERVER_REQUEST_TIMEOUT_MS"),
      DEFAULT_SERVER_REQUEST_TIMEOUT_MS,
      "VERYFRONT_SERVER_REQUEST_TIMEOUT_MS",
      1,
      MAX_SERVER_REQUEST_TIMEOUT_MS,
    ),
    serverRetryCount: parseInteger(
      read("VERYFRONT_SERVER_RETRY_COUNT"),
      DEFAULT_SERVER_RETRY_COUNT,
      "VERYFRONT_SERVER_RETRY_COUNT",
      0,
      MAX_SERVER_RETRY_COUNT,
    ),
    serverRetryDelayMs: parseInteger(
      read("VERYFRONT_SERVER_RETRY_DELAY_MS"),
      DEFAULT_SERVER_RETRY_DELAY_MS,
      "VERYFRONT_SERVER_RETRY_DELAY_MS",
      0,
      MAX_SERVER_RETRY_DELAY_MS,
    ),
    shutdownDrainTimeoutMs: parseProxyDrainTimeoutMs(
      read("SHUTDOWN_DRAIN_TIMEOUT_MS"),
      DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
    ),
    shutdownCleanupTimeoutMs: parseInteger(
      read("SHUTDOWN_CLEANUP_TIMEOUT_MS"),
      DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS,
      "SHUTDOWN_CLEANUP_TIMEOUT_MS",
      0,
      MAX_PROXY_TIMER_DELAY_MS,
    ),
    routingInvalidationSecret,
    expectedReplicas,
  });
}
