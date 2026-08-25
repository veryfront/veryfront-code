/**
 * Bounded project-environment identity discovery for hosted runtime requests.
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
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";

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

export interface NamedProjectEnvironmentScope extends ProductionEnvironmentScope {
  environmentName: string;
  expectedEnvironmentId?: string;
}

export interface ReleaseBoundNamedProjectEnvironmentScope extends NamedProjectEnvironmentScope {
  expectedReleaseId: string;
}

interface NamedProjectEnvironmentIdentity {
  environmentId: string;
  activeReleaseId: string | null;
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

async function cacheKey(scope: NamedProjectEnvironmentScope): Promise<string> {
  const tokenBytes = encodeText.call(textEncoder, scope.token);
  const tokenDigest = new Uint8Array(await subtleDigest("SHA-256", tokenBytes));
  const credentialPrincipal = Array.from(
    tokenDigest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return [
    "named-environment-v1",
    frame(scope.apiBaseUrl),
    frame(scope.projectSlug),
    frame(scope.projectId ?? ""),
    frame(normalizeEnvironmentName(scope.environmentName)),
    credentialPrincipal,
  ].join("|");
}

function normalizeEnvironmentName(value: string): string {
  return value.toLowerCase();
}

function mapLookupError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) {
    return isErrorAcrossRealms(signal.reason)
      ? signal.reason
      : new DOMException("Project environment lookup was cancelled", "AbortError");
  }
  if (isVeryfrontError(error)) {
    if (error.status === 401) {
      return AUTHENTICATION_REQUIRED.create({
        detail: "Project credential was rejected during environment lookup",
      });
    }
    if (error.status === 403 || error.status === 404) {
      return PERMISSION_DENIED.create({
        detail: "Project credential cannot access environment metadata",
      });
    }
  }
  return NETWORK_ERROR.create({
    detail: "Project environment lookup failed",
    cause: error,
  });
}

function normalizeNamedScope(input: NamedProjectEnvironmentScope): NamedProjectEnvironmentScope {
  const scope = normalizeScope(input);
  if (
    typeof input.environmentName !== "string" ||
    !input.environmentName.trim() ||
    input.environmentName !== input.environmentName.trim() ||
    input.environmentName.length > 255
  ) {
    throw new TypeError("Environment lookup requires a canonical environment name");
  }
  if (
    input.expectedEnvironmentId !== undefined &&
    (typeof input.expectedEnvironmentId !== "string" || !input.expectedEnvironmentId.trim())
  ) {
    throw new TypeError("Expected environment ID must be non-empty");
  }
  return Object.freeze({
    ...scope,
    environmentName: input.environmentName,
    expectedEnvironmentId: input.expectedEnvironmentId,
  });
}

function parseNamedEnvironmentIdentity(
  body: unknown,
  environmentName: string,
): NamedProjectEnvironmentIdentity {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw NETWORK_ERROR.create({
      detail: "Project environment lookup returned an invalid response",
    });
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length > MAX_ENVIRONMENT_COUNT) {
    throw NETWORK_ERROR.create({
      detail: "Project environment lookup returned an invalid environment list",
    });
  }

  const normalizedEnvironmentName = normalizeEnvironmentName(environmentName);
  const matching: NamedProjectEnvironmentIdentity[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw NETWORK_ERROR.create({
        detail: "Project environment lookup returned an invalid environment entry",
      });
    }
    const id = (entry as { id?: unknown }).id;
    const name = (entry as { name?: unknown }).name;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
      throw NETWORK_ERROR.create({
        detail: "Project environment lookup returned an invalid environment entry",
      });
    }
    // The environments endpoint carries the active release nested under the
    // environment's deployment. `active_release_id` is read first so a flat
    // response keeps working, but the nested path is what production returns.
    const deployment = (entry as { deployment?: { release?: { id?: unknown } } | null }).deployment;
    const rawActiveReleaseId = (entry as { active_release_id?: unknown }).active_release_id ??
      deployment?.release?.id;
    if (
      rawActiveReleaseId !== undefined &&
      rawActiveReleaseId !== null &&
      (
        typeof rawActiveReleaseId !== "string" ||
        !rawActiveReleaseId.trim() ||
        rawActiveReleaseId !== rawActiveReleaseId.trim()
      )
    ) {
      throw NETWORK_ERROR.create({
        detail: "Project environment lookup returned an invalid active release identity",
      });
    }
    if (normalizeEnvironmentName(name) === normalizedEnvironmentName) {
      matching.push({
        environmentId: id,
        activeReleaseId: typeof rawActiveReleaseId === "string" ? rawActiveReleaseId : null,
      });
    }
  }

  if (matching.length !== 1) {
    throw NETWORK_ERROR.create({
      detail: matching.length === 0
        ? "Requested environment is not configured"
        : "Requested environment identity is ambiguous",
    });
  }
  return matching[0]!;
}

/** Resolve and briefly cache canonical named project-environment identities. */
export class ProjectEnvironmentIdentityResolver {
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
    return await this.resolveNamed(
      { ...input, environmentName: "production" },
      signal,
    );
  }

  /** Resolve one exact named environment and optionally bind its expected ID. */
  async resolveNamed(
    input: NamedProjectEnvironmentScope,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    const scope = normalizeNamedScope(input);
    const key = await cacheKey(scope);
    signal?.throwIfAborted();
    const cached = this.cache.get<string>(key);
    if (cached) {
      this.assertExpectedEnvironmentId(cached, scope.expectedEnvironmentId);
      return cached;
    }

    const identity = await this.fetchNamedEnvironmentIdentity(scope, signal);
    this.assertExpectedEnvironmentId(identity.environmentId, scope.expectedEnvironmentId);
    this.cache.set(key, identity.environmentId);
    return identity.environmentId;
  }

  /**
   * Resolve a named environment and bind it to its current immutable release.
   *
   * Active-release metadata is deliberately fetched on every call: unlike an
   * environment ID, it is mutable and must not inherit the identity cache TTL.
   */
  async resolveNamedForActiveRelease(
    input: ReleaseBoundNamedProjectEnvironmentScope,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    const scope = normalizeNamedScope(input);
    if (
      typeof input.expectedReleaseId !== "string" ||
      !input.expectedReleaseId.trim() ||
      input.expectedReleaseId !== input.expectedReleaseId.trim()
    ) {
      throw new TypeError("Expected release ID must be canonical and non-empty");
    }

    const identity = await this.fetchNamedEnvironmentIdentity(scope, signal);
    this.assertExpectedEnvironmentId(identity.environmentId, scope.expectedEnvironmentId);
    if (identity.activeReleaseId !== input.expectedReleaseId) {
      throw PERMISSION_DENIED.create({
        detail: "Signed release identity does not match the environment active release",
      });
    }
    return identity.environmentId;
  }

  private async fetchNamedEnvironmentIdentity(
    scope: NamedProjectEnvironmentScope,
    signal?: AbortSignal,
  ): Promise<NamedProjectEnvironmentIdentity> {
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
      return parseNamedEnvironmentIdentity(body, scope.environmentName);
    } catch (error) {
      throw mapLookupError(error, signal);
    }
  }

  private assertExpectedEnvironmentId(
    actualEnvironmentId: string,
    expectedEnvironmentId: string | undefined,
  ): void {
    if (expectedEnvironmentId !== undefined && actualEnvironmentId !== expectedEnvironmentId) {
      throw PERMISSION_DENIED.create({
        detail: "Signed environment identity does not match project metadata",
      });
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Backwards-compatible production-only resolver name. */
export class ProductionEnvironmentResolver extends ProjectEnvironmentIdentityResolver {}
