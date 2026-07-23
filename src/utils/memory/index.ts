/**
 * Utils Memory
 *
 * @module utils/memory
 */

export {
  acquireConfiguredMemoryMonitoring,
  type CacheStats,
  checkMemoryPressure,
  DEFAULT_MEMORY_MONITORING_INTERVAL_MS,
  forceGC,
  type GCStats,
  getCacheStats,
  getHeapStats,
  getMemoryMonitoringConfig,
  getMemoryMonitoringLogContext,
  getMemoryMonitoringState,
  getMemorySnapshot,
  getTopCacheStats,
  type HeapStats,
  type MemoryMonitoringConfig,
  type MemoryMonitoringEnv,
  type MemoryMonitoringLease,
  type MemoryMonitoringLogContext,
  type MemoryMonitoringState,
  type MemorySnapshot,
  type MonitoringCacheStats,
  registerCache,
  setHeapWarningThreshold,
  startConfiguredMemoryMonitoring,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  unregisterCache,
} from "./profiler.ts";
