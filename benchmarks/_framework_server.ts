import { type ChildProcess, spawn } from "node:child_process";
import { join } from "#std/path";
import { BENCHMARKS_ROOT } from "./_shared_contract.ts";
import {
  startServer as startVeryfrontServer,
  stopServer as stopVeryfrontServer,
} from "../tests/e2e/setup/server.ts";

export type BenchmarkFramework = "veryfront" | "nextjs";

export interface StartedBenchmarkServer {
  framework: BenchmarkFramework;
  stop(): Promise<void>;
}

const NEXTJS_APP_DIR = join(BENCHMARKS_ROOT, "apps", "nextjs");
const NEXTJS_PORT = 8080;
let nextProcess: ChildProcess | null = null;

export async function startBenchmarkServer(options: {
  framework: BenchmarkFramework;
  projectSlug: string;
  environment: "preview" | "production";
  enableProfiling?: boolean;
}): Promise<StartedBenchmarkServer> {
  if (options.framework === "veryfront") {
    const previousProfiling = Deno.env.get("VERYFRONT_ENABLE_PERF_PROFILING");
    if (options.enableProfiling) {
      Deno.env.set("VERYFRONT_ENABLE_PERF_PROFILING", "1");
    } else {
      Deno.env.delete("VERYFRONT_ENABLE_PERF_PROFILING");
    }
    await startVeryfrontServer({
      projectSlugs: [options.projectSlug],
      mode: "production",
      environment: options.environment,
    });
    return {
      framework: "veryfront",
      stop: async () => {
        await stopVeryfrontServer();
        if (previousProfiling == null) {
          Deno.env.delete("VERYFRONT_ENABLE_PERF_PROFILING");
        } else {
          Deno.env.set("VERYFRONT_ENABLE_PERF_PROFILING", previousProfiling);
        }
      },
    };
  }

  await startNextjsServer();
  return {
    framework: "nextjs",
    stop: () => stopNextjsServer(),
  };
}

export async function waitForReady(url: string, timeout = 60_000): Promise<void> {
  const start = Date.now();
  const pollInterval = 500;

  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`Server ready at ${url}`);
        return;
      }
    } catch {
      // server not ready yet
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Server not ready after ${timeout}ms`);
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  label: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NODE_ENV: "production", PORT: String(NEXTJS_PORT) },
    });

    child.stdout?.on("data", (data) => {
      if (!process.env.DEBUG) return;
      console.log(`[${label}]`, data.toString());
    });

    child.stderr?.on("data", (data) => {
      const output = data.toString();
      if (!process.env.DEBUG && !/\b(error|failed|warn)\b/i.test(output)) return;
      console.error(`[${label}]`, output);
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function ensureNextjsDependencies(): Promise<void> {
  try {
    await Deno.stat(join(NEXTJS_APP_DIR, "node_modules", "next", "package.json"));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    console.log("Installing Next.js benchmark app dependencies...");
    await runCommand("npm", ["install"], NEXTJS_APP_DIR, "nextjs-install");
  }
}

async function buildNextjsApp(): Promise<void> {
  console.log("Building Next.js benchmark app...");
  await runCommand("npm", ["run", "build"], NEXTJS_APP_DIR, "nextjs-build");
}

async function startNextjsServer(): Promise<void> {
  if (nextProcess) {
    console.log("Next.js benchmark server already running");
    return;
  }

  await ensureNextjsDependencies();
  await buildNextjsApp();

  console.log("Starting Next.js benchmark server...");

  nextProcess = spawn(
    "npm",
    ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(NEXTJS_PORT)],
    {
      cwd: NEXTJS_APP_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NODE_ENV: "production", PORT: String(NEXTJS_PORT) },
    },
  );

  nextProcess.stdout?.on("data", (data) => {
    if (!process.env.DEBUG) return;
    console.log("[nextjs-server]", data.toString());
  });

  nextProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    if (!process.env.DEBUG && !/\b(error|failed|warn)\b/i.test(output)) return;
    console.error("[nextjs-server]", output);
  });

  nextProcess.once("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`Next.js benchmark server exited with code ${code}`);
    }
    nextProcess = null;
  });

  try {
    await waitForReady(`http://127.0.0.1:${NEXTJS_PORT}/bench/static`, 60_000);
  } catch (error) {
    await stopNextjsServer();
    throw error;
  }
}

async function stopNextjsServer(): Promise<void> {
  if (!nextProcess) {
    console.log("No Next.js benchmark server to stop");
    return;
  }

  console.log("Stopping Next.js benchmark server...");
  const processToStop = nextProcess;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      processToStop.kill("SIGKILL");
      nextProcess = null;
      resolve();
    }, 5_000);

    processToStop.once("exit", () => {
      clearTimeout(timeout);
      nextProcess = null;
      resolve();
    });

    processToStop.kill("SIGTERM");
  });
}
