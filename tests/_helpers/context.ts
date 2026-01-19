/**
 * TestContext - Comprehensive test environment management
 *
 * Provides a bulletproof testing context that handles:
 * - Server lifecycle (start, ready, stop)
 * - Port allocation without conflicts
 * - Temporary directory management
 * - Resource cleanup guarantees
 * - Environment isolation
 *
 * Usage:
 * ```typescript
 * const context = new TestContext("my-test");
 * await context.setup();
 * try {
 *   const server = await context.createDevServer();
 *   // Run tests...
 * } finally {
 *   await context.cleanup();
 * }
 * ```
 */

import { join } from "@veryfront/compat/path";
import {
  isNotFoundError,
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../../src/platform/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "../../src/platform/compat/process.ts";
import { createDevServer } from "../../src/server/dev-server.ts";
import { startProductionServer } from "../../src/server/production-server.ts";
import { resetApiHandler } from "../../src/server/handlers/request/api/index.ts";
import { runWithCacheDir } from "../../src/utils/cache-dir.ts";
import type { TestServer } from "./server.ts";
import { getFreePort } from "./utils.ts";

// Initialize esbuild without worker to prevent hanging tests
// This is done globally so all tests share the same esbuild instance
let esbuildInitialized = false;
try {
  const { initialize } = await import("esbuild");
  await initialize({
    worker: false,
  });
  esbuildInitialized = true;
  // Set global flag so cleanupBundler knows to skip stopping esbuild
  // This prevents "child process started before test but closed during test" errors
  (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild = true;
} catch {
  // Ignore if already initialized or module missing
}

// Export for cleanup decision
export { esbuildInitialized };

function safeSetEnv(key: string, value: string | undefined): void {
  try {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  } catch (_error) {
    // ignore if env access is restricted
  }
}

// Initialize global LRU disable flag to prevent resource leaks during tests
safeSetEnv("VF_DISABLE_LRU_INTERVAL", "1");
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

// Global port allocator to prevent conflicts
class PortAllocator {
  private static instance: PortAllocator;
  private usedPorts = new Set<number>();

  // Wide default range for parallel worktree safety
  // Override via TEST_PORT_MIN / TEST_PORT_MAX env vars
  private get MIN_PORT(): number {
    return parseInt(getEnv("TEST_PORT_MIN") || "10000", 10);
  }
  private get MAX_PORT(): number {
    return parseInt(getEnv("TEST_PORT_MAX") || "60000", 10);
  }

  static getInstance(): PortAllocator {
    if (!PortAllocator.instance) {
      PortAllocator.instance = new PortAllocator();
    }
    return PortAllocator.instance;
  }

  async allocate(): Promise<number> {
    // Delegate to shared helper - it also respects TEST_PORT_MIN/MAX
    const port = await getFreePort();
    if (this.usedPorts.has(port)) {
      // Extremely unlikely, but ensure uniqueness within this process
      for (let p = this.MIN_PORT; p <= this.MAX_PORT; p++) {
        if (this.usedPorts.has(p)) continue;
        this.usedPorts.add(p);
        return Promise.resolve(p);
      }
    }
    this.usedPorts.add(port);
    return Promise.resolve(port);
  }

  release(port: number): void {
    this.usedPorts.delete(port);
  }
}

export class TestContext {
  private readonly testName: string;
  private tempDir?: string;
  private cacheDir?: string;
  private servers: TestServer[] = [];
  private serverControllers: AbortController[] = [];
  private allocatedPorts: number[] = [];
  private originalEnv: Map<string, string | undefined> = new Map();
  private originalDisableLru?: string;
  private originalDisableLruGlobal?: unknown;
  private originalCacheDir?: string;
  private cleanupHandlers: Array<() => Promise<void>> = [];

  constructor(testName: string) {
    this.testName = testName;

    try {
      this.originalDisableLru = process.env["VF_DISABLE_LRU_INTERVAL"];
      process.env["VF_DISABLE_LRU_INTERVAL"] = "1";
    } catch (_error) {
      // Environment modifications may be disallowed in some contexts
    }
    this.originalDisableLruGlobal = (globalThis as Record<string, unknown>).__vfDisableLruInterval;
    (globalThis as Record<string, unknown>).__vfDisableLruInterval = true;
  }

  /**
   * Sets up the test context
   * Must be called before any other operations
   */
  async setup(): Promise<void> {
    // Create isolated temp directory
    const prefix = `veryfront_test_${this.testName}_`;
    this.tempDir = await makeTempDir({ prefix });

    // Create isolated cache directory for test isolation during parallel execution
    // This prevents race conditions when multiple tests write to .cache/veryfront-mdx-esm
    this.cacheDir = await makeTempDir({ prefix: `veryfront_cache_${this.testName}_` });

    // NOTE: We intentionally do NOT set VF_CACHE_DIR env var here anymore.
    // Setting a global env var causes race conditions in parallel tests.
    // Instead, we rely entirely on AsyncLocalStorage via runWithCacheDir().
    // Save original for any code that might read it (legacy behavior)
    this.originalCacheDir = getEnv("VF_CACHE_DIR");

    // Set up standard project structure
    await this.createProjectStructure();
  }

  /**
   * Gets the test project directory
   */
  get projectDir(): string {
    if (!this.tempDir) {
      throw new Error("TestContext not set up. Call setup() first.");
    }
    return this.tempDir;
  }

  /**
   * Gets the test cache directory (for AsyncLocalStorage isolation)
   */
  get testCacheDir(): string {
    if (!this.cacheDir) {
      throw new Error("TestContext not set up. Call setup() first.");
    }
    return this.cacheDir;
  }

  /**
   * Allocates a free port for testing
   */
  async allocatePort(): Promise<number> {
    const port = await PortAllocator.getInstance().allocate();
    this.allocatedPorts.push(port);
    return port;
  }

  /**
   * Sets environment variables with automatic cleanup
   *
   * Note: Environment variables are global across all parallel test workers.
   * VF_CACHE_DIR is automatically isolated per test to prevent cache conflicts.
   * For other env vars, ensure tests with different requirements don't conflict.
   */
  setTestEnv(vars: Record<string, string>): void {
    for (const [key, value] of Object.entries(vars)) {
      if (!this.originalEnv.has(key)) {
        // Store original value using portable env getter
        const originalValue = getEnv(key);
        this.originalEnv.set(key, originalValue);
      }
      // Set using portable env setter (handles both Deno and Node/Bun)
      setEnv(key, value);
    }
  }

  /**
   * Alias for setTestEnv - Sets environment variables with automatic cleanup
   */
  setEnv(vars: Record<string, string>): void {
    this.setTestEnv(vars);
  }

  /**
   * Creates a development server with automatic cleanup
   */
  async createDevServer(options: {
    port?: number;
    enableHMR?: boolean;
    fileWatcherDebounceMs?: number;
    signal?: AbortSignal;
  } = {}): Promise<TestServer> {
    const port = options.port || (await this.allocatePort());

    const server = await createDevServer({
      projectDir: this.projectDir,
      port,
      enableHMR: options.enableHMR ?? false,
      fileWatcherDebounceMs: options.fileWatcherDebounceMs,
      signal: options.signal,
    });

    // Add to tracked servers
    const testServer = server as TestServer;
    testServer.port = port;
    // Use 127.0.0.1 explicitly to avoid IPv6 resolution issues with localhost
    testServer.hostname = "127.0.0.1";
    this.servers.push(testServer);

    // Wait for server to be ready
    await this.waitForServerReady(testServer);

    return testServer;
  }

  /**
   * Creates a production server with automatic cleanup
   */
  async createProductionServer(
    options: { port?: number; hostname?: string } = {},
  ): Promise<TestServer> {
    const port = options.port || (await this.allocatePort());
    const hostname = options.hostname || "127.0.0.1";

    // Create AbortController for proper cleanup
    const controller = new AbortController();
    this.serverControllers.push(controller);

    const server = await startProductionServer({
      projectDir: this.projectDir,
      port,
      bindAddress: hostname,
      signal: controller.signal,
    });

    // Add to tracked servers
    const testServer = server as TestServer;
    testServer.port = port;
    testServer.hostname = hostname;
    this.servers.push(testServer);

    // Wait for server to be ready
    await this.waitForServerReady(testServer);

    return testServer;
  }

  /**
   * Adds a cleanup handler to be run during cleanup
   */
  addCleanup(handler: () => Promise<void> | void): void {
    this.cleanupHandlers.push(async () => await handler());
  }

  /**
   * Tracks a resource with automatic cleanup
   */
  trackResource<T extends { close?: () => any; stop?: () => any; terminate?: () => any }>(
    resource: T,
    name?: string,
  ): T {
    this.addCleanup(async () => {
      try {
        if (resource.stop) await resource.stop();
        if (resource.close) await resource.close();
        if (resource.terminate) await resource.terminate();
      } catch (error) {
        console.error(`Failed to cleanup resource ${name || "unknown"}:`, error);
      }
    });
    return resource;
  }

  /**
   * Cleans up all resources
   * MUST be called in a finally block
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    // Run custom cleanup handlers
    for (const handler of this.cleanupHandlers) {
      try {
        await handler();
      } catch (error) {
        errors.push(error as Error);
      }
    }

    // Abort all server controllers first to signal shutdown
    for (const controller of this.serverControllers) {
      try {
        controller.abort();
      } catch {
        // Ignore abort errors - server may already be stopped
      }
    }

    // Stop all servers
    for (const server of this.servers) {
      try {
        await server.stop();
        await this.waitForServerStopped(server);
      } catch {
        // Ignore stop errors - server may already be stopped
      }
    }

    // Clear the arrays to prevent double cleanup
    this.serverControllers.length = 0;
    this.servers.length = 0;

    // Clean up renderers and caches to prevent resource leaks
    try {
      const { cleanupBundler } = await import("../../src/rendering/cleanup.ts");
      await cleanupBundler();
    } catch (error) {
      errors.push(error as Error);
    }

    try {
      await resetApiHandler(this.projectDir);
    } catch (error) {
      errors.push(error as Error);
    }

    // Release all ports
    const portAllocator = PortAllocator.getInstance();
    for (const port of this.allocatedPorts) {
      portAllocator.release(port);
    }

    // Restore environment variables using portable env functions
    for (const [key, originalValue] of this.originalEnv) {
      if (originalValue === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, originalValue);
      }
    }

    try {
      if (this.originalDisableLru === undefined) {
        delete process.env["VF_DISABLE_LRU_INTERVAL"];
      } else {
        process.env["VF_DISABLE_LRU_INTERVAL"] = this.originalDisableLru;
      }
    } catch (_error) {
      // ignore if env cannot be restored
    }

    if (this.originalDisableLruGlobal === undefined) {
      delete (globalThis as Record<string, unknown>).__vfDisableLruInterval;
    } else {
      (globalThis as Record<string, unknown>).__vfDisableLruInterval =
        this.originalDisableLruGlobal;
    }

    // Note: VF_CACHE_DIR is no longer set in setup() to avoid race conditions.
    // We rely on AsyncLocalStorage (runWithCacheDir) for cache isolation instead.

    // Remove cache directory
    if (this.cacheDir) {
      try {
        await remove(this.cacheDir, { recursive: true });
      } catch (error) {
        if (!isNotFoundError(error)) {
          errors.push(error as Error);
        }
      }
    }

    // Remove temp directory
    if (this.tempDir) {
      try {
        await remove(this.tempDir, { recursive: true });
      } catch (error) {
        if (!isNotFoundError(error)) {
          errors.push(error as Error);
        }
      }
    }

    // Report any cleanup errors
    if (errors.length > 0) {
      console.error(`[TestContext] Cleanup errors for ${this.testName}:`, errors);
    }
  }

  /**
   * Creates a standard project structure for testing
   */
  private async createProjectStructure(): Promise<void> {
    const dirs = [
      "pages",
      "app",
      "components",
      "public",
      "styles",
      "islands",
      "src/components",
      "src/islands",
    ];
    for (const dir of dirs) {
      await mkdir(join(this.projectDir, dir), { recursive: true });
    }

    // Create default config
    await writeTextFile(
      join(this.projectDir, "veryfront.config.js"),
      `export default {
  title: "Test Site",
  description: "Test site for ${this.testName}"
};`,
    );
  }

  /**
   * Waits for a server to be ready with exponential backoff
   */
  private async waitForServerReady(server: TestServer): Promise<void> {
    const maxAttempts = 20;
    const baseDelay = 100;
    const maxDelay = 2000;

    // First, wait for the ready promise if available
    if (server.ready && typeof server.ready.then === "function") {
      let timeoutId: number | undefined;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Server ready timeout")), 10000);
      });

      try {
        await Promise.race([server.ready, timeout]);
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    }

    // Then verify with HTTP requests
    const port = server.port || 3000;
    const hostname = server.hostname || "localhost";
    const url = `http://${hostname}:${port}/`;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response | null = null;
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(2000),
        });

        if (response.status >= 200 && response.status < 600) {
          // Consume the response body
          await response.body?.cancel();
          response = null; // Mark as consumed

          // Verify with one more request
          let verify: Response | null = null;
          try {
            verify = await fetch(url, {
              signal: AbortSignal.timeout(2000),
            });

            if (verify.status >= 200 && verify.status < 600) {
              // Consume the verify response body
              await verify.body?.cancel();
              return;
            }
            // Consume body if verification failed
            await verify.body?.cancel();
            verify = null;
          } catch {
            // Verification request failed, ensure body is consumed
            await verify?.body?.cancel();
          }
        } else {
          // Consume body if status check failed
          await response.body?.cancel();
          response = null;
        }
      } catch {
        // Server not ready yet, ensure body is consumed if fetch succeeded
        await response?.body?.cancel();
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelay * 1.5 ** attempt + Math.random() * 100, maxDelay);

      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(resolve, delay);
        // Clear immediately after resolution
        Promise.resolve().then(() => clearTimeout(timeoutId));
      });
    }

    throw new Error(`Server at ${url} not ready after ${maxAttempts} attempts`);
  }

  /**
   * Waits for a server to stop
   */
  private async waitForServerStopped(server: TestServer): Promise<void> {
    const port = server.port || 3000;
    const hostname = server.hostname || "localhost";
    const url = `http://${hostname}:${port}/`;

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(100) });
        // Consume the response body
        await response.body?.cancel();
        // If fetch succeeds, server is still running, wait before next attempt
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      } catch {
        // Server has stopped
        return;
      }
    }

    // Server might still be running, but we've waited enough
  }
}

/**
 * Test helper function that automatically manages context
 * Uses AsyncLocalStorage to isolate cache directories per test,
 * enabling safe parallel test execution.
 */
export async function withTestContext<T>(
  testName: string,
  fn: (context: TestContext) => Promise<T>,
): Promise<T> {
  const context = new TestContext(testName);
  await context.setup();

  try {
    // Run with isolated cache directory using AsyncLocalStorage
    // This ensures all cache operations within this test use the test's temp cache
    return await runWithCacheDir(context.testCacheDir, async () => {
      // Clear MDX renderer cache at the START of each test to ensure
      // the singleton picks up this test's cache dir (via AsyncLocalStorage),
      // not a stale cache dir from a previous test
      try {
        const { clearMDXRendererCache } = await import("../../src/build/transforms/mdx/index.ts");
        clearMDXRendererCache();
      } catch {
        // May fail if module not loaded yet, which is fine
      }

      // Reset React cache to prevent cross-test React instance conflicts
      try {
        const { resetReactCache } = await import(
          "../../src/react/compat/ssr-adapter/server-loader.ts"
        );
        resetReactCache();
      } catch {
        // May fail if module not loaded yet, which is fine
      }

      // Reset compat hooks context to prevent React instance conflicts
      try {
        const { resetCompatHooksContext } = await import(
          "../../src/react/compat/hooks-adapter.ts"
        );
        resetCompatHooksContext();
      } catch {
        // May fail if module not loaded yet, which is fine
      }

      return await fn(context);
    });
  } finally {
    await context.cleanup();
  }
}
