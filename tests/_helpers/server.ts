import { join } from "std/path/mod.ts";
import { createDevServer } from "../../src/server/dev-server.ts";
import { startProductionServer } from "../../src/server/production-server.ts";
import { resetApiHandler } from "../../src/server/handlers/request/api/index.ts";
import { getFreePort } from "./utils.ts";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      resolve(undefined);
    }, ms);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeout: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timeout after ${timeout}ms`));
      }, timeout);
    });
    return await Promise.race([promise, timeoutPromise]) as T;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function closeResponse(res: Response | undefined | null) {
  if (!res) return;
  try {
    await res.body?.cancel?.();
  } catch (_err) {
    // ignore cancellation errors in tests
  }
  try {
    // fallback read in case cancel is a no-op
    await res.arrayBuffer();
  } catch (_err) {
    // body may already be consumed
  }
}

export interface TestServer {
  ready: Promise<void>;
  stop: () => Promise<void>;
  port?: number;
  hostname?: string;
  addr?: { hostname: string; port: number };
  getFileWatcherMetrics?: () => {
    totalFileChangeEvents: number;
    routeDiscoveryCalls: number;
    averageBatchSize: string;
    largestBatch: number;
    fsOperationReduction: string;
  } | null;
}

/**
 * Wait for a server to be ready by checking if it responds to requests
 */
export async function waitForServerReady(
  server: TestServer,
  options: { timeout?: number; checkPath?: string; retryDelay?: number } = {},
): Promise<void> {
  const { timeout = 10000, checkPath = "/", retryDelay = 50 } = options;
  const port = server.port || server.addr?.port || 3000;
  const hostname = server.hostname || server.addr?.hostname || "localhost";
  const url = `http://${hostname}:${port}${checkPath}`;

  // If server has a ready promise, wait for it first
  if (server.ready && typeof server.ready.then === "function") {
    await withTimeout(server.ready, timeout, "Server ready");
  }

  // Then verify the server is actually responding
  const startTime = Date.now();
  let lastError: Error | null = null;
  let attempts = 0;

  while (Date.now() - startTime < timeout) {
    attempts++;
    try {
      const response = await fetchWithTimeout(url, 2000);
      try {
        // For pages (checkPath="/"), require successful response (200-399)
        // For other endpoints, any response means server is ready
        const isPageRequest = checkPath === "/";
        const minAcceptableStatus = isPageRequest ? 200 : 200;
        const maxAcceptableStatus = isPageRequest ? 400 : 600;

        if (response.status >= minAcceptableStatus && response.status < maxAcceptableStatus) {
          // Make one more request to ensure stability
          const verifyResponse = await fetchWithTimeout(url, 2000);
          try {
            if (verifyResponse.status >= minAcceptableStatus && verifyResponse.status < maxAcceptableStatus) {
              return;
            }
          } finally {
            await closeResponse(verifyResponse);
          }
        }
      } finally {
        await closeResponse(response);
      }
    } catch (error) {
      lastError = error as Error;
      // Only wait if we haven't exceeded timeout
      if (Date.now() - startTime < timeout) {
        await sleep(retryDelay);
      }
    }
  }

  throw new Error(
    `Server not ready after ${timeout}ms (${attempts} attempts). Last error: ${lastError?.message}`,
  );
}

/**
 * Wait for a server to stop responding
 */
export async function waitForServerStopped(
  server: TestServer,
  options: { timeout?: number; checkPath?: string } = {},
): Promise<void> {
  const { timeout = 5000, checkPath = "/" } = options;
  const port = server.port || server.addr?.port || 3000;
  const hostname = server.hostname || server.addr?.hostname || "localhost";
  const url = `http://${hostname}:${port}${checkPath}`;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetchWithTimeout(url, 100);
      try {
        // If fetch succeeds, server is still running
        await sleep(50);
      } finally {
        await closeResponse(res);
      }
    } catch {
      // Fetch failed, server is stopped
      return;
    }
  }

  throw new Error(`Server still running after ${timeout}ms`);
}

/**
 * Run a test with a server, ensuring proper setup and cleanup
 */
export async function withTestServer<T extends TestServer>(
  createServer: () => Promise<T>,
  testFn: (server: T) => Promise<void>,
): Promise<void> {
  let server: T | null = null;

  try {
    server = await createServer();
    await waitForServerReady(server);
    await testFn(server);
  } finally {
    if (server?.stop) {
      try {
        await server.stop();
        await waitForServerStopped(server);
      } catch (error) {
        console.error("[test-helper] Failed to stop server:", error);
      }
    }

    try {
      await resetApiHandler();
    } catch (error) {
      console.debug?.("[test-helper] Failed to reset API handler", error);
    }
  }
}

/**
 * Create a dev server with proper lifecycle management
 */
export async function createTestDevServer(options: {
  projectDir: string;
  port?: number;
  hostname?: string;
  enableHMR?: boolean;
  fileWatcherDebounceMs?: number;
}): Promise<TestServer> {
  const port = options.port ?? getFreePort(9000, 12000);
  const server = await createDevServer({
    projectDir: options.projectDir,
    port,
    enableHMR: options.enableHMR ?? false,
    fileWatcherDebounceMs: options.fileWatcherDebounceMs,
  });

  // Add port and hostname to the server object for consistency
  const testServer = server as TestServer;
  testServer.port = port;
  testServer.hostname = options.hostname || "localhost";

  return testServer;
}

/**
 * Assert response status with better error message
 */
export function assertResponseOk(response: Response, message?: string): void {
  if (!response.ok) {
    throw new Error(
      message || `Expected OK response but got ${response.status} ${response.statusText}`,
    );
  }
}

/**
 * Assert response status is in expected range
 */
export function assertResponseStatus(
  response: Response,
  expectedStatus: number | number[],
  message?: string,
): void {
  const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];

  if (!statuses.includes(response.status)) {
    throw new Error(
      message || `Expected status ${statuses.join(" or ")} but got ${response.status}`,
    );
  }
}

/**
 * Clean up test directory with error handling
 */
export async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Already removed, ignore
      return;
    }
    console.debug?.(`[test-helper] Failed to remove test dir ${dir}:`, error);
  }
}

/**
 * Create a test project directory with standard structure
 */
export async function createTestProjectDir(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "veryfront_test_" });

  // Create standard directories
  await Deno.mkdir(join(dir, "pages"), { recursive: true });
  await Deno.mkdir(join(dir, "components"), { recursive: true });
  await Deno.mkdir(join(dir, "public"), { recursive: true });

  return dir;
}

/**
 * Create a production server with proper lifecycle management
 */
export async function createTestProductionServer(options: {
  projectDir: string;
  port?: number;
  hostname?: string;
}): Promise<TestServer> {
  const port = options.port ?? getFreePort(9000, 12000);
  const server = await startProductionServer({
    projectDir: options.projectDir,
    port,
    hostname: options.hostname || "127.0.0.1",
  });

  // Add port and hostname to the server object for test consistency
  const testServer = server as TestServer;
  testServer.port = port;
  testServer.hostname = options.hostname || "127.0.0.1";

  return testServer;
}
