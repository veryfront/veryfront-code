/**
 * Memory Management Module
 *
 * Exports memory profiling and monitoring utilities
 */

export {
  registerCache,
  unregisterCache,
  getHeapStats,
  getCacheStats,
  getMemorySnapshot,
  forceGC,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  setHeapWarningThreshold,
  clearAllCaches,
  checkMemoryPressure,
  type CacheStats,
  type HeapStats,
  type MemorySnapshot,
  type GCStats,
} from "./profiler.ts";
