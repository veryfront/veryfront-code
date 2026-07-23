/**************************
 * Memory Profiler
 *
 * Advanced memory profiling utilities for monitoring heap usage,
 * tracking cache sizes, and detecting memory leaks.
 **************************/

import { rendererLogger } from "../logger/logger.ts";
import { getArgs, getEnv, memoryUsage } from "#veryfront/platform/compat/process.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { SERVICE_OVERLOADED } from "#veryfront/errors/error-registry/server.ts";

const logger = rendererLogger.component("memory-profiler");

/** Fallback V8 heap limit when no --max-old-space-size flag is set (5 GB) */
const DEFAULT_HEAP_LIMIT_MB = 5_120;

/** Default interval for periodic memory snapshots (30 seconds) */
export const DEFAULT_MEMORY_MONITORING_INTERVAL_MS = 30_000;
const MIN_MEMORY_MONITORING_INTERVAL_MS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Heap growth (MB) per interval that triggers a rapid-growth warning */
const HEAP_RAPID_GROWTH_THRESHOLD_MB = 100;

const MAX_REGISTERED_CACHES = 1_024;
const CACHE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CACHE_BACKEND_LENGTH = 64;
const MAX_CACHE_STAT_FIELDS = 32;
const MAX_CACHE_STAT_FIELD_NAME_LENGTH = 64;
const RESERVED_CACHE_STAT_FIELDS = new Set(["__proto__", "constructor", "prototype"]);
const cacheRegistry = new Map<string, () => CacheStats>();

export interface CacheStats {
  name: string;
  entries: number;
  maxEntries?: number;
  estimatedSizeBytes?: number;
  /** Cache backend type (memory, redis, api) */
  backend?: string;
  /** Cache-specific diagnostic fields exposed by existing profiler integrations. */
  [field: string]: unknown;
}

export interface HeapStats {
  usedHeapSizeMB: number;
  totalHeapSizeMB: number;
  heapSizeLimitMB: number;
  externalMemoryMB: number;
  heapUsedPercent: number;
  rss?: number;
}

export interface MemorySnapshot {
  timestamp: string;
  heap: HeapStats;
  caches: CacheStats[];
  totalCacheEntries: number;
  gcStats?: GCStats;
}

export interface MonitoringCacheStats {
  name: string;
  entries: number;
  maxEntries?: number;
  estimatedSizeBytes?: number;
  backend?: string;
}

export interface MemoryMonitoringLogContext {
  heapUsedMB: number;
  heapTotalMB: number;
  heapLimitMB: number;
  heapUsedPercent: number;
  rssMB?: number;
  totalCacheEntries: number;
  topCaches: MonitoringCacheStats[];
}

export interface MemoryMonitoringEnv {
  get(key: string): string | null | undefined;
}

export interface MemoryMonitoringConfig {
  enabled: boolean;
  intervalMs: number;
}

export interface MemoryMonitoringState {
  active: boolean;
  intervalMs: number | undefined;
}

export interface MemoryMonitoringLease {
  readonly config: MemoryMonitoringConfig;
  release(): void;
}

export interface GCStats {
  majorGCs: number;
  minorGCs: number;
  lastGCDurationMs?: number;
}

function requireCacheName(name: unknown): string {
  if (typeof name !== "string" || !CACHE_NAME_PATTERN.test(name)) {
    throw invalidMemoryArgument(
      "Memory profiler cache name must use 1 to 128 safe identifier characters",
    );
  }
  return name;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function snapshotCacheStats(registryName: string, value: unknown): CacheStats {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid cache stats");
  }

  let fields: Record<string, unknown>;
  try {
    const keys = Object.keys(value);
    if (keys.length > MAX_CACHE_STAT_FIELDS) throw new TypeError("Invalid cache stats");

    fields = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (
        key.length === 0 || key.length > MAX_CACHE_STAT_FIELD_NAME_LENGTH ||
        RESERVED_CACHE_STAT_FIELDS.has(key) || hasControlCharacter(key)
      ) {
        throw new TypeError("Invalid cache stats");
      }
      fields[key] = Reflect.get(value, key);
    }
  } catch {
    throw new TypeError("Invalid cache stats");
  }

  const { name, entries, maxEntries, estimatedSizeBytes, backend } = fields;

  if (
    name !== registryName || !Number.isSafeInteger(entries) || (entries as number) < -1 ||
    !isOptionalNonNegativeInteger(maxEntries) ||
    !isOptionalNonNegativeInteger(estimatedSizeBytes) ||
    (backend !== undefined &&
      (typeof backend !== "string" || backend.length === 0 ||
        backend.length > MAX_CACHE_BACKEND_LENGTH || hasControlCharacter(backend)))
  ) {
    throw new TypeError("Invalid cache stats");
  }

  const snapshot: CacheStats = {
    name: registryName,
    entries: entries as number,
    ...(maxEntries !== undefined ? { maxEntries: maxEntries as number } : {}),
    ...(estimatedSizeBytes !== undefined
      ? { estimatedSizeBytes: estimatedSizeBytes as number }
      : {}),
    ...(backend !== undefined ? { backend: backend as string } : {}),
  };

  for (const [key, fieldValue] of Object.entries(fields)) {
    if (!Object.hasOwn(snapshot, key)) snapshot[key] = fieldValue;
  }
  return snapshot;
}

function invalidMemoryArgument(message: string): Error {
  return INVALID_ARGUMENT.create({ message, detail: message });
}

function getMemoryErrorName(error: unknown): string {
  try {
    if (error instanceof Error && /^[A-Za-z][A-Za-z0-9.]{0,127}$/.test(error.name)) {
      return error.name;
    }
  } catch {
    // Use the generic name for hostile error objects.
  }
  return "Error";
}

function requireMonitoringInterval(value: unknown): number {
  if (
    !Number.isSafeInteger(value) || (value as number) < MIN_MEMORY_MONITORING_INTERVAL_MS ||
    (value as number) > MAX_TIMER_DELAY_MS
  ) {
    throw invalidMemoryArgument(
      `Memory monitoring interval must be an integer between ${MIN_MEMORY_MONITORING_INTERVAL_MS} and ${MAX_TIMER_DELAY_MS} ms`,
    );
  }
  return value as number;
}

let memoryCheckInterval: ReturnType<typeof setInterval> | undefined;
let memoryCheckIntervalMs: number | undefined;
let memoryMonitoringIdentity: symbol | undefined;
let activeMemoryMonitoringLease:
  | {
    identity: symbol;
    intervalMs: number;
    owners: number;
    stopOnFinalRelease: boolean;
  }
  | undefined;
let lastHeapUsed = 0;
let heapGrowthWarningThreshold = 0.8;
let pendingRapidHeapGrowth: PendingRapidHeapGrowth | undefined;

export interface PendingRapidHeapGrowth {
  baselineHeapUsedMB: number;
  observedGrowthMB: number;
}

export interface RapidHeapGrowthEvaluationInput {
  previousHeapUsedMB: number;
  currentHeapUsedMB: number;
  currentHeapUsedPercent?: number;
  pending: PendingRapidHeapGrowth | undefined;
  thresholdMB: number;
  memoryPressureWarningThresholdPercent?: number;
}

export interface RapidHeapGrowthEvaluation {
  shouldWarn: boolean;
  growthMB?: number;
  observedGrowthMB?: number;
  pending?: PendingRapidHeapGrowth;
}

export interface RapidHeapGrowthState {
  lastHeapUsedMB: number;
  pending: PendingRapidHeapGrowth | undefined;
}

export function registerCache(name: string, getStats: () => CacheStats): void {
  const safeName = requireCacheName(name);
  if (typeof getStats !== "function") {
    throw invalidMemoryArgument("Memory profiler cache stats callback must be a function");
  }
  if (!cacheRegistry.has(safeName) && cacheRegistry.size >= MAX_REGISTERED_CACHES) {
    throw SERVICE_OVERLOADED.create({
      message: "Memory profiler cache registry capacity reached",
    });
  }

  cacheRegistry.set(safeName, getStats);
  logger.debug("Cache registered with the memory profiler", { cacheName: safeName });
}

export function unregisterCache(name: string): void {
  cacheRegistry.delete(name);
}

export function getHeapStats(): HeapStats {
  const mem = memoryUsage();

  const usedHeapSizeMB = mem.heapUsed / (1024 * 1024);
  const totalHeapSizeMB = mem.heapTotal / (1024 * 1024);
  const heapSizeLimitMB = getConfiguredHeapLimit();
  const externalMemoryMB = mem.external / (1024 * 1024);
  const heapUsedPercent = (usedHeapSizeMB / heapSizeLimitMB) * 100;

  return {
    usedHeapSizeMB: Math.round(usedHeapSizeMB * 100) / 100,
    totalHeapSizeMB: Math.round(totalHeapSizeMB * 100) / 100,
    heapSizeLimitMB,
    externalMemoryMB: Math.round(externalMemoryMB * 100) / 100,
    heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
    rss: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
  };
}

function getConfiguredHeapLimit(): number {
  const args = getArgs().join(" ");

  const v8FlagsMatch = args.match(/--max-old-space-size=(\d+)/);
  if (v8FlagsMatch?.[1]) return parseInt(v8FlagsMatch[1], 10);

  const denoV8Flags = getEnv("DENO_V8_FLAGS");
  const denoV8Match = denoV8Flags?.match(/--max-old-space-size=(\d+)/);
  if (denoV8Match?.[1]) return parseInt(denoV8Match[1], 10);

  const v8MaxOldSpaceSize = parseInt(getEnv("V8_MAX_OLD_SPACE_SIZE") ?? "", 10);
  if (!Number.isNaN(v8MaxOldSpaceSize) && v8MaxOldSpaceSize > 0) return v8MaxOldSpaceSize;

  return DEFAULT_HEAP_LIMIT_MB;
}

export function getCacheStats(): CacheStats[] {
  const stats: CacheStats[] = [];

  for (const [name, getStats] of cacheRegistry) {
    try {
      stats.push(snapshotCacheStats(name, getStats()));
    } catch (error) {
      logger.warn("Failed to get cache stats", {
        cacheName: name,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      stats.push({ name, entries: -1 });
    }
  }

  return stats;
}

export function getMemorySnapshot(): MemorySnapshot {
  const heap = getHeapStats();
  const caches = getCacheStats();
  const totalCacheEntries = caches.reduce((sum, c) => sum + Math.max(0, c.entries), 0);

  return {
    timestamp: new Date().toISOString(),
    heap,
    caches,
    totalCacheEntries,
  };
}

function toMonitoringCacheStats(cache: CacheStats): MonitoringCacheStats {
  return {
    name: cache.name,
    entries: cache.entries,
    ...(cache.maxEntries !== undefined ? { maxEntries: cache.maxEntries } : {}),
    ...(cache.estimatedSizeBytes !== undefined
      ? { estimatedSizeBytes: cache.estimatedSizeBytes }
      : {}),
    ...(cache.backend !== undefined ? { backend: cache.backend } : {}),
  };
}

export function getTopCacheStats(caches: CacheStats[], limit = 8): MonitoringCacheStats[] {
  return [...caches]
    .filter((cache) => cache.entries > 0)
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(toMonitoringCacheStats);
}

export function getMemoryMonitoringLogContext(
  snapshot: MemorySnapshot,
  topCacheLimit = 8,
): MemoryMonitoringLogContext {
  const { heap } = snapshot;

  return {
    heapUsedMB: heap.usedHeapSizeMB,
    heapTotalMB: heap.totalHeapSizeMB,
    heapLimitMB: heap.heapSizeLimitMB,
    heapUsedPercent: heap.heapUsedPercent,
    rssMB: heap.rss,
    totalCacheEntries: snapshot.totalCacheEntries,
    topCaches: getTopCacheStats(snapshot.caches, topCacheLimit),
  };
}

export function getMemoryMonitoringConfig(env: MemoryMonitoringEnv): MemoryMonitoringConfig {
  let get: unknown;
  let enabledValue: unknown;
  let rawInterval: unknown;
  try {
    get = Reflect.get(env, "get");
    if (typeof get !== "function") throw new TypeError("Invalid environment accessor");
    enabledValue = Reflect.apply(get, env, ["ENABLE_MEMORY_MONITORING"]);
    rawInterval = Reflect.apply(get, env, ["MEMORY_MONITORING_INTERVAL_MS"]);
  } catch {
    throw invalidMemoryArgument("Memory monitoring environment could not be read safely");
  }

  if (
    enabledValue !== undefined && enabledValue !== null && typeof enabledValue !== "string"
  ) {
    throw invalidMemoryArgument("Memory monitoring enabled flag must be a string");
  }
  const enabled = enabledValue === "true";
  let intervalMs = DEFAULT_MEMORY_MONITORING_INTERVAL_MS;
  if (rawInterval !== undefined && rawInterval !== null) {
    if (typeof rawInterval !== "string" || !/^\d+$/.test(rawInterval)) {
      throw invalidMemoryArgument(
        `Memory monitoring interval must be an integer between ${MIN_MEMORY_MONITORING_INTERVAL_MS} and ${MAX_TIMER_DELAY_MS} ms`,
      );
    }
    intervalMs = requireMonitoringInterval(Number(rawInterval));
  }

  return { enabled, intervalMs };
}

function roundMemoryMB(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getInitialRapidHeapGrowthState(initialHeapUsedMB: number): RapidHeapGrowthState {
  return {
    lastHeapUsedMB: initialHeapUsedMB,
    pending: undefined,
  };
}

export function getRapidHeapGrowthEvaluation(
  input: RapidHeapGrowthEvaluationInput,
): RapidHeapGrowthEvaluation {
  const intervalGrowthMB = roundMemoryMB(input.currentHeapUsedMB - input.previousHeapUsedMB);

  if (input.pending) {
    const sustainedGrowthMB = roundMemoryMB(
      input.currentHeapUsedMB - input.pending.baselineHeapUsedMB,
    );
    if (sustainedGrowthMB > input.thresholdMB) {
      if (
        input.currentHeapUsedPercent !== undefined &&
        input.memoryPressureWarningThresholdPercent !== undefined &&
        input.currentHeapUsedPercent <= input.memoryPressureWarningThresholdPercent
      ) {
        return {
          shouldWarn: false,
          pending: input.pending,
        };
      }

      return {
        shouldWarn: true,
        growthMB: sustainedGrowthMB,
        observedGrowthMB: input.pending.observedGrowthMB,
      };
    }
    return { shouldWarn: false };
  }

  if (intervalGrowthMB > input.thresholdMB) {
    return {
      shouldWarn: false,
      pending: {
        baselineHeapUsedMB: input.previousHeapUsedMB,
        observedGrowthMB: intervalGrowthMB,
      },
    };
  }

  return { shouldWarn: false };
}

export function getMemoryMonitoringState(): MemoryMonitoringState {
  return {
    active: memoryCheckInterval !== undefined,
    intervalMs: memoryCheckIntervalMs,
  };
}

export async function forceGC(): Promise<boolean> {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (typeof gc !== "function") {
    // GC not exposed; pass --v8-flags=--expose-gc to enable
    return false;
  }

  try {
    gc();
    return true;
  } catch (error) {
    logger.debug("Exposed garbage collection failed", {
      errorName: getMemoryErrorName(error),
    });
    return false;
  }
}

function recordMemoryMonitoringSample(intervalMs: number): void {
  const snapshot = getMemorySnapshot();
  const { heap } = snapshot;
  const monitoringContext = getMemoryMonitoringLogContext(snapshot);

  logger.info("Memory status", monitoringContext);

  const thresholdPercent = heapGrowthWarningThreshold * 100;
  if (heap.heapUsedPercent > thresholdPercent) {
    logger.warn("HIGH MEMORY USAGE", {
      heapUsedPercent: heap.heapUsedPercent,
      threshold: thresholdPercent,
      topCaches: monitoringContext.topCaches,
      caches: snapshot.caches.map((c) => `${c.name}: ${c.entries}`).join(", "),
    });
  }

  const rapidGrowthEvaluation = getRapidHeapGrowthEvaluation({
    previousHeapUsedMB: lastHeapUsed,
    currentHeapUsedMB: heap.usedHeapSizeMB,
    currentHeapUsedPercent: heap.heapUsedPercent,
    pending: pendingRapidHeapGrowth,
    thresholdMB: HEAP_RAPID_GROWTH_THRESHOLD_MB,
    memoryPressureWarningThresholdPercent: thresholdPercent,
  });
  pendingRapidHeapGrowth = rapidGrowthEvaluation.pending;
  if (rapidGrowthEvaluation.shouldWarn) {
    logger.warn("Rapid heap growth detected", {
      growthMB: rapidGrowthEvaluation.growthMB,
      observedGrowthMB: rapidGrowthEvaluation.observedGrowthMB,
      intervalMs,
      topCaches: monitoringContext.topCaches,
    });
  }

  lastHeapUsed = heap.usedHeapSizeMB;
}

export function startMemoryMonitoring(intervalMs = DEFAULT_MEMORY_MONITORING_INTERVAL_MS): void {
  intervalMs = requireMonitoringInterval(intervalMs);
  if (activeMemoryMonitoringLease) {
    throw invalidMemoryArgument(
      "Memory monitoring cannot be replaced while a server lease is active",
    );
  }
  if (memoryCheckInterval) clearInterval(memoryCheckInterval);

  logger.info(`Starting memory monitoring (interval: ${intervalMs}ms)`);
  memoryCheckIntervalMs = intervalMs;
  const rapidGrowthState = getInitialRapidHeapGrowthState(getHeapStats().usedHeapSizeMB);
  lastHeapUsed = rapidGrowthState.lastHeapUsedMB;
  pendingRapidHeapGrowth = rapidGrowthState.pending;

  memoryCheckInterval = setInterval(() => {
    try {
      recordMemoryMonitoringSample(intervalMs);
    } catch (error) {
      logger.warn("Memory monitoring sample failed", {
        errorName: getMemoryErrorName(error),
      });
    }
  }, intervalMs);
  memoryMonitoringIdentity = Symbol("memory-monitoring");
}

function startResolvedMemoryMonitoring(config: MemoryMonitoringConfig): void {
  if (!config.enabled) return;

  try {
    startMemoryMonitoring(config.intervalMs);
    logger.info("Memory monitoring enabled", { intervalMs: config.intervalMs });

    const initialSnapshot = getMemorySnapshot();
    logger.info("Initial memory state", {
      heapUsedMB: initialSnapshot.heap.usedHeapSizeMB,
      heapLimitMB: initialSnapshot.heap.heapSizeLimitMB,
      cacheCount: initialSnapshot.caches.length,
    });
  } catch (error) {
    stopMemoryMonitoring();
    throw error;
  }
}

export function startConfiguredMemoryMonitoring(env: MemoryMonitoringEnv): MemoryMonitoringConfig {
  const config = getMemoryMonitoringConfig(env);
  startResolvedMemoryMonitoring(config);

  return config;
}

/**
 * Acquire shared ownership of the process-wide memory monitor.
 *
 * Multiple server instances with the same interval share one timer. The timer
 * is stopped only after the final owning lease is released. Lower-level start
 * and stop calls fail while a lease is active so they cannot steal ownership.
 */
export function acquireConfiguredMemoryMonitoring(
  env: MemoryMonitoringEnv,
): MemoryMonitoringLease {
  const config = getMemoryMonitoringConfig(env);
  if (!config.enabled) return { config, release: () => {} };

  let leaseState = activeMemoryMonitoringLease;
  if (leaseState) {
    if (
      memoryMonitoringIdentity !== leaseState.identity || memoryCheckInterval === undefined ||
      memoryCheckIntervalMs !== leaseState.intervalMs
    ) {
      throw invalidMemoryArgument(
        "Memory monitoring changed while an active server lease exists",
      );
    }
    if (leaseState.intervalMs !== config.intervalMs) {
      throw invalidMemoryArgument(
        "Memory monitoring interval conflicts with an active server lease",
      );
    }
    leaseState.owners++;
  } else if (memoryCheckInterval !== undefined) {
    if (memoryCheckIntervalMs !== config.intervalMs || memoryMonitoringIdentity === undefined) {
      throw invalidMemoryArgument(
        "Memory monitoring interval conflicts with the active process monitor",
      );
    }
    leaseState = {
      identity: memoryMonitoringIdentity,
      intervalMs: config.intervalMs,
      owners: 1,
      stopOnFinalRelease: false,
    };
    activeMemoryMonitoringLease = leaseState;
  } else {
    startResolvedMemoryMonitoring(config);
    if (memoryMonitoringIdentity === undefined) {
      throw new Error("Memory monitoring did not start");
    }
    leaseState = {
      identity: memoryMonitoringIdentity,
      intervalMs: config.intervalMs,
      owners: 1,
      stopOnFinalRelease: true,
    };
    activeMemoryMonitoringLease = leaseState;
  }

  let released = false;
  return {
    config,
    release: () => {
      if (released) return;
      released = true;
      leaseState.owners--;
      if (leaseState.owners > 0 || activeMemoryMonitoringLease !== leaseState) return;

      activeMemoryMonitoringLease = undefined;
      if (leaseState.stopOnFinalRelease && memoryMonitoringIdentity === leaseState.identity) {
        stopMemoryMonitoring();
      }
    },
  };
}

export function stopMemoryMonitoring(): void {
  if (activeMemoryMonitoringLease) {
    throw invalidMemoryArgument(
      "Memory monitoring cannot be stopped while a server lease is active",
    );
  }
  if (!memoryCheckInterval) return;

  clearInterval(memoryCheckInterval);
  memoryCheckInterval = undefined;
  memoryCheckIntervalMs = undefined;
  memoryMonitoringIdentity = undefined;
  pendingRapidHeapGrowth = undefined;
  logger.info("Memory monitoring stopped");
}

export function setHeapWarningThreshold(threshold: number): void {
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    throw invalidMemoryArgument("Memory warning threshold must be a finite number");
  }
  heapGrowthWarningThreshold = Math.max(0.1, Math.min(0.99, threshold));
}

/**
 * Memory pressure thresholds - should match pressure.ts defaults for consistency.
 * Uses same env vars: MEMORY_WARNING_THRESHOLD (default: 75), MEMORY_CRITICAL_THRESHOLD (default: 80)
 */
function getMemoryThreshold(envVar: string, fallback: number): number {
  try {
    const value = getEnv(envVar);
    if (!value) return fallback;

    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;

    return parsed;
  } catch (_) {
    /* expected: Deno.env.get may fail without --allow-env */
    return fallback;
  }
}

const PROFILER_WARNING_THRESHOLD = getMemoryThreshold("MEMORY_WARNING_THRESHOLD", 75);
const PROFILER_CRITICAL_THRESHOLD = getMemoryThreshold("MEMORY_CRITICAL_THRESHOLD", 80);

export function checkMemoryPressure(): {
  critical: boolean;
  warning: boolean;
  heapUsedPercent: number;
} {
  const heap = getHeapStats();
  const heapUsedPercent = heap.heapUsedPercent;

  const critical = heapUsedPercent > PROFILER_CRITICAL_THRESHOLD;
  const warning = heapUsedPercent > PROFILER_WARNING_THRESHOLD;

  if (critical) {
    logger.error("CRITICAL MEMORY PRESSURE", {
      heapUsedPercent,
      usedMB: heap.usedHeapSizeMB,
      limitMB: heap.heapSizeLimitMB,
      threshold: PROFILER_CRITICAL_THRESHOLD,
    });
  }

  return { critical, warning, heapUsedPercent };
}

export type { MemorySnapshot as MemorySnapshotType };
