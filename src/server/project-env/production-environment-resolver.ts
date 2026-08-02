/**
 * Bounded production-environment discovery for hosted runtime requests.
 *
 * @module server/project-env/production-environment-resolver
 */

import {
  createVeryfrontApiTransport,
  type VeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import {
  AUTHENTICATION_REQUIRED,
  isVeryfrontError,
  NETWORK_ERROR,
  PERMISSION_DENIED,
} from "#veryfront/errors";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";

export const MAX_ENVIRONMENT_LIST_RESPONSE_BYTES = 256 * 1024;
const MAX_ENVIRONMENT_COUNT = 100;
const ENVIRONMENT_LOOKUP_TIMEOUT_MS = 5_000;
const ENVIRONMENT_ID_CACHE_TTL_MS = 5 * 60_000;

export interface ProductionEnvironmentScope {
  apiBaseUrl: string;
  projectSlug: string;
  projectId?: string;
  token: string;
}

function frame(value: string): string {
  return `${value.length}:${value}`;
}

function normalizeScope(scope: ProductionEnvironmentScope): ProductionEnvironmentScope {
  if (typeof scope?.apiBaseUrl !== "string" || !scope.apiBaseUrl) {
    throw new TypeError("Production environment lookup requires an API base URL");
  }
  if (typeof scope.projectSlug !== "string" || !scope.projectSlug.trim()) {
    throw new TypeError("Production environment lookup requires a project slug");
  }
  if (
    scope.projectId !== undefined &&
    (typeof scope.projectId !== "string" || !scope.projectId.trim())
  ) {
    throw new TypeError("Production environment lookup project ID must be non-empty");
  }
  if (typeof scope.token !== "string" || !scope.token) {
    throw AUTHENTICATION_REQUIRED.create({
      detail: "Production environment lookup requires a project credential",
    });
  }
  return Object.freeze({ ...scope });
}

const encodeText = TextEncoder.prototype.encode;
const subtleDigest = crypto.subtle.digest.bind(crypto.subtle);
const textEncoder = new TextEncoder();

async function cacheKey(scope: ProductionEnvironmentScope): Promise<string> {
  const tokenBytes = encodeText.call(textEncoder, scope.token);
  const tokenDigest = new Uint8Array(await subtleDigest("SHA-256", tokenBytes));
  const credentialPrincipal = Array.from(
    tokenDigest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    "production-environment-v1",
    frame(scope.apiBaseUrl),
    frame(scope.projectSlug),
    frame(scope.projectId ?? ""),
    credentialPrincipal,
  ].join("|");
}

function mapLookupError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Production environment lookup was cancelled", "AbortError");
  }
  if (isVeryfrontError(error)) {
    if (error.status === 401) {
      return AUTHENTICATION_REQUIRED.create({
        detail: "Project credential was rejected during environment lookup",
      });
    }
    if (error.status === 403 || error.status === 404) {
      return PERMISSION_DENIED.create({
        detail: "Project credential cannot access production environment metadata",
      });
    }
  }
  return NETWORK_ERROR.create({
    detail: "Production environment lookup failed",
    cause: error,
  });
}

function parseProductionEnvironmentId(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw NETWORK_ERROR.create({
      detail: "Production environment lookup returned an invalid response",
    });
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length > MAX_ENVIRONMENT_COUNT) {
    throw NETWORK_ERROR.create({
      detail: "Production environment lookup returned an invalid environment list",
    });
  }

  const productionIds: string[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw NETWORK_ERROR.create({
        detail: "Production environment lookup returned an invalid environment entry",
      });
    }
    const id = (entry as { id?: unknown }).id;
    const name = (entry as { name?: unknown }).name;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
      throw NETWORK_ERROR.create({
        detail: "Production environment lookup returned an invalid environment entry",
      });
    }
    if (name === "production") productionIds.push(id);
  }

  if (productionIds.length !== 1) {
    throw NETWORK_ERROR.create({
      detail: productionIds.length === 0
        ? "Production environment is not configured"
        : "Production environment identity is ambiguous",
    });
  }
  return productionIds[0]!;
}

/** Resolve and briefly cache one canonical project's production environment ID. */
export class ProductionEnvironmentResolver {
  private readonly cache = new LRUCacheAdapter({
    maxEntries: 1_000,
    ttlMs: ENVIRONMENT_ID_CACHE_TTL_MS,
  });

  constructor(
    private readonly options: {
      timeoutMs?: number;
      maxResponseBytes?: number;
    } = {},
  ) {}

  async resolve(
    input: ProductionEnvironmentScope,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    const scope = normalizeScope(input);
    const key = await cacheKey(scope);
    signal?.throwIfAborted();
    const cached = this.cache.get<string>(key);
    if (cached) return cached;

    let transport: VeryfrontApiTransport<unknown>;
    try {
      transport = createVeryfrontApiTransport({
        baseUrl: scope.apiBaseUrl,
        getToken: () => scope.token,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        timeoutMs: this.options.timeoutMs ?? ENVIRONMENT_LOOKUP_TIMEOUT_MS,
        wrapFinalError: (error) => error,
      });
      const body = await transport.request(
        `/projects/${encodeURIComponent(scope.projectSlug)}/environments`,
        {
          headers: { Accept: "application/json" },
          maxResponseBytes: this.options.maxResponseBytes ??
            MAX_ENVIRONMENT_LIST_RESPONSE_BYTES,
          redirect: "error",
          includeErrorBodyInDiagnostics: false,
          signal,
        },
      );
      const environmentId = parseProductionEnvironmentId(body);
      this.cache.set(key, environmentId);
      return environmentId;
    } catch (error) {
      throw mapLookupError(error, signal);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
