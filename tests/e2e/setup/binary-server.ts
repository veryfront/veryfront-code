/**
 * Compiled Binary E2E Test Server Management
 *
 * Handles compiled binary server lifecycle:
 * - Starting servers with isolated cache directories
 * - Port allocation for parallel test execution
 * - Log collection and error detection
 * - Graceful shutdown and cleanup
 */

import { BINARY_PATH, ensureBinaryCompiled } from "./binary.ts";

export { BINARY_PATH, ensureBinaryCompiled };

/** Track ports in use within this process to avoid collisions. */
const usedPorts = new Set<number>();

/**
 * Get a random available port in the 30000-60000 range.
 * Checks both local tracking and actual port availability.
 */
async function getAvailablePort(): Promise<number> {
  const minPort = 30000;
  const maxPort = 60000;
  const maxAttempts = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = Math.floor(Math.random() * (maxPort - minPort)) + minPort;

    if (usedPorts.has(port)) continue;

    // Check if port is actually available
    try {
      const listener = Deno.listen({ port });
      listener.close();
      usedPorts.add(port);
      return port;
    } catch {
      // Port in use, try another
    }
  }

  throw new Error("Could not find available port after 50 attempts");
}

export interface TestServer {
  process: Deno.ChildProcess;
  port: number;
  logs: string[];
  cacheDir: string;
  projectDir: string;
  kill: () => Promise<void>;
  getLogs: () => string;
  getErrors: () => string[];
  hasErrors: () => boolean;
}

export interface ServerOptions {
  nodeEnv?: "development" | "production";
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Collect log output from a readable stream into an array.
 */
function collectLogs(logs: string[], stream: ReadableStream<Uint8Array>): void {
  (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        logs.push(decoder.decode(value));
      }
    } catch {
      // Stream closed
    }
  })();
}

/**
 * Wait for a server to be ready by polling the root endpoint.
 */
async function waitForServer(port: number, deadlineMs = 30_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Server failed to start on port ${port}`);
}

/**
 * Start a test server from the compiled binary.
 *
 * @param projectDir - Path to the test project
 * @param options - Server configuration options
 */
export async function startServer(
  projectDir: string,
  options: ServerOptions = {},
): Promise<TestServer> {
  const { nodeEnv = "development", timeout = 30_000, env = {} } = options;
  const logs: string[] = [];
  const port = await getAvailablePort();
  const cacheDir = await Deno.makeTempDir({
    prefix: nodeEnv === "production" ? "vf-cache-prod-" : "vf-cache-",
  });

  const process = new Deno.Command(BINARY_PATH, {
    args: ["dev", "-p", String(port), "--project", projectDir],
    env: {
      ...Deno.env.toObject(),
      NODE_ENV: nodeEnv,
      LOG_FORMAT: "text",
      VERYFRONT_CACHE_DIR: cacheDir,
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  collectLogs(logs, process.stdout);
  collectLogs(logs, process.stderr);

  try {
    await waitForServer(port, timeout);
  } catch {
    try {
      process.kill();
    } catch {
      // Already dead
    }
    const logOutput = logs.join("\n").slice(-2000);
    throw new Error(`Server failed to start on port ${port}. Logs:\n${logOutput}`);
  }

  const server: TestServer = {
    process,
    port,
    logs,
    cacheDir,
    projectDir,
    getLogs: () => logs.join("\n"),
    getErrors: () =>
      logs.filter(
        (l) =>
          l.includes("FATAL") ||
          l.includes("Unhandled") ||
          l.includes("Invalid hook call") ||
          l.includes("more than one copy of React") ||
          l.includes("esm.sh/_vf_modules") ||
          l.includes("Module not found") ||
          l.includes("Missing module"),
      ),
    hasErrors: () => server.getErrors().length > 0,
    kill: async () => {
      try {
        process.kill();
        await process.status;
      } catch {
        // Already dead
      }
      usedPorts.delete(port);
      await new Promise((r) => setTimeout(r, 200));
      try {
        await Deno.remove(cacheDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };

  return server;
}

/**
 * Run a test function with a managed server lifecycle.
 *
 * Automatically starts the server, runs the test, and cleans up.
 *
 * @param projectDir - Path to the test project
 * @param fn - Test function to run with the server
 * @param options - Server configuration options
 */
export async function withServer(
  projectDir: string,
  fn: (server: TestServer) => Promise<void>,
  options?: ServerOptions,
): Promise<void> {
  const server = await startServer(projectDir, options);
  try {
    await fn(server);
  } finally {
    await server.kill();
    try {
      await Deno.remove(projectDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Fetch a page from the test server.
 */
export async function fetchPage(
  server: TestServer,
  path: string,
): Promise<{ response: Response; html: string }> {
  const url = `http://127.0.0.1:${server.port}${path}`;
  const response = await fetch(url);
  const html = await response.text();
  return { response, html };
}

/**
 * Fetch JSON from an API route.
 */
export async function fetchJson<T = unknown>(
  server: TestServer,
  path: string,
): Promise<{ response: Response; json: T }> {
  const url = `http://127.0.0.1:${server.port}${path}`;
  const response = await fetch(url);
  const json = (await response.json()) as T;
  return { response, json };
}
