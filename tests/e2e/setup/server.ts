import { type ChildProcess, spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");

let serverProcess: ChildProcess | null = null;

async function waitForReady(url: string, timeout = 30_000): Promise<void> {
  const start = Date.now();
  const pollInterval = 500;

  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(url, { signal: controller.signal });

      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`Server ready at ${url}`);
        return;
      }
    } catch {
      // Server not ready yet, continue polling
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Server not ready after ${timeout}ms`);
}

export async function startServer(): Promise<void> {
  if (serverProcess) {
    console.log("Server already running");
    return;
  }

  console.log("Starting Veryfront dev server...");

  serverProcess = spawn("deno", ["task", "start"], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
  });

  serverProcess.stdout?.on("data", (data) => {
    if (!process.env.DEBUG) return;
    console.log("[server]", data.toString());
  });

  serverProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    if (!process.env.DEBUG && !output.toLowerCase().includes("error")) return;
    console.error("[server error]", output);
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

  await waitForReady("http://lvh.me:8080", 60_000);
}

export async function stopServer(): Promise<void> {
  if (!serverProcess) {
    console.log("No server to stop");
    return;
  }

  console.log("Stopping server...");

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("Server did not stop gracefully, killing...");
      serverProcess?.kill("SIGKILL");
      serverProcess = null;
      resolve();
    }, 5000);

    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      serverProcess = null;
      console.log("Server stopped");
      resolve();
    });

    serverProcess.kill("SIGTERM");
  });
}

export function isServerRunning(): boolean {
  return serverProcess !== null;
}
