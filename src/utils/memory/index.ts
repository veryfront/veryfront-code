/**
 * Utils Memory
 *
 * @module utils/memory
 */

export {
  type CacheStats,
  checkMemoryPressure,
  clearAllCaches,
  forceGC,
  type GCStats,
  getCacheStats,
  getHeapStats,
  getMemoryMonitoringLogContext,
  getMemorySnapshot,
  getTopCacheStats,
  type HeapStats,
  type MemoryMonitoringLogContext,
  type MemorySnapshot,
  type MonitoringCacheStats,
  registerCache,
  setHeapWarningThreshold,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  unregisterCache,
} from "./profiler.ts";
