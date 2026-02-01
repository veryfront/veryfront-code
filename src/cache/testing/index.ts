/**
 * Cache Testing Utilities
 *
 * Shared testing infrastructure for all cache implementations.
 * Import these utilities to write consistent, thorough cache tests.
 *
 * @module cache/testing
 */

export {
  type CacheInvariantTestOptions,
  type MinimalCache,
  runCacheInvariantTests,
  testConcurrentAccess,
  testKeyCollisionResistance,
  testMemoryBounds,
} from "./invariants.ts";

export {
  createFailingMock,
  createPopulatedMock,
  createSlowMock,
  MockCacheBackend,
  type MockCacheBackendOptions,
  type RecordedOperation,
} from "./mock-backend.ts";
