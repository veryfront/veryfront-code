/**
 * Utils Memory
 *
 * @module utils/memory
 */

export {
  type CacheStats,
  checkMemoryPressure,
  clearAllCaches,
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
