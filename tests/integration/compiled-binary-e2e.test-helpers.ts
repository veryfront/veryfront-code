import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import {
  captureBrowserDiagnostics,
  findHydrationOrCspFailures,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../_helpers/playwright.ts";
import { withoutHostBinaryInfraEnv, withProxyModeControlPlaneKey } from "../_helpers/proxy-mode.ts";

export const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") ?? `/tmp/veryfront-e2e-bin-${Deno.pid}`;
export const BINARY_HASH_PATH = `${BINARY_PATH}.srcHash`;

export function stripReactSSRMarkers(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

export function getDirectiveSources(csp: string, directiveName: string): string[] {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directiveName} `));

  if (!directive) return [];
  return directive.split(/\s+/).slice(1);
}

/** Get an available port using OS-assigned port 0. */
async function getAvailablePort(): Promise<number> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

async function computeSourceHash(): Promise<string> {
  const decoder = new TextDecoder();

  // Hash src/, cli/, scripts/build/, and extensions/ since they are all
  // build inputs reachable from the binary entrypoint.
  try {
    const trees = ["HEAD:src", "HEAD:cli", "HEAD:scripts/build", "HEAD:extensions"];
    const results = await Promise.all(
      trees.map((ref) =>
        new Deno.Command("git", {
          args: ["rev-parse", ref],
          stdout: "piped",
          stderr: "null",
        }).output()
      ),
    );

    if (results.every((r) => r.success)) {
      return results.map((r) => decoder.decode(r.stdout).trim()).join("-");
    }
  } catch {
    // fall through
  }

  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    }).output();

    if (result.success) return decoder.decode(result.stdout).trim();
  } catch {
    // fall through
  }

  return Date.now().toString();
}

export interface TestServer {
  process: Deno.ChildProcess;
  port: number;
  logs: string[];
  kill: () => Promise<void>;
}

type BrowserDiagnostics = ReturnType<typeof captureBrowserDiagnostics>;

export interface BrowserPageSession {
  page: import("npm:playwright").Page;
  response: import("npm:playwright").Response | null;
  diagnostics: BrowserDiagnostics;
}

export async function ensureBinaryCompiled(): Promise<void> {
  const forceFresh = Deno.env.get("VERYFRONT_BINARY_FRESH") === "1";
  const binaryExists = await exists(BINARY_PATH);
  const currentHash = await computeSourceHash();

  if (binaryExists && !forceFresh) {
    try {
      const storedHash = await Deno.readTextFile(BINARY_HASH_PATH);
      if (storedHash.trim() === currentHash) {
        console.log("✅ Using existing binary (source unchanged):", BINARY_PATH);
        return;
      }
      console.log("🔄 Source code changed, recompiling...");
    } catch {
      console.log("🔄 No source hash found, recompiling...");
    }
  }

  if (forceFresh) console.log("🗑️  Force fresh build (VERYFRONT_BINARY_FRESH=1)");
  if (binaryExists) await Deno.remove(BINARY_PATH);

  // Run the same pre-build pipeline used by distribution builds
  console.log("📦 Preparing build artifacts...");
  const prepareResult = await new Deno.Command("deno", {
    args: ["task", "build:prepare"],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!prepareResult.success) throw new Error("Failed to prepare framework sources");

  console.log("📦 Compiling binary...");
  const result = await new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "scripts/build/compile-binary.ts",
      "--output",
      BINARY_PATH,
    ],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!result.success) throw new Error("Failed to compile binary");

  await Deno.writeTextFile(BINARY_HASH_PATH, currentHash);
  console.log("✅ Binary compiled");
}

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
      // closed
    }
  })();
}

async function waitForServer(port: number, deadlineMs = 60_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/`);
      // Consume the response body to avoid connection issues
      await resp.text();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Server failed to start on port ${port}`);
}

async function startBinaryServer(
  projectDir: string,
  nodeEnv = "development",
  extraEnv?: Record<string, string>,
): Promise<TestServer> {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const logs: string[] = [];
    const port = await getAvailablePort();
    const cacheDir = await Deno.makeTempDir({
      prefix: nodeEnv === "production" ? "vf-cache-prod-" : "vf-cache-",
    });

    const process = new Deno.Command(BINARY_PATH, {
      args: ["serve", "--mode=production", "-p", String(port)],
      cwd: projectDir,
      env: withProxyModeControlPlaneKey({
        ...withoutHostBinaryInfraEnv(Deno.env.toObject()),
        NODE_ENV: nodeEnv,
        LOG_FORMAT: "text",
        VERYFRONT_CACHE_DIR: cacheDir,
        ...extraEnv,
      }),
      stdout: "piped",
      stderr: "piped",
    }).spawn();

    collectLogs(logs, process.stdout);
    collectLogs(logs, process.stderr);

    try {
      await waitForServer(port);
    } catch {
      try {
        process.kill();
        await process.status;
      } catch {
        // already dead
      }

      // Retry on port collision
      const logOutput = logs.join("\n");
      if (attempt < maxRetries - 1 && logOutput.includes("already in use")) {
        try {
          await Deno.remove(cacheDir, { recursive: true });
        } catch { /* ignore */ }
        continue;
      }

      throw new Error(
        `Server failed to start on port ${port} within 60s. Logs:\n${logOutput.slice(-3000)}`,
      );
    }

    // Give the server a moment to stabilize after first request
    await new Promise((r) => setTimeout(r, 500));

    return {
      process,
      port,
      logs,
      kill: async () => {
        try {
          process.kill();
          await process.status;
        } catch {
          // already dead
        }
        await new Promise((r) => setTimeout(r, 500)); // Port release time (increased for CI)
        try {
          await Deno.remove(cacheDir, { recursive: true });
        } catch {
          // ignore
        }
      },
    };
  }

  throw new Error("Failed to start server after all retries");
}

export async function createTestProject(
  name: string,
  pageContent: string,
  additionalFiles?: Record<string, string>,
): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: `vf-e2e-${name}-` });

  await Deno.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: `test-${name}`,
        type: "module",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      null,
      2,
    ),
  );

  await Deno.writeTextFile(
    join(projectDir, "veryfront.config.ts"),
    `export default { fs: { type: "local" } };`,
  );

  await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
  await Deno.writeTextFile(join(projectDir, "pages", "index.tsx"), pageContent);

  if (additionalFiles) {
    for (const [filePath, content] of Object.entries(additionalFiles)) {
      const fullPath = join(projectDir, filePath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(fullPath, content);
    }
  }

  return projectDir;
}

export async function withServer(
  projectDir: string,
  fn: (server: TestServer) => Promise<void>,
  nodeEnv?: string,
  extraEnv?: Record<string, string>,
): Promise<void> {
  const server = await startBinaryServer(projectDir, nodeEnv, extraEnv);
  try {
    await fn(server);
  } finally {
    await server.kill();
    await Deno.remove(projectDir, { recursive: true });
  }
}

export async function fetchOkHtml(server: TestServer, path = "/"): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
  const html = await response.text();

  assertEquals(response.status, 200, "Should return 200");
  return html;
}

export function assertHtmlDoesNotInclude(html: string, snippets: string[], message: string): void {
  for (const snippet of snippets) {
    assert(!html.includes(snippet), message);
  }
}

export async function withBrowserPageAgainstServer(
  server: TestServer,
  run: (session: BrowserPageSession) => Promise<void>,
): Promise<void> {
  const browser = await launchChromium();
  if (!browser) return;

  try {
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();
    const diagnostics = captureBrowserDiagnostics(page);

    try {
      const response = await page.goto(`http://127.0.0.1:${server.port}/`);
      assertEquals(response?.status(), 200, "Should return 200");
      await run({ page, response, diagnostics });
    } finally {
      await browserContext.close();
    }
  } finally {
    await browser.close();
  }
}

export function assertNoBrowserHydrationErrors(
  diagnostics: BrowserDiagnostics,
  label = "Unexpected hydration/CSP errors",
): void {
  const hydrationErrors = findHydrationOrCspFailures(
    getBrowserDiagnosticMessages(diagnostics),
  );
  assertEquals(hydrationErrors.length, 0, `${label}: ${hydrationErrors.join("\n")}`);
}

export function assertNoServerLogErrors(
  server: TestServer,
  patterns: string[],
  label: string,
): void {
  const serverErrors = server.logs.filter((line) =>
    patterns.some((pattern) => line.includes(pattern))
  );
  assertEquals(serverErrors.length, 0, `${label}: ${serverErrors.join("\n")}`);
}

export async function assertCounterHydration(
  page: import("npm:playwright").Page,
  options: {
    expectedStrategy?: string;
    expectedPagePath?: string;
    expectedModulePath?: string;
    assertBeforeClick?: () => Promise<void>;
    assertAfterClick?: () => Promise<void>;
  } = {},
): Promise<void> {
  await page.waitForSelector('#counter[data-hydrated="yes"]');

  const initialText = await page.textContent("#counter");
  assertEquals(initialText?.trim(), "Count: 0");

  if (options.expectedStrategy || options.expectedPagePath) {
    const hydrationData = JSON.parse(
      (await page.textContent("#veryfront-hydration-data")) ?? "{}",
    ) as { clientModuleStrategy?: string; pagePath?: string };

    if (options.expectedStrategy) {
      assertEquals(hydrationData.clientModuleStrategy, options.expectedStrategy);
    }

    if (options.expectedPagePath) {
      assertEquals(hydrationData.pagePath, options.expectedPagePath);
    }
  }

  await options.assertBeforeClick?.();

  await page.click("#counter");
  await page.waitForFunction(
    () => document.querySelector("#counter")?.textContent?.trim() === "Count: 1",
  );

  const hydratedText = await page.textContent("#counter");
  assertEquals(hydratedText?.trim(), "Count: 1");

  await options.assertAfterClick?.();

  if (options.expectedModulePath) {
    const resources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name)
    );
    assertEquals(resources.some((name) => name.includes(options.expectedModulePath!)), true);
  }
}
