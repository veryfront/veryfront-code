/**
 * Repository Layer
 *
 * Unified interfaces for filesystem and cache access with project-scoped operations.
 *
 * ## Overview
 *
 * The repository layer provides:
 * - **Project-scoped operations**: Automatic key prefixing for cache and context for files
 * - **Unified interfaces**: Drop-in replacements for SecureFs and cache backends
 * - **Test mocks**: Easy testing without vi.mock() or path mocking
 *
 * ## Usage
 *
 * ### In Handlers/Services
 *
 * ```typescript
 * import { createRepositoryFactory, extractRepositoryContext } from "#veryfront/repositories";
 *
 * // Create factory from handler context
 * const factory = createRepositoryFactory(ctx);
 *
 * // Get repositories
 * const fsRepo = factory.createFileSystemRepository("static-serving");
 * const cacheRepo = factory.createCacheRepository(backend);
 *
 * // Use like normal
 * const content = await fsRepo.readFile("pages/index.mdx");
 * await cacheRepo.set("manifest", data);
 * ```
 *
 * ### In Tests
 *
 * ```typescript
 * import { MockFileSystemRepository, MockCacheRepository, createMockRepositoryContext } from "#veryfront/repositories/testing";
 *
 * // Create mocks
 * const mockFs = new MockFileSystemRepository({
 *   context: createMockRepositoryContext({ projectId: "test" }),
 *   files: { "pages/index.mdx": "# Hello" },
 * });
 *
 * // Inject into service
 * const service = new MyService(mockFs);
 *
 * // Assert calls
 * expect(mockFs.getCalls("readFile")).toHaveLength(1);
 * ```
 *
 * @module repositories
 */

// Core types
export type {
  CacheRepository,
  CacheRepositoryOptions,
  CacheStats,
  FileSystemRepository,
  FileSystemRepositoryOptions,
  RepositoryContext,
} from "./types.ts";

// FileSystem repository
export {
  createFileSystemRepository,
  SecureFsRepository,
  type SecureFsRepositoryConfig,
} from "./filesystem/index.ts";

// Cache repository
export {
  buildScopedKey,
  createMemoryCacheRepository,
  createMultiTierCacheRepository,
  MemoryCacheRepository,
  MultiTierCacheRepository,
} from "./cache/index.ts";

// Factory and helpers
export {
  createRepositoryContext,
  createRepositoryFactory,
  extractRepositoryContext,
  RepositoryFactory,
  type RepositoryFactoryConfig,
} from "./factory.ts";
