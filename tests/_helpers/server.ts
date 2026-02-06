import { join } from "#veryfront/compat/path";
import { isNotFoundError, makeTempDir, mkdir, remove } from "../../src/platform/compat/fs.ts";
import { startDevServer } from "../../src/server/dev-server.ts";
import { startProductionServer } from "../../src/server/production-server.ts";
import { resetApiHandler } from "../../src/server/handlers/request/api/index.ts";
import { testDelay } from "#veryfront/testing";
import { CLEANUP_CONFIG, SERVER_CONFIG, TEST_TIMEOUTS } from "./constants.ts";
import {
  getHttpServerUrl,
  pollHttpReadyByTimeout,
  pollHttpStoppedByTimeout,
  waitForHttpServerReadySignal,
} from "./http-polling.ts";
import { getFreePort } from "./utils.ts";

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
  const {
    timeout = TEST_TIMEOUTS.SERVER_STARTUP,
    checkPath = "/",
    retryDelay = CLEANUP_CONFIG.CLEANUP_RETRY_DELAY,
  } = options;
  const url = getHttpServerUrl(server, {
    checkPath,
    defaultPort: 3000,
    defaultHostname: "localhost",
  });

  await waitForHttpServerReadySignal(server, {
    timeoutMs: timeout,
    timeoutMessage: `Server ready timeout after ${timeout}ms`,
  });

  const result = await pollHttpReadyByTimeout(url, {
    timeoutMs: timeout,
    retryDelayMs: retryDelay,
    requestTimeoutMs: SERVER_CONFIG.FETCH_TIMEOUT,
    delay: testDelay,
  });

  if (result.ready) return;

  throw new Error(
    `Server not ready after ${timeout}ms (${result.attempts} attempts). Last error: ${result.lastError?.message}`,
  );
}

/**
 * Wait for a server to stop responding
 */
export async function waitForServerStopped(
  server: TestServer,
  options: { timeout?: number; checkPath?: string } = {},
): Promise<void> {
  const { timeout = CLEANUP_CONFIG.GRACEFUL_TIMEOUT, checkPath = "/" } = options;
  const url = getHttpServerUrl(server, {
    checkPath,
    defaultPort: 3000,
    defaultHostname: "localhost",
  });

  const stopped = await pollHttpStoppedByTimeout(url, {
    timeoutMs: timeout,
    retryDelayMs: CLEANUP_CONFIG.CLEANUP_RETRY_DELAY,
    requestTimeoutMs: 100,
    delay: testDelay,
  });

  if (stopped) return;

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
  const port = options.port ?? (await getFreePort());
  const server = await startDevServer({
    projectDir: options.projectDir,
    port,
    enableHMR: options.enableHMR ?? false,
    fileWatcherDebounceMs: options.fileWatcherDebounceMs,
  });

  return {
    ready: server.ready,
    stop: () => server.stop(),
    port,
    hostname: options.hostname ?? "localhost",
  };
}

/**
 * Assert response status with better error message
 */
export function assertResponseOk(response: Response, message?: string): void {
  if (response.ok) return;
  throw new Error(
    message ?? `Expected OK response but got ${response.status} ${response.statusText}`,
  );
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
  if (statuses.includes(response.status)) return;

  throw new Error(message ?? `Expected status ${statuses.join(" or ")} but got ${response.status}`);
}

/**
 * Clean up test directory with error handling
 */
export async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await remove(dir, { recursive: true });
  } catch (error) {
    if (isNotFoundError(error)) return;
    console.debug?.(`[test-helper] Failed to remove test dir ${dir}:`, error);
  }
}

/**
 * Create a test project directory with standard structure
 */
export async function createTestProjectDir(): Promise<string> {
  const dir = await makeTempDir({ prefix: "veryfront_test_" });

  await Promise.all([
    mkdir(join(dir, "pages"), { recursive: true }),
    mkdir(join(dir, "components"), { recursive: true }),
    mkdir(join(dir, "public"), { recursive: true }),
  ]);

  return dir;
}

/**
 * Create a production server with proper lifecycle management
 */
export async function createTestProductionServer(options: {
  projectDir: string;
  port?: number;
  hostname?: string;
  projectId?: string;
}): Promise<TestServer> {
  const port = options.port ?? (await getFreePort());
  const hostname = options.hostname ?? "127.0.0.1";
  const server = await startProductionServer({
    projectDir: options.projectDir,
    port,
    bindAddress: hostname,
    defaultProjectSlug: options.projectId,
    defaultProjectId: options.projectId,
  });

  return {
    ...server,
    port,
    hostname,
  };
}
