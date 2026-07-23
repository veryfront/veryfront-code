import {
  type GenerateOpenAPISpecRequest,
  MAX_OPENAPI_WORKER_MODULE_BYTES,
  MAX_OPENAPI_WORKER_ROUTES,
  MAX_OPENAPI_WORKER_TOTAL_MODULE_BYTES,
} from "#veryfront/security/sandbox/worker-types.ts";
import { parseSourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";

const encoder = new TextEncoder();
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PROJECT_ENV_KEYS = 512;
const MAX_PROJECT_ENV_BYTES = 2 * 1024 * 1024;
const MAX_ENV_KEY_LENGTH = 256;
const MAX_ENV_VALUE_LENGTH = 256 * 1024;

function assertBoundedString(
  value: unknown,
  name: string,
  maximumBytes: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    encoder.encode(value).byteLength > maximumBytes
  ) {
    throw new TypeError(`OpenAPI worker ${name} is invalid`);
  }
}

function assertProjectEnvironment(value: unknown): void {
  if (value === undefined) return;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("OpenAPI worker project environment is invalid");
  }

  let entries: Array<[string, unknown]>;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("OpenAPI worker project environment is invalid");
    }
    entries = Object.entries(value);
  } catch {
    throw new TypeError("OpenAPI worker project environment is invalid");
  }
  if (entries.length > MAX_PROJECT_ENV_KEYS) {
    throw new RangeError("OpenAPI worker project environment exceeds the key limit");
  }

  let totalBytes = 0;
  for (const [key, entryValue] of entries) {
    if (
      key.length === 0 || key.length > MAX_ENV_KEY_LENGTH || !ENV_KEY_PATTERN.test(key) ||
      typeof entryValue !== "string" || entryValue.length > MAX_ENV_VALUE_LENGTH
    ) {
      throw new TypeError("OpenAPI worker project environment is invalid");
    }
    totalBytes += encoder.encode(key).byteLength + encoder.encode(entryValue).byteLength;
    if (totalBytes > MAX_PROJECT_ENV_BYTES) {
      throw new RangeError("OpenAPI worker project environment exceeds the byte limit");
    }
  }
}

/** Validate the executable payload before and after it crosses the Worker boundary. */
export function assertValidOpenAPIWorkerRequest(
  request: GenerateOpenAPISpecRequest,
): void {
  if (request.type !== "generate-openapi-spec") {
    throw new TypeError("OpenAPI worker request type is invalid");
  }
  assertBoundedString(request.id, "request ID", 256);
  assertBoundedString(request.projectDir, "project directory", 8_192);
  if (!Array.isArray(request.routes) || request.routes.length > MAX_OPENAPI_WORKER_ROUTES) {
    throw new RangeError("OpenAPI worker route count exceeds the limit");
  }

  let totalModuleBytes = 0;
  const patterns = new Set<string>();
  for (const route of request.routes) {
    if (!route || typeof route !== "object") {
      throw new TypeError("OpenAPI worker route is invalid");
    }
    assertBoundedString(route.pattern, "route pattern", 8_192);
    if (!route.pattern.startsWith("/") || patterns.has(route.pattern)) {
      throw new TypeError("OpenAPI worker route pattern is invalid");
    }
    patterns.add(route.pattern);
    assertBoundedString(route.moduleCode, "module code", MAX_OPENAPI_WORKER_MODULE_BYTES);
    totalModuleBytes += encoder.encode(route.moduleCode).byteLength;
    if (totalModuleBytes > MAX_OPENAPI_WORKER_TOTAL_MODULE_BYTES) {
      throw new RangeError("OpenAPI worker module payload exceeds the total size limit");
    }
  }

  if (!request.info || typeof request.info !== "object") {
    throw new TypeError("OpenAPI worker info is invalid");
  }
  assertBoundedString(request.info.title, "title", 65_536);
  assertBoundedString(request.info.version, "version", 65_536);
  if (request.info.description !== undefined) {
    assertBoundedString(request.info.description, "description", 65_536, true);
  }
  if (!Array.isArray(request.info.servers) || request.info.servers.length > 100) {
    throw new TypeError("OpenAPI worker servers are invalid");
  }
  for (const server of request.info.servers) {
    if (!server || typeof server !== "object") {
      throw new TypeError("OpenAPI worker server is invalid");
    }
    assertBoundedString(server.url, "server URL", 8_192);
    if (server.description !== undefined) {
      assertBoundedString(server.description, "server description", 65_536, true);
    }
    let parsed: URL;
    try {
      parsed = new URL(server.url);
    } catch {
      throw new TypeError("OpenAPI worker server URL is invalid");
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
      throw new TypeError("OpenAPI worker server URL is not allowed");
    }
  }

  parseSourceIntegrationPolicyManifest(request.sourceIntegrationPolicy);
  assertProjectEnvironment(request.projectEnv);
}
