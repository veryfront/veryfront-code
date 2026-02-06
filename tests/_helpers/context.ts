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
 *   const server = await context.startDevServer();
 *   // Run tests...
 * } finally {
 *   await context.cleanup();
 * }
 * ```
 */

import { join } from "#veryfront/compat/path";
import {
  isNotFoundError,
  makeTempDir,
  mkdir,
  remove,
  writeTextFile,
} from "../../src/platform/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "../../src/platform/compat/process.ts";
import { startDevServer } from "../../src/server/dev-server.ts";
import { startProductionServer } from "../../src/server/production-server.ts";
import { resetApiHandler } from "../../src/server/handlers/request/api/index.ts";
import { runWithCacheDir } from "../../src/utils/cache-dir.ts";
import { resetAllTestState } from "../../src/testing/isolation.ts";
import { SERVER_CONFIG, TEST_TIMEOUTS } from "./constants.ts";
import {
  getHttpServerUrl,
  pollHttpReadyByAttempts,
  pollHttpStoppedByAttempts,
  waitForHttpServerReadySignal,
} from "./http-polling.ts";
import type { TestServer } from "./server.ts";
import { getFreePort } from "./utils.ts";

// Initialize esbuild without worker to prevent hanging tests
// This is done globally so all tests share the same esbuild instance
let esbuildInitialized = false;
try {
  const { initialize } = await import("esbuild");
  await initialize({ worker: false });
  esbuildInitialized = true;

  // Set global flag so cleanupBundler knows to skip stopping esbuild
  // This prevents "child process started before test but closed during test" errors
  (globalThis as Record<string, unknown>).__vfTestPreserveEsbuild = true;
} catch {
  // Ignore if already initialized or module missing
}

export { esbuildInitialized };

function safeSetEnv(key: string, value: string | undefined): void {
  try {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  } catch {
    // ignore if env access is restricted
  }
}

// Initialize global LRU disable flag to prevent resource leaks during tests
safeSetEnv("VF_DISABLE_LRU_INTERVAL", "1");
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

// Global port allocator to prevent conflicts within this process.
// getFreePort() uses OS-assigned port 0, which guarantees uniqueness
// across processes. This allocator adds intra-process dedup as a safety net.
class PortAllocator {
  private static instance: PortAllocator;
  private usedPorts = new Set<number>();

  static getInstance(): PortAllocator {
    PortAllocator.instance ??= new PortAllocator();
    return PortAllocator.instance;
  }

  async allocate(): Promise<number> {
    // OS-assigned port 0 is very unlikely to collide within one process,
    // but retry if it does.
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = await getFreePort();
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error("Failed to allocate unique port after 10 attempts");
  }

  release(port: number): void {
    this.usedPorts.delete(port);
  }
}

export class TestContext {
  private readonly testName: string;
  private tempDir?: string;
  private cacheDir?: string;
  private _projectId?: string;
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
    } catch {
      // Environment modifications may be disallowed in some contexts
    }

    const globalRecord = globalThis as Record<string, unknown>;
    this.originalDisableLruGlobal = globalRecord.__vfDisableLruInterval;
    globalRecord.__vfDisableLruInterval = true;
  }

  /**
   * Sets up the test context
   * Must be called before any other operations
   */
  async setup(): Promise<void> {
    const prefix = `veryfront_test_${this.testName}_`;
    this.tempDir = await makeTempDir({ prefix });

    // Create isolated cache directory for test isolation during parallel execution
    // This prevents race conditions when multiple tests write to .cache/veryfront-mdx-esm
    this.cacheDir = await makeTempDir({ prefix: `veryfront_cache_${this.testName}_` });

    // Generate a unique short projectId for cache isolation
    // Use test name + random suffix to avoid collisions
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    this._projectId = `test_${
      this.testName
        .replace(/[^a-zA-Z0-9]/g, "_")
        .substring(0, 20)
    }_${randomSuffix}`;

    // NOTE: We intentionally do NOT set VF_CACHE_DIR env var here anymore.
    // Setting a global env var causes race conditions in parallel tests.
    // Instead, we rely entirely on AsyncLocalStorage via runWithCacheDir().
    // Save original for any code that might read it (legacy behavior)
    this.originalCacheDir = getEnv("VF_CACHE_DIR");

    await this.createProjectStructure();
  }

  /**
   * Gets the test project directory
   */
  get projectDir(): string {
    if (!this.tempDir) throw new Error("TestContext not set up. Call setup() first.");
    return this.tempDir;
  }

  /**
   * Gets the test cache directory (for AsyncLocalStorage isolation)
   */
  get testCacheDir(): string {
    if (!this.cacheDir) throw new Error("TestContext not set up. Call setup() first.");
    return this.cacheDir;
  }

  /**
   * Gets a unique short projectId for cache isolation
   * Use this instead of projectDir when a short identifier is needed
   */
  get projectId(): string {
    if (!this._projectId) throw new Error("TestContext not set up. Call setup() first.");
    return this._projectId;
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
        this.originalEnv.set(key, getEnv(key));
      }
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
  async startDevServer(options: {
    port?: number;
    enableHMR?: boolean;
    fileWatcherDebounceMs?: number;
    signal?: AbortSignal;
  } = {}): Promise<TestServer> {
    const port = options.port ?? (await this.allocatePort());
    const enableHMR = options.enableHMR ?? false;
    const hmrPort = enableHMR ? await this.allocatePort() : undefined;

    const server = await startDevServer({
      projectDir: this.projectDir,
      port,
      hmrPort,
      enableHMR,
      fileWatcherDebounceMs: options.fileWatcherDebounceMs,
      signal: options.signal,
      defaultProjectSlug: this.projectId,
      defaultProjectId: this.projectId,
    });

    const testServer = server as TestServer;
    testServer.port = port;
    // Use 127.0.0.1 explicitly to avoid IPv6 resolution issues with localhost
    testServer.hostname = "127.0.0.1";
    this.servers.push(testServer);

    await this.waitForServerReady(testServer);
    return testServer;
  }

  /**
   * Creates a production server with automatic cleanup
   */
  async createProductionServer(
    options: { port?: number; hostname?: string } = {},
  ): Promise<TestServer> {
    const port = options.port ?? (await this.allocatePort());
    const hostname = options.hostname ?? "127.0.0.1";

    const controller = new AbortController();
    this.serverControllers.push(controller);

    const server = await startProductionServer({
      projectDir: this.projectDir,
      port,
      bindAddress: hostname,
      signal: controller.signal,
      // Pass test-specific projectSlug and projectId for cache isolation
      defaultProjectSlug: this.projectId,
      defaultProjectId: this.projectId,
    });

    const testServer = server as TestServer;
    testServer.port = port;
    testServer.hostname = hostname;
    this.servers.push(testServer);

    await this.waitForServerReady(testServer);
    return testServer;
  }

  /**
   * Adds a cleanup handler to be run during cleanup
   */
  addCleanup(handler: () => Promise<void> | void): void {
    this.cleanupHandlers.push(async () => {
      await handler();
    });
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
        await resource.stop?.();
        await resource.close?.();
        await resource.terminate?.();
      } catch (error) {
        console.error(`Failed to cleanup resource ${name ?? "unknown"}:`, error);
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

    for (const handler of this.cleanupHandlers) {
      try {
        await handler();
      } catch (error) {
        errors.push(error as Error);
      }
    }

    for (const controller of this.serverControllers) {
      try {
        controller.abort();
      } catch {
        // Ignore abort errors - server may already be stopped
      }
    }

    for (const server of this.servers) {
      try {
        await server.stop();
        await this.waitForServerStopped(server);
      } catch {
        // Ignore stop errors - server may already be stopped
      }
    }

    this.serverControllers.length = 0;
    this.servers.length = 0;

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

    const portAllocator = PortAllocator.getInstance();
    for (const port of this.allocatedPorts) portAllocator.release(port);

    for (const [key, originalValue] of this.originalEnv) {
      if (originalValue === undefined) deleteEnv(key);
      else setEnv(key, originalValue);
    }

    try {
      if (this.originalDisableLru === undefined) {
        delete process.env["VF_DISABLE_LRU_INTERVAL"];
      } else {
        process.env["VF_DISABLE_LRU_INTERVAL"] = this.originalDisableLru;
      }
    } catch {
      // ignore if env cannot be restored
    }

    const globalRecord = globalThis as Record<string, unknown>;
    if (this.originalDisableLruGlobal === undefined) {
      delete globalRecord.__vfDisableLruInterval;
    } else {
      globalRecord.__vfDisableLruInterval = this.originalDisableLruGlobal;
    }

    if (this.cacheDir) {
      try {
        await remove(this.cacheDir, { recursive: true });
      } catch (error) {
        if (!isNotFoundError(error)) errors.push(error as Error);
      }
    }

    if (this.tempDir) {
      try {
        await remove(this.tempDir, { recursive: true });
      } catch (error) {
        if (!isNotFoundError(error)) errors.push(error as Error);
      }
    }

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
    const maxAttempts = SERVER_CONFIG.MAX_READY_ATTEMPTS;
    const url = getHttpServerUrl(server, { defaultPort: 3000, defaultHostname: "localhost" });

    await waitForHttpServerReadySignal(server, {
      timeoutMs: TEST_TIMEOUTS.SERVER_STARTUP,
      timeoutMessage: "Server ready timeout",
    });

    const ready = await pollHttpReadyByAttempts(url, {
      maxAttempts,
      baseDelayMs: SERVER_CONFIG.READY_CHECK_DELAY,
      maxDelayMs: SERVER_CONFIG.MAX_READY_DELAY,
      backoffFactor: 1.5,
      jitterMs: 100,
      requestTimeoutMs: SERVER_CONFIG.FETCH_TIMEOUT,
    });

    if (ready) return;
    throw new Error(`Server at ${url} not ready after ${maxAttempts} attempts`);
  }

  /**
   * Waits for a server to stop
   */
  private async waitForServerStopped(server: TestServer): Promise<void> {
    const url = getHttpServerUrl(server, { defaultPort: 3000, defaultHostname: "localhost" });

    await pollHttpStoppedByAttempts(url, {
      maxAttempts: 10,
      retryDelayMs: 100,
      requestTimeoutMs: 100,
    });
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
    return await runWithCacheDir(context.testCacheDir, async () => {
      // Reset ALL state before test to ensure clean isolation
      await resetAllTestState();

      // Clear MDX renderer cache at the START of each test to ensure
      // the singleton picks up this test's cache dir (via AsyncLocalStorage),
      // not a stale cache dir from a previous test
      try {
        const { clearMDXRendererCache } = await import("../../src/build/transforms/mdx/index.ts");
        clearMDXRendererCache();
      } catch {
        // May fail if module not loaded yet, which is fine
      }

      return await fn(context);
    });
  } finally {
    // Full cleanup after test
    await resetAllTestState();
    await context.cleanup();
  }
}

/**
 * Run a function with isolated environment variables.
 * Useful for simple tests that only need env isolation without full TestContext.
 *
 * @param envOverrides - Environment variables to set (undefined to delete)
 * @param fn - Function to execute with isolated env
 */
export async function withIsolatedEnv<T>(
  envOverrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();

  // Save and apply overrides
  for (const key of Object.keys(envOverrides)) {
    saved.set(key, getEnv(key));
    const value = envOverrides[key];
    if (value === undefined) {
      deleteEnv(key);
    } else {
      setEnv(key, value);
    }
  }

  // Reset all test state to pick up new env values
  await resetAllTestState();

  try {
    return await fn();
  } finally {
    // Restore original env values
    for (const [key, value] of saved) {
      if (value === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, value);
      }
    }
    // Reset state again to clear any cached values from test
    await resetAllTestState();
  }
}
