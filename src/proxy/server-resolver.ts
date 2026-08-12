/**
 * Dedicated Server Resolver
 *
 * Resolves an environment ID to a dedicated server origin. Control-plane
 * failures deliberately fall back to the shared renderer pool, but malformed
 * identifiers and construction policy fail at the local boundary.
 */

import { getErrorMessage } from "#veryfront/errors";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import { encodeBase64 } from "#veryfront/utils";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
} from "#veryfront/utils/project-identity.ts";
import { readProxyResponseJson, settleProxyResponseBody } from "./response-body.ts";
import { proxyLogger } from "./logger.ts";

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_MAX_CACHE_ENTRIES = 10_000;
const DEFAULT_MAX_INFLIGHT = 200;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const MAX_API_URL_CODE_UNITS = 4_096;
const MAX_CACHE_TTL_MS = 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 100_000;
const MAX_INFLIGHT = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const MAX_CREDENTIAL_CODE_UNITS = 4_096;
const MAX_SERVER_STATUS_CODE_UNITS = 64;

const logger = proxyLogger.child({ module: "server-resolver" });

interface CacheEntry {
  readonly targetUrl: string | null;
  readonly expiresAt: number;
}

interface PendingLookup {
  readonly controller: AbortController;
  readonly promise: Promise<string | null>;
}

export interface ServerResolverOptions {
  maxEntries?: number;
  maxInflight?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

class ServerResolverError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServerResolverError";
  }
}

function monotonicMilliseconds(): number {
  return Math.floor(performance.now());
}

function assertPlainOptions(options: ServerResolverOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Server resolver options must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(options);
    keys = Reflect.ownKeys(options);
  } catch (error) {
    throw new TypeError("Server resolver options are unreadable", {
      cause: error,
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Server resolver options must be a plain object");
  }
  const allowed = new Set([
    "maxEntries",
    "maxInflight",
    "requestTimeoutMs",
    "fetchImpl",
    "now",
  ]);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new TypeError("Server resolver options contain an unknown option");
  }
}

function readOwnOption(
  options: ServerResolverOptions,
  key: keyof ServerResolverOptions,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Server resolver option ${key} must be a data property`);
  }
  return descriptor.value;
}

function resolveInteger(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function requireCredential(
  value: unknown,
  label: string,
  policy: Readonly<{
    allowColon: boolean;
    allowOuterWhitespace: boolean;
  }>,
): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_CREDENTIAL_CODE_UNITS ||
    hasProjectIdentityControlCharacters(value) ||
    (!policy.allowOuterWhitespace && value !== value.trim()) ||
    (!policy.allowColon && value.includes(":"))
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeApiBaseUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_API_URL_CODE_UNITS ||
    value !== value.trim() ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError("Dedicated server API URL is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Dedicated server API URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new TypeError("Dedicated server API URL must be an HTTP(S) origin or path");
  }
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed.toString();
}

function ownDataValue(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown {
  const descriptor = descriptors[key];
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function parseTargetUrl(value: unknown): string | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Dedicated server API returned an invalid server");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const id = ownDataValue(descriptors, "id");
  const shortId = ownDataValue(descriptors, "short_id");
  const hostname = ownDataValue(descriptors, "hostname");
  const status = ownDataValue(descriptors, "status");
  if (
    !isCanonicalOpaqueProjectIdentifier(id) ||
    !isCanonicalOpaqueProjectIdentifier(shortId) ||
    typeof hostname !== "string" ||
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname !== hostname.trim() ||
    hasProjectIdentityControlCharacters(hostname) ||
    !isCanonicalOpaqueProjectIdentifier(status) ||
    status.length > MAX_SERVER_STATUS_CODE_UNITS
  ) {
    throw new TypeError("Dedicated server API returned an invalid server");
  }
  let target: URL;
  try {
    target = new URL(`http://${hostname}`);
  } catch {
    throw new TypeError("Dedicated server API returned an invalid hostname");
  }
  if (
    target.protocol !== "http:" ||
    !target.hostname ||
    target.hostname !== hostname.toLowerCase() ||
    target.username ||
    target.password ||
    target.port ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new TypeError("Dedicated server API returned an invalid hostname");
  }
  return status.toLowerCase() === "running" ? target.origin : null;
}

function parseResponse(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Dedicated server API returned an invalid response");
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError("Dedicated server API returned an unreadable response");
  }
  return parseTargetUrl(ownDataValue(descriptors, "server"));
}

function abortReason(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Dedicated server lookup was aborted", "AbortError");
}

async function awaitAbortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  let rejectForAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const onAbort = () => rejectForAbort(abortReason(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export class ServerResolver {
  private readonly apiEndpointBase: string;
  private readonly authorizationHeader: string | null;
  private readonly cacheTtlMs: number;
  private readonly maxEntries: number;
  private readonly maxInflight: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, PendingLookup>();
  private readonly pendingControllers = new Set<AbortController>();
  private readonly activeRequests = new Map<Promise<Response>, AbortController>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private closed = false;
  private capacityWarningEmitted = false;

  constructor(
    apiInternalUrl: string,
    apiUser: string,
    apiPass: string,
    cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    options: ServerResolverOptions = {},
  ) {
    assertPlainOptions(options);
    this.apiEndpointBase = normalizeApiBaseUrl(apiInternalUrl);
    const user = requireCredential(apiUser, "Dedicated server API user", {
      allowColon: false,
      allowOuterWhitespace: false,
    });
    const password = requireCredential(
      apiPass,
      "Dedicated server API password",
      {
        allowColon: true,
        allowOuterWhitespace: true,
      },
    );
    if ((user.length === 0) !== (password.length === 0)) {
      throw new TypeError(
        "Dedicated server API user and password must be configured together",
      );
    }
    this.authorizationHeader = user ? `Basic ${encodeBase64(`${user}:${password}`)}` : null;
    this.cacheTtlMs = resolveInteger(
      cacheTtlMs,
      DEFAULT_CACHE_TTL_MS,
      "Server resolver cache TTL",
      0,
      MAX_CACHE_TTL_MS,
    );
    this.maxEntries = resolveInteger(
      readOwnOption(options, "maxEntries"),
      DEFAULT_MAX_CACHE_ENTRIES,
      "Server resolver maxEntries",
      0,
      MAX_CACHE_ENTRIES,
    );
    this.maxInflight = resolveInteger(
      readOwnOption(options, "maxInflight"),
      DEFAULT_MAX_INFLIGHT,
      "Server resolver maxInflight",
      1,
      MAX_INFLIGHT,
    );
    this.requestTimeoutMs = resolveInteger(
      readOwnOption(options, "requestTimeoutMs"),
      DEFAULT_REQUEST_TIMEOUT_MS,
      "Server resolver requestTimeoutMs",
      1,
      MAX_REQUEST_TIMEOUT_MS,
    );
    const fetchImpl = readOwnOption(options, "fetchImpl");
    if (fetchImpl !== undefined && typeof fetchImpl !== "function") {
      throw new TypeError("Server resolver fetchImpl must be a function");
    }
    this.fetchImpl = (fetchImpl as typeof fetch | undefined) ?? fetch;
    const now = readOwnOption(options, "now");
    if (now !== undefined && typeof now !== "function") {
      throw new TypeError("Server resolver now must be a function");
    }
    this.now = (now as (() => number) | undefined) ?? monotonicMilliseconds;
    this.readClock();

    if (this.cacheTtlMs > 0 && this.maxEntries > 0) {
      const cleanupInterval = Math.min(
        60_000,
        Math.max(1_000, this.cacheTtlMs),
      );
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
      unrefTimer(this.cleanupTimer);
    }
  }

  async resolve(environmentId: string | undefined): Promise<string | null> {
    this.assertOpen();
    if (environmentId === undefined) return null;
    if (!isCanonicalOpaqueProjectIdentifier(environmentId)) {
      throw new TypeError("Dedicated server environment ID is invalid");
    }

    const cached = this.cache.get(environmentId);
    if (cached) {
      if (this.readClock() < cached.expiresAt) {
        this.cache.delete(environmentId);
        this.cache.set(environmentId, cached);
        return cached.targetUrl;
      }
      this.cache.delete(environmentId);
    }

    const existing = this.pending.get(environmentId);
    if (existing) return await existing.promise;
    if (this.isAtCapacity()) {
      if (!this.capacityWarningEmitted) {
        this.capacityWarningEmitted = true;
        logger.warn("[ServerResolver] Lookup capacity exhausted; using shared pool", {
          maxInflight: this.maxInflight,
        });
      }
      return null;
    }

    const controller = new AbortController();
    const generation = this.generation;
    this.pendingControllers.add(controller);
    const promise = this.performLookup(
      environmentId,
      controller,
      generation,
    ).finally(() => {
      if (this.pending.get(environmentId)?.controller === controller) {
        this.pending.delete(environmentId);
      }
      this.pendingControllers.delete(controller);
      this.resetCapacityWarningIfAvailable();
    });
    const entry: PendingLookup = Object.freeze({ controller, promise });
    this.pending.set(environmentId, entry);
    return await promise;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    for (const lookup of this.pending.values()) {
      lookup.controller.abort(
        new DOMException("Server resolver closed", "AbortError"),
      );
    }
    this.pending.clear();
    this.pendingControllers.clear();
  }

  private async performLookup(
    environmentId: string,
    controller: AbortController,
    generation: number,
  ): Promise<string | null> {
    try {
      const targetUrl = await this.fetchServer(environmentId, controller);
      if (this.closed || generation !== this.generation) return null;
      this.remember(environmentId, targetUrl);
      return targetUrl;
    } catch (error) {
      if (this.closed || generation !== this.generation) return null;
      logger.warn("[ServerResolver] Transient error, using shared pool", {
        environmentId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  private async fetchServer(
    environmentId: string,
    controller: AbortController,
  ): Promise<string | null> {
    const timeout = setTimeout(() => {
      controller.abort(
        new DOMException("Dedicated server lookup timed out", "TimeoutError"),
      );
    }, this.requestTimeoutMs);
    try {
      return await this.fetchServerWithinDeadline(
        environmentId,
        controller,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchServerWithinDeadline(
    environmentId: string,
    controller: AbortController,
  ): Promise<string | null> {
    const endpoint = new URL(
      "internal/environment-server",
      this.apiEndpointBase,
    );
    endpoint.searchParams.set("environmentId", environmentId);
    const headers = new Headers({ Accept: "application/json" });
    if (this.authorizationHeader) {
      headers.set("Authorization", this.authorizationHeader);
    }

    let response: Response;
    try {
      const request = Promise.resolve().then(() =>
        controller.signal.aborted
          ? Promise.reject(abortReason(controller.signal))
          : this.fetchImpl(endpoint, {
            headers,
            signal: controller.signal,
          })
      );
      this.activeRequests.set(request, controller);
      void request.then(
        async (lateResponse) => {
          if (controller.signal.aborted) {
            await settleProxyResponseBody(lateResponse);
          }
        },
        () => {},
      ).finally(() => {
        this.activeRequests.delete(request);
        this.resetCapacityWarningIfAvailable();
      });
      response = await awaitAbortable(request, controller.signal);
    } catch (error) {
      throw new ServerResolverError(
        "Dedicated server API request failed",
        { cause: error },
      );
    }

    if (!response.ok) {
      await settleProxyResponseBody(response);
      throw new ServerResolverError(
        `Dedicated server API returned HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      await settleProxyResponseBody(response);
      throw new ServerResolverError(
        "Dedicated server API returned an invalid content type",
      );
    }

    try {
      return parseResponse(
        await readProxyResponseJson(
          response,
          MAX_RESPONSE_BYTES,
          controller.signal,
        ),
      );
    } catch (error) {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      throw new ServerResolverError(
        "Dedicated server API returned an invalid response",
        { cause: error },
      );
    }
  }

  private remember(environmentId: string, targetUrl: string | null): void {
    if (this.cacheTtlMs === 0 || this.maxEntries === 0) return;
    const expiresAt = this.readClock() + this.cacheTtlMs;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new RangeError("Server resolver cache expiry is outside the safe range");
    }
    if (
      !this.cache.has(environmentId) &&
      this.cache.size >= this.maxEntries
    ) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.delete(environmentId);
    this.cache.set(
      environmentId,
      Object.freeze({
        targetUrl,
        expiresAt,
      }),
    );
  }

  private cleanup(): void {
    if (this.closed) return;
    const now = this.readClock();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) this.cache.delete(key);
    }
  }

  private readClock(): number {
    const value = this.now();
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new TypeError("Server resolver clock returned an invalid time");
    }
    return value;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Server resolver is closed");
  }

  private isAtCapacity(): boolean {
    let workCount = this.pendingControllers.size;
    for (const controller of this.activeRequests.values()) {
      if (!this.pendingControllers.has(controller)) workCount++;
      if (workCount >= this.maxInflight) return true;
    }
    return workCount >= this.maxInflight;
  }

  private resetCapacityWarningIfAvailable(): void {
    if (!this.isAtCapacity()) this.capacityWarningEmitted = false;
  }
}
