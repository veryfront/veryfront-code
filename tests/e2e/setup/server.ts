/**
 * Server start/stop helpers for E2E tests
 *
 * Manages the Veryfront dev server lifecycle for testing.
 * Uses Deno subprocess to spawn the server and polls for readiness.
 */

import { spawn, ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

let serverProcess: ChildProcess | null = null;

/**
 * Wait for server to become ready by polling the health endpoint
 */
async function waitForReady(
  url: string,
  timeout: number = 30_000
): Promise<void> {
  const start = Date.now();
  const pollInterval = 500;

  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(url, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`Server ready at ${url}`);
        return;
      }
    } catch {
      // Server not ready yet, continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Server not ready after ${timeout}ms`);
}

/**
 * Start the Veryfront dev server
 */
export async function startServer(): Promise<void> {
  if (serverProcess) {
    console.log("Server already running");
    return;
  }

  console.log("Starting Veryfront dev server...");

  // Spawn deno task start
  serverProcess = spawn("deno", ["task", "start"], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Ensure consistent environment
      NODE_ENV: "development",
    },
  });

  // Log server output for debugging
  serverProcess.stdout?.on("data", (data) => {
    const output = data.toString();
    if (process.env.DEBUG) {
      console.log("[server]", output);
    }
  });

  serverProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    if (process.env.DEBUG || output.toLowerCase().includes("error")) {
      console.error("[server error]", output);
    }
  });

  serverProcess.on("error", (error) => {
    console.error("Server process error:", error);
  });

  serverProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Server exited with code ${code}`);
    }
    serverProcess = null;
  });

  // Wait for server to be ready
  await waitForReady("http://lvh.me:8080", 60_000);
}

/**
 * Stop the server gracefully
 */
export async function stopServer(): Promise<void> {
  if (!serverProcess) {
    console.log("No server to stop");
    return;
  }

  console.log("Stopping server...");

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("Server did not stop gracefully, killing...");
      serverProcess?.kill("SIGKILL");
      serverProcess = null;
      resolve();
    }, 5000);

    serverProcess!.once("exit", () => {
      clearTimeout(timeout);
      serverProcess = null;
      console.log("Server stopped");
      resolve();
    });

    serverProcess!.kill("SIGTERM");
  });
}

/**
 * Get server status
 */
export function isServerRunning(): boolean {
  return serverProcess !== null;
}
