import { join } from "#veryfront/compat/path";
import { isNotFoundError, makeTempDir, mkdir, remove } from "../../src/platform/compat/fs.ts";
import { startDevServer } from "../../src/server/dev-server.ts";
import { resetApiHandler } from "../../src/server/handlers/request/api/index.ts";
import { fetchWithPinnedAddresses } from "../../src/platform/compat/http/pinned-fetch.ts";
import { testDelay } from "#veryfront/testing";
import { CLEANUP_CONFIG, SERVER_CONFIG, TEST_TIMEOUTS } from "./constants.ts";
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

/** The URL a test server answers on, from whichever address fields it carries. */
function serverUrl(server: TestServer, checkPath: string): string {
  const port = server.port ?? server.addr?.port ?? 3000;
  const hostname = server.hostname ?? server.addr?.hostname ?? "localhost";
  return `http://${hostname}:${port}${checkPath}`;
}

/** Race `promise` against a timer, clearing the timer either way. */
export async function waitForPromiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A fetch that aborts instead of hanging when the server never answers. */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number = SERVER_CONFIG.FETCH_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Issue a GET over loopback with an explicit HTTP Host header.
 *
 * Deno fetch cannot override Host, but some Linux CI environments do not
 * resolve arbitrary `*.localhost` names. This keeps host-based routing under
 * test without depending on system DNS.
 */
export async function fetchViaLoopbackWithHost(options: {
  port: number;
  host: string;
  path: string;
  headers?: Record<string, string>;
}): Promise<Response> {
  return await fetchWithPinnedAddresses(
    new URL(`http://${options.host}${options.path}`),
    ["127.0.0.1"],
    { headers: options.headers },
  );
}

/** Release a probe response's body so the connection does not linger as a leak. */
async function closeResponse(res: Response): Promise<void> {
  try {
    await res.body?.cancel?.();
  } catch {
    // ignore cancellation errors in tests
  }
  try {
    // fallback read in case cancel is a no-op
    await res.arrayBuffer();
  } catch {
    // body may already be consumed
  }
}

/**
 * One readiness probe: any HTTP status counts as up, optionally confirmed by a
 * second request so a server that answered once mid-startup is not declared
 * ready.
 */
async function probeHttpReady(
  url: string,
  requestTimeoutMs: number,
  verifyWithSecondRequest: boolean,
): Promise<boolean> {
  const isUp = (status: number) => status >= 200 && status < 600;
  const response = await fetchWithTimeout(url, requestTimeoutMs);
  try {
    if (!isUp(response.status)) return false;
    if (!verifyWithSecondRequest) return true;
    const verify = await fetchWithTimeout(url, requestTimeoutMs);
    try {
      return isUp(verify.status);
    } finally {
      await closeResponse(verify);
    }
  } finally {
    await closeResponse(response);
  }
}

/** Outcome of polling a URL for readiness, for callers that build their own message. */
export interface UrlReadyResult {
  ready: boolean;
  attempts: number;
  lastError: Error | null;
}

/** Poll `url` until it answers HTTP or `timeoutMs` passes. Never throws. */
export async function pollUrlReady(
  url: string,
  options: {
    timeoutMs?: number;
    retryDelayMs?: number;
    requestTimeoutMs?: number;
    verifyWithSecondRequest?: boolean;
  } = {},
): Promise<UrlReadyResult> {
  const {
    timeoutMs = TEST_TIMEOUTS.SERVER_STARTUP,
    retryDelayMs = CLEANUP_CONFIG.CLEANUP_RETRY_DELAY,
    requestTimeoutMs = SERVER_CONFIG.FETCH_TIMEOUT,
    verifyWithSecondRequest = true,
  } = options;

  const startTime = Date.now();
  let attempts = 0;
  let lastError: Error | null = null;
  while (Date.now() - startTime < timeoutMs) {
    attempts++;
    try {
      if (await probeHttpReady(url, requestTimeoutMs, verifyWithSecondRequest)) {
        return { ready: true, attempts, lastError };
      }
    } catch (error) {
      lastError = error as Error;
      if (Date.now() - startTime < timeoutMs) await testDelay(retryDelayMs);
    }
  }
  return { ready: false, attempts, lastError };
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
  const url = serverUrl(server, checkPath);

  if (typeof server.ready?.then === "function") {
    await waitForPromiseWithTimeout(
      server.ready,
      timeout,
      `Server ready timeout after ${timeout}ms`,
    );
  }

  const result = await pollUrlReady(url, { timeoutMs: timeout, retryDelayMs: retryDelay });
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
  const url = serverUrl(server, checkPath);

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    let response: Response;
    try {
      response = await fetchWithTimeout(url, 100);
    } catch {
      return;
    }
    try {
      await testDelay(CLEANUP_CONFIG.CLEANUP_RETRY_DELAY);
    } finally {
      await closeResponse(response);
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
