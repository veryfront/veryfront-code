/**
 * In-memory cache for project environment variables with TTL and request deduplication.
 *
 * Cache authority is the complete project/environment/credential scope. Neither a
 * tenant-supplied environment ID nor a reusable platform credential may alias a
 * different project's cached secrets.
 *
 * @module server/project-env/cache
 */

import { createProjectEnvSnapshot } from "./snapshot.ts";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import {
  CACHE_ERROR,
  SERVICE_OVERLOADED,
  TIMEOUT_ERROR,
  type VeryfrontError,
} from "#veryfront/errors";

export interface ProjectEnvironmentScope {
  /** Canonical project slug authorized by the credential. */
  projectSlug: string;
  /** Canonical project ID when the control plane supplied one. */
  projectId?: string;
  environmentId: string;
  token: string;
}

interface CacheEntry {
  vars: Record<string, string>;
  fetchedAt: number;
  environmentId: string;
}

type Fetcher = (
  scope: ProjectEnvironmentScope,
  signal: AbortSignal,
) => Promise<Record<string, string>>;

export interface EnvironmentVariableCacheOptions {
  /** Maximum time allowed for one cache-owned upstream fetch. */
  fetchTimeoutMs?: number;
  /** Maximum number of distinct upstream fetches across all projects. */
  maxInflight?: number;
  /** Maximum number of distinct upstream fetches for one canonical project. */
  maxInflightPerProject?: number;
}

/** Max number of scoped environments to cache. Evicts oldest entry when exceeded. */
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_INFLIGHT = 100;
const DEFAULT_MAX_INFLIGHT_PER_PROJECT = 10;
const encodeText = TextEncoder.prototype.encode;
const subtleDigest = crypto.subtle.digest.bind(crypto.subtle);
const textEncoder = new TextEncoder();

function frame(value: string): string {
  return `${value.length}:${value}`;
}

async function digestCredential(token: string): Promise<string> {
  const bytes = encodeText.call(textEncoder, token);
  const digest = await subtleDigest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildCacheKey(scope: ProjectEnvironmentScope): Promise<string> {
  const credentialPrincipal = await digestCredential(scope.token);
  return [
    "project-env-v2",
    frame(scope.projectSlug),
    frame(scope.projectId ?? ""),
    frame(scope.environmentId),
    credentialPrincipal,
  ].join("|");
}

function normalizeScope(scope: ProjectEnvironmentScope): ProjectEnvironmentScope {
  const projectSlug = scope?.projectSlug;
  const projectId = scope?.projectId;
  const environmentId = scope?.environmentId;
  const token = scope?.token;

  if (typeof projectSlug !== "string" || !projectSlug.trim()) {
    throw new TypeError("Project environment scope requires a slug");
  }
  if (projectId !== undefined && (typeof projectId !== "string" || !projectId.trim())) {
    throw new TypeError("Project environment scope project ID must be a non-empty string");
  }
  if (typeof environmentId !== "string" || !environmentId.trim()) {
    throw new TypeError("Project environment scope requires an environment ID");
  }
  if (typeof token !== "string" || !token) {
    throw new TypeError("Project environment scope requires a credential");
  }

  return Object.freeze({ projectSlug, projectId, environmentId, token });
}

interface Epoch {
  global: number;
  environment: number;
}

interface InflightEntry {
  controller: AbortController;
  environmentId: string;
  epoch: Epoch;
  key: string;
  projectSlug: string;
  promise: Promise<Record<string, string>>;
  removed: boolean;
  scope: ProjectEnvironmentScope;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  // Every internal abort passes a typed Error, but the typed error contract
  // must hold even for an unexpected non-Error reason.
  if (isErrorAcrossRealms(reason)) return reason;
  return CACHE_ERROR.create({
    detail: "Project environment fetch was cancelled",
    ...(reason === undefined || reason === null ? {} : { cause: reason }),
  });
}

function invalidatedError(): VeryfrontError {
  return CACHE_ERROR.create({
    detail: "Project environment fetch was invalidated",
  });
}

export class EnvironmentVariableCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, InflightEntry>();
  private inflightByProject = new Map<string, number>();
  private fetcher: Fetcher;
  private ttlMs: number;
  private maxEntries: number;
  private fetchTimeoutMs: number;
  private maxInflight: number;
  private maxInflightPerProject: number;
  private globalEpoch = 0;
  private environmentEpochs = new Map<string, number>();

  constructor(
    fetcher: Fetcher,
    ttlMs = 60_000,
    maxEntries = DEFAULT_MAX_ENTRIES,
    options: EnvironmentVariableCacheOptions = {},
  ) {
    this.fetcher = fetcher;
    this.ttlMs = nonNegativeInteger(ttlMs, "ttlMs");
    this.maxEntries = nonNegativeInteger(maxEntries, "maxEntries");
    this.fetchTimeoutMs = positiveInteger(
      options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
      "fetchTimeoutMs",
    );
    this.maxInflight = positiveInteger(
      options.maxInflight ?? DEFAULT_MAX_INFLIGHT,
      "maxInflight",
    );
    this.maxInflightPerProject = positiveInteger(
      options.maxInflightPerProject ?? DEFAULT_MAX_INFLIGHT_PER_PROJECT,
      "maxInflightPerProject",
    );
  }

  async get(scope: ProjectEnvironmentScope): Promise<Record<string, string>> {
    const normalizedScope = normalizeScope(scope);
    const epoch = this.captureEpoch(normalizedScope.environmentId);
    const key = await buildCacheKey(normalizedScope);

    // Invalidations that occur while the credential digest is being computed
    // also invalidate this request. It must not join work from the newer epoch.
    if (!this.isCurrentEpoch(normalizedScope.environmentId, epoch)) {
      throw invalidatedError();
    }

    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < this.ttlMs) {
      return cached.vars;
    }

    // Deduplicate only requests with exactly the same canonical identity and
    // credential principal. A shared environment ID is never sufficient.
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;

    this.assertAdmission(normalizedScope.projectSlug);

    const controller = new AbortController();
    const start = Promise.withResolvers<InflightEntry>();
    const promise = start.promise.then((entry) => this.fetch(entry));
    const entry: InflightEntry = {
      controller,
      environmentId: normalizedScope.environmentId,
      epoch,
      key,
      projectSlug: normalizedScope.projectSlug,
      promise,
      removed: false,
      scope: normalizedScope,
    };

    this.addInflight(entry);
    start.resolve(entry);
    return promise;
  }

  invalidate(environmentId?: string): void {
    if (!environmentId) {
      this.globalEpoch++;
      this.environmentEpochs.clear();
      this.cache.clear();
      for (const entry of [...this.inflight.values()]) {
        this.invalidateInflight(entry);
      }
      return;
    }

    this.environmentEpochs.set(
      environmentId,
      (this.environmentEpochs.get(environmentId) ?? 0) + 1,
    );

    for (const [key, entry] of this.cache) {
      if (entry.environmentId === environmentId) this.cache.delete(key);
    }

    for (const entry of [...this.inflight.values()]) {
      if (entry.environmentId === environmentId) this.invalidateInflight(entry);
    }
  }

  private async fetch(entry: InflightEntry): Promise<Record<string, string>> {
    const { controller, scope } = entry;
    const timeoutError = TIMEOUT_ERROR.create({
      detail: "Project environment fetch timed out",
    });
    const timeoutId = setTimeout(() => controller.abort(timeoutError), this.fetchTimeoutMs);

    let removeAbortListener = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(abortReason(controller.signal));
      removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort);
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      // Fetch failures are deliberately not replaced by stale or empty data.
      // Environment variables are an authorization-sensitive input; continuing
      // after credential revocation or an identity mismatch would fail open.
      const fetched = await Promise.race([
        this.fetcher(scope, controller.signal),
        aborted,
      ]);

      if (controller.signal.aborted) throw abortReason(controller.signal);
      if (!this.isCurrentEpoch(scope.environmentId, entry.epoch)) {
        throw invalidatedError();
      }

      const vars = createProjectEnvSnapshot(fetched) as Record<string, string>;

      // Recheck immediately before commit. Invalidation aborts registered work,
      // while the epoch prevents an older result from racing a replacement.
      if (controller.signal.aborted) throw abortReason(controller.signal);
      if (!this.isCurrentEpoch(scope.environmentId, entry.epoch)) {
        throw invalidatedError();
      }

      this.cache.delete(entry.key);
      this.cache.set(entry.key, {
        vars,
        fetchedAt: Date.now(),
        environmentId: scope.environmentId,
      });
      this.evictIfNeeded();
      return vars;
    } finally {
      clearTimeout(timeoutId);
      removeAbortListener();
      this.removeInflight(entry);
    }
  }

  private captureEpoch(environmentId: string): Epoch {
    return {
      global: this.globalEpoch,
      environment: this.environmentEpochs.get(environmentId) ?? 0,
    };
  }

  private isCurrentEpoch(environmentId: string, epoch: Epoch): boolean {
    return epoch.global === this.globalEpoch &&
      epoch.environment === (this.environmentEpochs.get(environmentId) ?? 0);
  }

  private assertAdmission(projectSlug: string): void {
    const projectInflight = this.inflightByProject.get(projectSlug) ?? 0;
    if (
      this.inflight.size >= this.maxInflight ||
      projectInflight >= this.maxInflightPerProject
    ) {
      throw SERVICE_OVERLOADED.create({
        detail: "Project environment fetch concurrency limit reached",
      });
    }
  }

  private addInflight(entry: InflightEntry): void {
    this.inflight.set(entry.key, entry);
    this.inflightByProject.set(
      entry.projectSlug,
      (this.inflightByProject.get(entry.projectSlug) ?? 0) + 1,
    );
  }

  private removeInflight(entry: InflightEntry): void {
    if (entry.removed) return;
    entry.removed = true;
    if (this.inflight.get(entry.key) === entry) this.inflight.delete(entry.key);

    const count = this.inflightByProject.get(entry.projectSlug) ?? 0;
    if (count <= 1) this.inflightByProject.delete(entry.projectSlug);
    else this.inflightByProject.set(entry.projectSlug, count - 1);
  }

  private invalidateInflight(entry: InflightEntry): void {
    this.removeInflight(entry);
    entry.controller.abort(invalidatedError());
  }

  /** Evict oldest entries when cache exceeds maxEntries. */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxEntries) return;
    const excess = this.cache.size - this.maxEntries;
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (removed >= excess) break;
      this.cache.delete(key);
      removed++;
    }
  }
}
