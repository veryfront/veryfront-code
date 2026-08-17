import {
  isCanonicalOpaqueProjectIdentifier,
  isCanonicalProjectSlug,
} from "#veryfront/utils/project-identity.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { readProxyResponseJson, settleProxyResponseBody } from "./response-body.ts";

const DEFAULT_LOOKUP_TIMEOUT_MS = 10_000;
const MAX_LOOKUP_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_INFLIGHT_LOOKUPS = 200;
const MAX_CONFIGURED_INFLIGHT_LOOKUPS = 10_000;
const MAX_METADATA_RESPONSE_BYTES = 512 * 1024;
const MAX_API_BASE_URL_CODE_UNITS = 2_048;
const MAX_LOOKUP_KEY_CODE_UNITS = 256;
const MAX_ENVIRONMENTS = 1_000;
const MAX_DOMAINS_PER_ENVIRONMENT = 100;
const MAX_USERS = 10_000;
const MAX_ENVIRONMENT_NAME_CODE_UNITS = 256;
const MAX_DOMAIN_CODE_UNITS = 253;
const MAX_TOKEN_CODE_UNITS = 64 * 1024;

export type ProxyLookupType = "domain" | "routing" | "access";

export interface ProjectLookupEnvironment {
  id: string;
  name: string;
  domains?: string[];
  active_release_id?: string | null;
  protected?: boolean;
}

export interface ProjectRoutingLookupResult {
  id: string;
  slug: string;
  environments: ProjectLookupEnvironment[];
}

export interface ProjectAccessLookupResult {
  id: string;
  slug: string;
  users?: Array<{ id: string }>;
  environments: ProjectLookupEnvironment[];
}

export interface DomainLookupResult extends ProjectRoutingLookupResult {
  users?: Array<{ id: string }>;
}

interface ProjectMetadataLogger {
  debug(message: string, extra?: Record<string, unknown>): void;
}

export interface ProjectMetadataClientOptions {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  logger?: ProjectMetadataLogger;
  timeoutMs?: number;
  maxInflight?: number;
}

export interface ProjectMetadataLookupOptions {
  signal?: AbortSignal;
}

export interface ProjectMetadataClient {
  lookupDomain(
    lookupKey: string,
    token: string,
    options?: ProjectMetadataLookupOptions,
  ): Promise<DomainLookupResult | null>;
  lookupRouting(
    lookupKey: string,
    token: string,
    options?: ProjectMetadataLookupOptions,
  ): Promise<ProjectRoutingLookupResult | null>;
  lookupAccess(
    lookupKey: string,
    token: string,
    includeUsers: boolean,
    options?: ProjectMetadataLookupOptions,
  ): Promise<ProjectAccessLookupResult | null>;
}

export class ProxyLookupAuthError extends Error {
  constructor(
    readonly lookupType: ProxyLookupType,
    readonly status: 401 | 403,
  ) {
    super(`Proxy ${lookupType} lookup rejected the service token`);
    this.name = "ProxyLookupAuthError";
  }
}

export interface ProxyLookupFailureUpstreamContext {
  /** HTTP status returned by the metadata API for the failed lookup. */
  upstreamStatus?: number;
}

export class ProxyLookupFailure extends Error {
  readonly upstreamStatus?: number;

  constructor(
    readonly lookupType: ProxyLookupType,
    readonly publicStatus: 502 | 503 | 504,
    message: string,
    options?: ErrorOptions & ProxyLookupFailureUpstreamContext,
  ) {
    super(message, options);
    this.name = "ProxyLookupFailure";
    this.upstreamStatus = options?.upstreamStatus;
  }
}

function resolveApiBaseUrl(value: string): URL {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_API_BASE_URL_CODE_UNITS
  ) {
    throw new TypeError("Proxy metadata API base URL must be a bounded HTTP(S) URL");
  }
  const base = new URL(value);
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new TypeError(
      "Proxy metadata API base URL must be HTTP(S) without credentials, query, or fragment",
    );
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

function resolveTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LOOKUP_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LOOKUP_TIMEOUT_MS) {
    throw new RangeError(
      `Proxy metadata timeout must be an integer between 1 and ${MAX_LOOKUP_TIMEOUT_MS}ms`,
    );
  }
  return value;
}

function resolveMaxInflight(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_INFLIGHT_LOOKUPS;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_CONFIGURED_INFLIGHT_LOOKUPS
  ) {
    throw new RangeError(
      `Proxy metadata maxInflight must be an integer between 1 and ${MAX_CONFIGURED_INFLIGHT_LOOKUPS}`,
    );
  }
  return value;
}

function containsForbiddenLookupCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x20 ||
      code === 0x7f ||
      code === 0x2f ||
      code === 0x40 ||
      code === 0x3f ||
      code === 0x23
    ) {
      return true;
    }
  }
  return false;
}

export function normalizeProjectLookupKey(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LOOKUP_KEY_CODE_UNITS + 6 ||
    value !== value.trim() ||
    containsForbiddenLookupCharacter(value)
  ) {
    throw new TypeError("Proxy project lookup key is invalid");
  }

  const withoutPort = value.replace(/:\d+$/u, "");
  if (
    withoutPort.length === 0 ||
    withoutPort.length > MAX_LOOKUP_KEY_CODE_UNITS ||
    withoutPort.includes(":")
  ) {
    throw new TypeError("Proxy project lookup key is invalid");
  }

  const normalized = withoutPort.toLowerCase().replace(/\.$/u, "");
  if (isCanonicalProjectSlug(normalized)) return normalized;

  try {
    const parsed = new URL(`http://${normalized}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.hostname !== normalized ||
      parsed.hostname.length === 0 ||
      parsed.hostname.length > MAX_DOMAIN_CODE_UNITS
    ) {
      throw new TypeError("Proxy project lookup key is invalid");
    }
    return parsed.hostname;
  } catch {
    throw new TypeError("Proxy project lookup key is invalid");
  }
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxCodeUnits: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxCodeUnits ||
    value !== value.trim()
  ) {
    throw new TypeError(`Proxy metadata returned an invalid ${field}`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      throw new TypeError(`Proxy metadata returned an invalid ${field}`);
    }
  }
  return value;
}

function requireOpaqueId(value: unknown, field: string): string {
  if (!isCanonicalOpaqueProjectIdentifier(value)) {
    throw new TypeError(`Proxy metadata returned an invalid ${field}`);
  }
  return value;
}

function requireProjectSlug(value: unknown): string {
  if (typeof value !== "string" || !isCanonicalProjectSlug(value)) {
    throw new TypeError("Proxy metadata returned an invalid project slug");
  }
  return value;
}

function normalizeUpstreamDomain(value: unknown): string {
  const domain = requireBoundedString(
    value,
    "environment domain",
    MAX_DOMAIN_CODE_UNITS + 1,
  ).toLowerCase().replace(/\.$/u, "");
  if (containsForbiddenLookupCharacter(domain) || domain.includes(":")) {
    throw new TypeError("Proxy metadata returned an invalid environment domain");
  }
  try {
    const parsed = new URL(`http://${domain}`);
    if (
      parsed.hostname !== domain ||
      parsed.pathname !== "/" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash ||
      parsed.hostname.length > MAX_DOMAIN_CODE_UNITS
    ) {
      throw new TypeError("Proxy metadata returned an invalid environment domain");
    }
    return parsed.hostname;
  } catch {
    throw new TypeError("Proxy metadata returned an invalid environment domain");
  }
}

function parseUsers(value: unknown): Array<{ id: string }> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_USERS) {
    throw new TypeError("Proxy metadata returned invalid project users");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Proxy metadata returned an invalid project user");
    }
    const id = requireOpaqueId((entry as Record<string, unknown>).id, "project user ID");
    if (seen.has(id)) {
      throw new TypeError("Proxy metadata returned duplicate project users");
    }
    seen.add(id);
    return Object.freeze({ id });
  });
}

function parseEnvironments(
  value: unknown,
  requireProtectionFlag: boolean,
): ProjectLookupEnvironment[] {
  if (!Array.isArray(value) || value.length > MAX_ENVIRONMENTS) {
    throw new TypeError("Proxy metadata returned invalid project environments");
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const seenDomains = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Proxy metadata returned an invalid project environment");
    }
    const record = entry as Record<string, unknown>;
    const id = requireOpaqueId(record.id, "environment ID");
    const name = requireBoundedString(
      record.name,
      "environment name",
      MAX_ENVIRONMENT_NAME_CODE_UNITS,
    );
    const normalizedName = name.toLowerCase();
    if (seenIds.has(id) || seenNames.has(normalizedName)) {
      throw new TypeError("Proxy metadata returned duplicate project environments");
    }
    seenIds.add(id);
    seenNames.add(normalizedName);

    let domains: string[] | undefined;
    if (record.domains !== undefined) {
      if (!Array.isArray(record.domains) || record.domains.length > MAX_DOMAINS_PER_ENVIRONMENT) {
        throw new TypeError("Proxy metadata returned invalid environment domains");
      }
      domains = record.domains.map((domain) => {
        const normalized = normalizeUpstreamDomain(domain);
        if (seenDomains.has(normalized)) {
          throw new TypeError("Proxy metadata returned duplicate environment domains");
        }
        seenDomains.add(normalized);
        return normalized;
      });
      Object.freeze(domains);
    }

    let activeReleaseId: string | null | undefined;
    if (record.active_release_id === null) {
      activeReleaseId = null;
    } else if (record.active_release_id !== undefined) {
      activeReleaseId = requireOpaqueId(record.active_release_id, "active release ID");
    }

    let protectedEnvironment: boolean | undefined;
    if (record.protected !== undefined) {
      if (typeof record.protected !== "boolean") {
        throw new TypeError("Proxy metadata returned an invalid environment protection flag");
      }
      protectedEnvironment = record.protected;
    } else if (requireProtectionFlag) {
      throw new TypeError("Proxy access metadata omitted an environment protection flag");
    }

    return Object.freeze({
      id,
      name,
      ...(domains ? { domains } : {}),
      ...(activeReleaseId !== undefined ? { active_release_id: activeReleaseId } : {}),
      ...(protectedEnvironment !== undefined ? { protected: protectedEnvironment } : {}),
    });
  });
}

function parseProjectMetadata(
  value: unknown,
  lookupType: ProxyLookupType,
): DomainLookupResult | ProjectRoutingLookupResult | ProjectAccessLookupResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Proxy metadata returned an invalid response envelope");
  }
  const record = value as Record<string, unknown>;
  const result = {
    id: requireOpaqueId(record.id, "project ID"),
    slug: requireProjectSlug(record.slug),
    environments: Object.freeze(
      parseEnvironments(record.environments, lookupType === "access"),
    ) as ProjectLookupEnvironment[],
  };
  if (lookupType === "routing") return Object.freeze(result);
  const users = parseUsers(record.users);
  return Object.freeze({
    ...result,
    ...(users ? { users: Object.freeze(users) as Array<{ id: string }> } : {}),
  });
}

function requireToken(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TOKEN_CODE_UNITS
  ) {
    throw new TypeError("Proxy metadata authorization token is invalid");
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) {
      throw new TypeError("Proxy metadata authorization token is invalid");
    }
  }
  return value;
}

function abortReason(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Proxy metadata lookup was aborted", "AbortError");
}

function validateSignal(value: AbortSignal | undefined): AbortSignal | undefined {
  if (value !== undefined && !(value instanceof AbortSignal)) {
    throw new TypeError("Proxy metadata lookup signal must be an AbortSignal");
  }
  return value;
}

async function awaitAbortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function createProjectMetadataClient(
  options: ProjectMetadataClientOptions,
): ProjectMetadataClient {
  const baseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const maxInflight = resolveMaxInflight(options.maxInflight);
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger;
  let activeLookups = 0;

  async function lookup<T extends ProjectRoutingLookupResult | ProjectAccessLookupResult>(
    lookupType: ProxyLookupType,
    path: string,
    token: string,
    parse: (value: unknown) => T,
    externalSignal: AbortSignal | undefined,
  ): Promise<T | null> {
    const url = new URL(path, baseUrl);
    const authorizationToken = requireToken(token);
    const headers = new Headers({
      Authorization: `Bearer ${authorizationToken}`,
      Accept: "application/json",
    });
    injectContext(headers);
    if (externalSignal?.aborted) throw abortReason(externalSignal);
    if (activeLookups >= maxInflight) {
      throw new ProxyLookupFailure(
        lookupType,
        503,
        "Proxy metadata lookup capacity is exhausted",
      );
    }
    activeLookups++;

    const controller = new AbortController();
    const timeoutError = new ProxyLookupFailure(
      lookupType,
      504,
      `Proxy ${lookupType} metadata request timed out`,
    );
    const timeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs);
    const abortFromCaller = (): void => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

    const producer = (async (): Promise<T | null> => {
      try {
        logger?.debug("Looking up proxy project metadata", {
          lookupType,
          url: url.toString(),
        });
        const response = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          () => fetchImpl(url, { headers, signal: controller.signal }),
          {
            "http.method": "GET",
            "http.url": sanitizeUrlForSpan(url.toString()),
            "http.host": url.host,
            "proxy.lookup_type": lookupType,
          },
        );

        if (controller.signal.aborted) {
          await settleProxyResponseBody(response);
          throw abortReason(controller.signal);
        }

        if (response.status === 404) {
          await settleProxyResponseBody(response);
          return null;
        }
        if (response.status === 401 || response.status === 403) {
          await settleProxyResponseBody(response);
          throw new ProxyLookupAuthError(lookupType, response.status);
        }
        if (!response.ok) {
          await settleProxyResponseBody(response);
          const publicStatus = response.status === 429 ? 503 : 502;
          throw new ProxyLookupFailure(
            lookupType,
            publicStatus,
            `Proxy ${lookupType} metadata request was rejected`,
            { upstreamStatus: response.status },
          );
        }

        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim()
          .toLowerCase();
        if (contentType !== "application/json") {
          await settleProxyResponseBody(response);
          throw new ProxyLookupFailure(
            lookupType,
            502,
            `Proxy ${lookupType} metadata returned an invalid content type`,
            { upstreamStatus: response.status },
          );
        }

        try {
          return parse(
            await readProxyResponseJson(
              response,
              MAX_METADATA_RESPONSE_BYTES,
              controller.signal,
            ),
          );
        } catch (error) {
          if (controller.signal.aborted) throw abortReason(controller.signal);
          if (error instanceof ProxyLookupFailure) throw error;
          throw new ProxyLookupFailure(
            lookupType,
            502,
            `Proxy ${lookupType} metadata returned an invalid response`,
            {
              cause: error,
              upstreamStatus: response.status,
            },
          );
        }
      } catch (error) {
        if (error instanceof ProxyLookupAuthError || error instanceof ProxyLookupFailure) {
          throw error;
        }
        if (externalSignal?.aborted) throw abortReason(externalSignal);
        if (controller.signal.aborted) throw abortReason(controller.signal);
        throw new ProxyLookupFailure(
          lookupType,
          502,
          `Proxy ${lookupType} metadata request failed`,
          { cause: error },
        );
      }
    })().finally(() => {
      activeLookups--;
    });

    try {
      return await awaitAbortable(producer, controller.signal);
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  return Object.freeze({
    async lookupDomain(
      lookupKey: string,
      token: string,
      lookupOptions: ProjectMetadataLookupOptions = {},
    ): Promise<DomainLookupResult | null> {
      const normalized = normalizeProjectLookupKey(lookupKey);
      const signal = validateSignal(lookupOptions.signal);
      return await withSpan(
        ProxySpanNames.PROXY_DOMAIN_LOOKUP,
        () =>
          lookup(
            "domain",
            `projects/${encodeURIComponent(normalized)}`,
            token,
            (value) => parseProjectMetadata(value, "domain") as DomainLookupResult,
            signal,
          ),
        { "proxy.lookup_key": normalized },
      );
    },
    async lookupRouting(
      lookupKey: string,
      token: string,
      lookupOptions: ProjectMetadataLookupOptions = {},
    ): Promise<ProjectRoutingLookupResult | null> {
      const normalized = normalizeProjectLookupKey(lookupKey);
      const signal = validateSignal(lookupOptions.signal);
      return await withSpan(
        ProxySpanNames.PROXY_DOMAIN_LOOKUP,
        () =>
          lookup(
            "routing",
            `projects/-/proxy-routing/${encodeURIComponent(normalized)}`,
            token,
            (value) => parseProjectMetadata(value, "routing") as ProjectRoutingLookupResult,
            signal,
          ),
        { "proxy.lookup_key": normalized },
      );
    },
    async lookupAccess(
      lookupKey: string,
      token: string,
      includeUsers: boolean,
      lookupOptions: ProjectMetadataLookupOptions = {},
    ): Promise<ProjectAccessLookupResult | null> {
      if (typeof includeUsers !== "boolean") {
        throw new TypeError("Proxy access metadata includeUsers must be a boolean");
      }
      const normalized = normalizeProjectLookupKey(lookupKey);
      const signal = validateSignal(lookupOptions.signal);
      const path = new URL(
        `projects/-/proxy-access/${encodeURIComponent(normalized)}`,
        baseUrl,
      );
      path.searchParams.set("include_users", includeUsers ? "true" : "false");
      return await withSpan(
        ProxySpanNames.PROXY_DOMAIN_LOOKUP,
        () =>
          lookup(
            "access",
            path.toString(),
            token,
            (value) => parseProjectMetadata(value, "access") as ProjectAccessLookupResult,
            signal,
          ),
        { "proxy.lookup_key": normalized },
      );
    },
  });
}

export const PROJECT_METADATA_RESPONSE_LIMIT_BYTES = MAX_METADATA_RESPONSE_BYTES;
