import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";
import { getErrorMessage } from "#veryfront/errors";
import {
  assertCacheOptionsObject,
  requireTokenCacheKey,
  snapshotTokenCacheEntry,
  snapshotTokenCacheOperations,
  snapshotTokenCacheStats,
  type TokenCacheOperations,
} from "./validation.ts";

const DEFAULT_CIRCUIT_OPEN_DURATION_MS = 30_000;
const DEFAULT_FAILURE_THRESHOLD = 3;
const MAX_CIRCUIT_OPEN_DURATION_MS = 60 * 60 * 1_000;
const MAX_FAILURE_THRESHOLD = 100;
const MAX_PENDING_MUTATIONS = 10_000;
const MAX_QUEUED_MUTATIONS = 10_000;
const RECOVERY_PROBE_KEY = "__veryfront_cache_recovery_probe__";
const monotonicNow = () => performance.now();

const logger = proxyLogger.child({ module: "cache" });

export type ResilientCacheCircuitState = "closed" | "open" | "half-open";
type PendingMutation =
  | { kind: "set"; entry: TokenCacheEntry }
  | { kind: "delete" };

export interface ResilientCacheOptions {
  failureThreshold?: number;
  openDurationMs?: number;
  now?: () => number;
}

export interface ResilientCacheStatus {
  readonly state: ResilientCacheCircuitState;
  readonly usingFallback: boolean;
  readonly failureCount: number;
  /** Monotonic timestamp from the configured circuit clock. */
  readonly circuitOpenedAt: number | null;
  readonly pendingMutations: number;
  readonly pendingClear: boolean;
  readonly queuedMutations: number;
}

function readOwnOption(
  options: ResilientCacheOptions,
  key: keyof ResilientCacheOptions,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Resilient cache option ${key} must be a data property`);
  }
  return descriptor.value;
}

function resolveIntegerOption(
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
    throw new RangeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export class ResilientCache implements TokenCache {
  private readonly primary: TokenCacheOperations;
  private readonly fallback: TokenCacheOperations;
  private readonly failureThreshold: number;
  private readonly openDurationMs: number;
  private readonly now: () => number;
  private state: ResilientCacheCircuitState = "closed";
  private failureCount = 0;
  private circuitOpenedAt: number | null = null;
  private recoveryPromise: Promise<boolean> | null = null;
  private recoveryOwner: object | null = null;
  private pendingMutations = new Map<string, PendingMutation>();
  private pendingClear = false;
  private mutationTail: Promise<void> = Promise.resolve();
  private queuedMutations = 0;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    primary: TokenCache,
    fallback: TokenCache,
    options: ResilientCacheOptions = {},
  ) {
    if (primary === fallback) {
      throw new TypeError("Resilient cache primary and fallback must be distinct");
    }
    assertCacheOptionsObject(
      options,
      "Resilient cache options",
      ["failureThreshold", "openDurationMs", "now"],
    );
    this.primary = snapshotTokenCacheOperations(
      primary,
      "Resilient cache primary",
    );
    this.fallback = snapshotTokenCacheOperations(
      fallback,
      "Resilient cache fallback",
    );
    this.failureThreshold = resolveIntegerOption(
      readOwnOption(options, "failureThreshold"),
      DEFAULT_FAILURE_THRESHOLD,
      "Resilient cache failureThreshold",
      1,
      MAX_FAILURE_THRESHOLD,
    );
    this.openDurationMs = resolveIntegerOption(
      readOwnOption(options, "openDurationMs"),
      DEFAULT_CIRCUIT_OPEN_DURATION_MS,
      "Resilient cache openDurationMs",
      0,
      MAX_CIRCUIT_OPEN_DURATION_MS,
    );
    const now = readOwnOption(options, "now");
    if (now !== undefined && typeof now !== "function") {
      throw new TypeError("Resilient cache now must be a function");
    }
    this.now = (now as (() => number) | undefined) ?? monotonicNow;
    this.readClock();
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    return await withSpan(
      "cache.resilient.get",
      async () => {
        this.assertOpen();
        const cacheKey = requireTokenCacheKey(key);
        if (await this.canUsePrimary()) {
          try {
            const result = await this.primary.get(cacheKey);
            this.recordReadSuccess();
            return result === null ? null : snapshotTokenCacheEntry(result);
          } catch (error) {
            this.recordReadFailure(error);
          }
        }
        const fallbackResult = await this.fallback.get(cacheKey);
        return fallbackResult === null ? null : snapshotTokenCacheEntry(fallbackResult);
      },
      { "cache.circuit_state": this.state },
    );
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    return await withSpan(
      "cache.resilient.set",
      async () => {
        this.assertOpen();
        const cacheKey = requireTokenCacheKey(key);
        const cachedEntry = snapshotTokenCacheEntry(entry);
        await this.enqueueMutation(async () => {
          if (Date.now() >= cachedEntry.expiresAt) {
            await this.deleteFromBackends(cacheKey);
            return;
          }
          await this.fallback.set(cacheKey, cachedEntry);

          if (!(await this.canUsePrimary())) {
            this.rememberSet(cacheKey, cachedEntry);
            return;
          }
          try {
            await this.primary.set(cacheKey, cachedEntry);
            this.recordMutationSuccess(cacheKey);
          } catch (error) {
            this.rememberSet(cacheKey, cachedEntry);
            this.recordMutationFailure(error);
          }
        });
      },
      { "cache.circuit_state": this.state },
    );
  }

  async delete(key: string): Promise<void> {
    return await withSpan(
      "cache.resilient.delete",
      async () => {
        this.assertOpen();
        const cacheKey = requireTokenCacheKey(key);
        await this.enqueueMutation(() => this.deleteFromBackends(cacheKey));
      },
      { "cache.circuit_state": this.state },
    );
  }

  async clear(): Promise<void> {
    return await withSpan(
      "cache.resilient.clear",
      async () => {
        this.assertOpen();
        await this.enqueueMutation(async () => {
          await this.fallback.clear();

          if (!(await this.canUsePrimary())) {
            this.rememberClear();
            return;
          }
          try {
            await this.primary.clear();
            this.pendingClear = false;
            this.pendingMutations.clear();
            this.recordReadSuccess();
          } catch (error) {
            this.rememberClear();
            this.recordMutationFailure(error);
          }
        });
      },
      { "cache.circuit_state": this.state },
    );
  }

  async has(key: string): Promise<boolean> {
    return await withSpan(
      "cache.resilient.has",
      async () => {
        this.assertOpen();
        const cacheKey = requireTokenCacheKey(key);
        if (await this.canUsePrimary()) {
          try {
            const result = await this.primary.has(cacheKey);
            if (typeof result !== "boolean") {
              throw new TypeError("Primary token cache returned an invalid has result");
            }
            this.recordReadSuccess();
            return result;
          } catch (error) {
            this.recordReadFailure(error);
          }
        }
        const fallbackResult = await this.fallback.has(cacheKey);
        if (typeof fallbackResult !== "boolean") {
          throw new TypeError("Fallback token cache returned an invalid has result");
        }
        return fallbackResult;
      },
      { "cache.circuit_state": this.state },
    );
  }

  async stats(): Promise<CacheStats> {
    return await withSpan(
      "cache.resilient.stats",
      async () => {
        this.assertOpen();
        if (await this.canUsePrimary()) {
          try {
            return snapshotTokenCacheStats(await this.primary.stats());
          } catch (error) {
            this.recordReadFailure(error);
          }
        }
        return snapshotTokenCacheStats(await this.fallback.stats());
      },
      { "cache.circuit_state": this.state },
    );
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const close = (async () => {
      const failures: unknown[] = [];
      await this.mutationTail;
      if (this.recoveryPromise) {
        try {
          await this.recoveryPromise;
        } catch (error) {
          failures.push(error);
        }
      }
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.primary.close()),
        Promise.resolve().then(() => this.fallback.close()),
      ]);
      for (const result of results) {
        if (result.status === "rejected") failures.push(result.reason);
      }
      this.pendingMutations.clear();
      this.pendingClear = false;
      if (failures.length > 0) {
        throw new AggregateError(failures, "Failed to close resilient cache backends");
      }
    })();
    this.closePromise = withSpan("cache.resilient.close", () => close);
    return this.closePromise;
  }

  getStatus(): ResilientCacheStatus {
    return Object.freeze({
      state: this.state,
      usingFallback: this.state !== "closed",
      failureCount: this.failureCount,
      circuitOpenedAt: this.circuitOpenedAt,
      pendingMutations: this.pendingMutations.size,
      pendingClear: this.pendingClear,
      queuedMutations: this.queuedMutations,
    });
  }

  private async canUsePrimary(): Promise<boolean> {
    if (this.state === "closed") return true;
    if (this.recoveryPromise) return await this.recoveryPromise;
    const currentTime = this.readClock();
    // The injected clock is application code and can synchronously re-enter
    // this cache. Join any recovery it started before claiming ownership.
    if (this.recoveryPromise) return await this.recoveryPromise;
    if (
      this.state === "open" &&
      currentTime - (this.circuitOpenedAt ?? currentTime) < this.openDurationMs
    ) {
      return false;
    }
    const recovery = Promise.withResolvers<boolean>();
    const owner = Object.freeze({});
    this.recoveryOwner = owner;
    this.recoveryPromise = recovery.promise;

    // Install the shared promise before invoking the extension-owned cache.
    // A synchronous callback into this cache must join this recovery instead
    // of starting a competing probe before performRecovery reaches its await.
    void this.performRecovery().then(recovery.resolve, recovery.reject);
    try {
      return await recovery.promise;
    } finally {
      if (this.recoveryOwner === owner) {
        this.recoveryOwner = null;
        this.recoveryPromise = null;
      }
    }
  }

  private async performRecovery(): Promise<boolean> {
    this.state = "half-open";
    logger.debug("[ResilientCache] Circuit half-open; probing primary");
    try {
      const probeResult = await this.primary.has(RECOVERY_PROBE_KEY);
      if (typeof probeResult !== "boolean") {
        throw new TypeError("Primary token cache returned an invalid recovery probe result");
      }
      await this.replayPendingMutations();
      this.state = "closed";
      this.failureCount = 0;
      this.circuitOpenedAt = null;
      logger.debug("[ResilientCache] Primary recovered; circuit closed");
      return true;
    } catch (error) {
      this.state = "open";
      this.failureCount = Math.max(this.failureCount, this.failureThreshold);
      this.circuitOpenedAt = this.readClock();
      logger.warn("[ResilientCache] Primary recovery probe failed", {
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  private async replayPendingMutations(): Promise<void> {
    if (this.pendingClear) {
      await this.primary.clear();
    }
    for (const [key, mutation] of this.pendingMutations) {
      if (mutation.kind === "set") {
        if (Date.now() >= mutation.entry.expiresAt) {
          await this.primary.delete(key);
        } else {
          await this.primary.set(key, mutation.entry);
        }
      } else {
        await this.primary.delete(key);
      }
    }
    this.pendingClear = false;
    this.pendingMutations.clear();
  }

  private recordReadSuccess(): void {
    if (this.state !== "closed") return;
    this.failureCount = 0;
  }

  private recordReadFailure(error: unknown): void {
    this.failureCount++;
    logger.warn(
      `[ResilientCache] Primary cache error (${this.failureCount}/${this.failureThreshold})`,
      { error: getErrorMessage(error) },
    );
    if (this.failureCount >= this.failureThreshold) this.openCircuit();
  }

  private recordMutationSuccess(key: string): void {
    this.pendingMutations.delete(key);
    this.recordReadSuccess();
  }

  private recordMutationFailure(error: unknown): void {
    logger.warn("[ResilientCache] Primary cache mutation failed; opening circuit", {
      error: getErrorMessage(error),
    });
    this.failureCount = Math.max(this.failureCount + 1, this.failureThreshold);
    this.openCircuit();
  }

  private openCircuit(): void {
    const wasOpen = this.state === "open";
    this.state = "open";
    this.circuitOpenedAt = this.readClock();
    if (!wasOpen) {
      logger.warn("[ResilientCache] Circuit opened; using fallback cache");
    }
  }

  private rememberSet(key: string, entry: TokenCacheEntry): void {
    this.rememberMutation(key, {
      kind: "set",
      entry: snapshotTokenCacheEntry(entry),
    });
  }

  private rememberDelete(key: string): void {
    this.rememberMutation(key, { kind: "delete" });
  }

  private rememberMutation(key: string, mutation: PendingMutation): void {
    if (
      !this.pendingMutations.has(key) &&
      this.pendingMutations.size >= MAX_PENDING_MUTATIONS
    ) {
      this.pendingClear = true;
      this.pendingMutations.clear();
    }
    this.pendingMutations.delete(key);
    this.pendingMutations.set(key, mutation);
  }

  private rememberClear(): void {
    this.pendingClear = true;
    this.pendingMutations.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Resilient cache is closed");
  }

  private readClock(): number {
    const value = this.now();
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new TypeError("Resilient cache clock returned an invalid time");
    }
    return value;
  }

  private async deleteFromBackends(key: string): Promise<void> {
    await this.fallback.delete(key);
    if (!(await this.canUsePrimary())) {
      this.rememberDelete(key);
      return;
    }
    try {
      await this.primary.delete(key);
      this.recordMutationSuccess(key);
    } catch (error) {
      this.rememberDelete(key);
      this.recordMutationFailure(error);
    }
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    if (this.queuedMutations >= MAX_QUEUED_MUTATIONS) {
      throw new Error("Resilient cache mutation queue is full");
    }
    this.queuedMutations++;
    const scheduled = this.mutationTail.then(operation);
    const result = scheduled.finally(() => {
      this.queuedMutations--;
    });
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
