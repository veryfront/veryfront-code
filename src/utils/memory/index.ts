/**
 * Utils Memory
 *
 * @module utils/memory
 */

export {
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
  getMemoryRecycleConfig,
  getMemoryRecycleEvaluation,
  getMemorySnapshot,
  getTopCacheStats,
  type HeapStats,
  type MemoryMonitoringConfig,
  type MemoryMonitoringEnv,
  type MemoryMonitoringLogContext,
  type MemoryMonitoringState,
  type MemoryRecycleConfig,
  type MemoryRecycleEvaluation,
  type MemoryRecycleEvent,
  type MemoryRecycleState,
  type MemorySnapshot,
  type MonitoringCacheStats,
  registerCache,
  setHeapWarningThreshold,
  startConfiguredMemoryMonitoring,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  unregisterCache,
} from "./profiler.ts";
