import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProjectsToProvision } from "../helpers/projects.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const PLAYWRIGHT_STATE_PATH = join(PROJECT_ROOT, ".playwright-e2e-state.json");

let serverProcess: ChildProcess | null = null;
let workspaceRoot: string | null = null;
let readinessUrl = "http://blank.lvh.me:8080/";

async function writeProjectFile(
  projectDir: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const filePath = join(projectDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

function buildSmokeProjectSource(projectSlug: string): Record<string, string> {
  return {
    "package.json": JSON.stringify(
      {
        name: `playwright-smoke-${projectSlug}`,
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      null,
      2,
    ),
    "veryfront.config.ts": `export default { fs: { type: "local" } };\n`,
    "pages/index.tsx": `"use client";
import { Head } from "veryfront/head";
import { useState } from "react";

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <>
      <Head><title>${projectSlug} smoke project</title></Head>
      <main id="content">
        <h1 id="project-name">${projectSlug}</h1>
        <p id="mode-probe">Smoke coverage for ${projectSlug}</p>
        <button id="counter" type="button" onClick={() => setCount((value) => value + 1)}>
          Count: {count}
        </button>
        <a id="about-link" href="/about">About</a>
      </main>
    </>
  );
}
`,
    "pages/about.tsx": `import { Head } from "veryfront/head";

export default function About() {
  return (
    <>
      <Head><title>${projectSlug} about</title></Head>
      <main id="about-page">About ${projectSlug}</main>
    </>
  );
}
`,
    "pages/404.tsx": `export default function NotFound() {
  return <main id="not-found-page">Custom Not Found for ${projectSlug}</main>;
}
`,
    "pages/api/status.ts": `export function GET() {
  return Response.json({ ok: true, project: "${projectSlug}" });
}
`,
  };
}

async function createPlaywrightWorkspace(projectSlugs: string[]): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "vf-playwright-"));
  const projectsDir = join(rootDir, "projects");

  await mkdir(projectsDir, { recursive: true });

  for (const projectSlug of projectSlugs) {
    const projectDir = join(projectsDir, projectSlug);
    const files = buildSmokeProjectSource(projectSlug);

    await mkdir(projectDir, { recursive: true });

    for (const [relativePath, contents] of Object.entries(files)) {
      await writeProjectFile(projectDir, relativePath, contents);
    }
  }

  return rootDir;
}

async function persistWorkspaceState(projectRoot: string): Promise<void> {
  await writeFile(
    PLAYWRIGHT_STATE_PATH,
    JSON.stringify({ workspaceRoot: projectRoot, readinessUrl }, null, 2),
  );
}

async function cleanupWorkspace(): Promise<void> {
  let rootDir = workspaceRoot;
  workspaceRoot = null;

  if (!rootDir) {
    try {
      const persistedState = JSON.parse(await readFile(PLAYWRIGHT_STATE_PATH, "utf8")) as {
        workspaceRoot?: string;
      };
      rootDir = persistedState.workspaceRoot ?? null;
    } catch {
      // ignore state read failures
    }
  }

  try {
    await rm(PLAYWRIGHT_STATE_PATH, { force: true });
  } catch {
    // ignore state cleanup failures
  }

  if (!rootDir) return;

  try {
    await rm(rootDir, { recursive: true, force: true });
  } catch {
    // ignore workspace cleanup failures
  }
}

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

  const projectSlugs = getProjectsToProvision();
  workspaceRoot = await createPlaywrightWorkspace(projectSlugs);
  readinessUrl = `http://${projectSlugs[0]}.lvh.me:8080/`;
  await persistWorkspaceState(workspaceRoot);

  console.log("Starting Veryfront dev server...");

  serverProcess = spawn(
    "deno",
    [
      "run",
      "--config",
      join(PROJECT_ROOT, "deno.json"),
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "--allow-env",
      "--allow-run",
      "--allow-sys",
      "--unstable-worker-options",
      "--unstable-net",
      join(PROJECT_ROOT, "cli", "main.ts"),
      "dev",
      "--project",
      workspaceRoot,
      "--port",
      "8080",
    ],
    {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "development", CI: "1" },
    },
  );

  serverProcess.stdout?.on("data", (data) => {
    if (!process.env.DEBUG) return;
    console.log("[server]", data.toString());
  });

  serverProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    const looksLikeRealError = /\b(error|fatal|uncaught|exception)\b/i.test(output) &&
      !output.includes("errors=0");
    if (!process.env.DEBUG && !looksLikeRealError) return;
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

  try {
    await waitForReady(readinessUrl, 60_000);
  } catch (error) {
    await cleanupWorkspace();
    throw error;
  }
}

export async function stopServer(): Promise<void> {
  if (!serverProcess) {
    console.log("No server to stop");
    await cleanupWorkspace();
    return;
  }

  console.log("Stopping server...");

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn("Server did not stop gracefully, killing...");
      serverProcess?.kill("SIGKILL");
      serverProcess = null;
      void cleanupWorkspace().finally(resolve);
    }, 5000);

    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      serverProcess = null;
      console.log("Server stopped");
      void cleanupWorkspace().finally(resolve);
    });

    serverProcess.kill("SIGTERM");
  });
}

export function isServerRunning(): boolean {
  return serverProcess !== null;
}
