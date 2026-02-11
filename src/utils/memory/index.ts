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
  getMemorySnapshot,
  type HeapStats,
  type MemorySnapshot,
  registerCache,
  setHeapWarningThreshold,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  unregisterCache,
} from "./profiler.ts";
