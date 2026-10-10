import "../_helpers/contract-init.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import { tmpdir } from "node:os";
import {
  captureBrowserDiagnostics,
  findHydrationOrCspFailures,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../_helpers/playwright.ts";
import { withoutHostBinaryInfraEnv, withProxyModeControlPlaneKey } from "../_helpers/proxy-mode.ts";
import { computeSourceHash, E2E_BINARY_DIR } from "../e2e/setup/binary.ts";

export const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") ??
  join(E2E_BINARY_DIR, `veryfront-e2e-bin-${Deno.pid}`);
export const BINARY_HASH_PATH = `${BINARY_PATH}.srcHash`;
// `deno test --parallel` runs each file in its own isolate inside one process, so
// sibling files share Deno.pid and BINARY_PATH but not module state. A lock
// serializes them around the compile, and a record names the process instance
// that compiled the binary, so every later file of that process reuses it,
// whether the files run side by side or one after another. Isolates cannot tell
// which of them exits last, so the binary outlives the process and the next
// run removes binaries whose process has exited. The lock and records live in a
// private per-user temp directory rather than beside the binary, which
// VERYFRONT_BINARY may place in a read-only directory. The lock is never
// removed: unlinking a lock file while another isolate waits on it would let a
// third take a second lock.
const COORDINATION_DIR = join(
  tmpdir(),
  `veryfront-compiled-binary-e2e-${Deno.uid() ?? "user"}`,
);
const BINARY_LOCK_PATH = join(COORDINATION_DIR, "compile.lock");
const BINARY_RECORD_SUFFIX = ".binary.json";

/**
 * The e2e:binary suite runs this many shard files side by side. The hosted CI
 * runner has 4 vCPUs, and every test spawns a compiled server (and some a
 * Chromium page), so three shards leave headroom for those child processes.
 */
export const COMPILED_BINARY_E2E_SHARD_COUNT = 3;

/** Shared by every compiled-binary e2e suite: each test drives a spawned server. */
export const COMPILED_BINARY_E2E_OPTIONS = {
  sanitizeOps: false,
  sanitizeResources: false,
  timeout: 600_000,
};

let selectedShard: number | undefined;
let binaryTestCacheRoot: string | undefined;

/**
 * Select the 1-based shard this test file runs. Call it before importing
 * compiled-binary-e2e.suite.ts, whose `it` then registers only every
 * COMPILED_BINARY_E2E_SHARD_COUNT-th test, starting at this shard.
 */
export function selectCompiledBinaryE2EShard(shard: number): void {
  if (!Number.isInteger(shard) || shard < 1 || shard > COMPILED_BINARY_E2E_SHARD_COUNT) {
    throw new Error(`Shard must be 1..${COMPILED_BINARY_E2E_SHARD_COUNT}, got ${shard}`);
  }
  if (selectedShard !== undefined) throw new Error("A compiled-binary e2e shard is already set");
  selectedShard = shard - 1;
}

/**
 * Wrap `it` so a shard file registers its round-robin share of the tests, in
 * declaration order, and every test lands in exactly one shard. With no shard
 * selected, as when the test file runs directly, every test is registered.
 */
export function shardCompiledBinaryE2ETests<Args extends unknown[]>(
  register: (...args: Args) => void,
): (...args: Args) => void {
  let declared = 0;
  return (...args: Args) => {
    const index = declared++;
    if (selectedShard === undefined || index % COMPILED_BINARY_E2E_SHARD_COUNT === selectedShard) {
      register(...args);
    }
  };
}

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

/**
 * Get an available port using OS-assigned port 0. A shard keeps only ports in
 * its own residue class, so two shards running side by side never pick the
 * same released port and poll each other's server for readiness.
 */
async function getAvailablePort(): Promise<number> {
  while (true) {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const { port } = listener.addr as Deno.NetAddr;
    listener.close();
    if (
      selectedShard === undefined || port % COMPILED_BINARY_E2E_SHARD_COUNT === selectedShard
    ) {
      return port;
    }
  }
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

let binaryCompiled: Promise<void> | undefined;

/** Create the coordination directory, refusing one another user could write to. */
async function ensureCoordinationDir(): Promise<void> {
  try {
    await Deno.mkdir(COORDINATION_DIR, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  const info = await Deno.lstat(COORDINATION_DIR);
  const uid = Deno.uid();
  if (
    !info.isDirectory || (uid !== null && info.uid !== uid) ||
    (info.mode !== null && (info.mode & 0o077) !== 0)
  ) {
    throw new Error(`Refusing shared coordination directory: ${COORDINATION_DIR}`);
  }
}

/**
 * Identify a process instance, not just its pid, since a pid can be reused.
 * Linux reads the start time from /proc, other hosts from `ps`. Returns null
 * when the process does not exist and undefined when neither source exists.
 */
async function readProcessIdentity(pid: number): Promise<string | null | undefined> {
  try {
    const stat = await Deno.readTextFile(`/proc/${pid}/stat`);
    // Field 22 is the start time; fields restart after the parenthesized name.
    const startedAt = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    if (startedAt) return `${pid} ${startedAt}`;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound && await exists("/proc/self/stat")) return null;
  }
  try {
    const result = await new Deno.Command("ps", {
      args: ["-o", "lstart=", "-p", String(pid)],
      stdout: "piped",
      stderr: "null",
    }).output();
    const startedAt = new TextDecoder().decode(result.stdout).trim();
    return result.success && startedAt ? `${pid} ${startedAt}` : null;
  } catch {
    return undefined;
  }
}

interface BinaryRecord {
  process: string;
  binaryPath: string;
}

async function readBinaryRecord(path: string): Promise<Partial<BinaryRecord> | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return undefined;
  }
}

/**
 * Remove binaries compiled by test processes that have exited, except
 * BINARY_PATH itself, which compileBinary checks against the source hash.
 * A process whose liveness cannot be read keeps its binary.
 */
async function removeBinariesOfExitedProcesses(): Promise<void> {
  for await (const entry of Deno.readDir(COORDINATION_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(BINARY_RECORD_SUFFIX)) continue;
    const recordPath = join(COORDINATION_DIR, entry.name);
    const record = await readBinaryRecord(recordPath);
    const pid = Number.parseInt(record?.process ?? "", 10);
    if (Number.isInteger(pid)) {
      const current = await readProcessIdentity(pid);
      if (current === undefined || current === record?.process) continue;
    }
    if (record?.binaryPath && record.binaryPath !== BINARY_PATH) {
      for (const path of [record.binaryPath, `${record.binaryPath}.srcHash`]) {
        await Deno.remove(path).catch(() => {});
      }
    }
    await Deno.remove(recordPath).catch(() => {});
  }
}

/**
 * Compile the binary at most once per test process, shared by every suite in
 * every test file of that process. The first file to get here compiles it
 * (honouring VERYFRONT_BINARY_FRESH and the source hash); later files of the
 * same process reuse that binary.
 */
export function ensureBinaryCompiled(): Promise<void> {
  binaryCompiled ??= acquireBinary();
  return binaryCompiled;
}

async function acquireBinary(): Promise<void> {
  await ensureCoordinationDir();
  const processIdentity = await readProcessIdentity(Deno.pid) ?? String(Deno.pid);
  const recordPath = join(COORDINATION_DIR, `${Deno.pid}${BINARY_RECORD_SUFFIX}`);
  using lock = await Deno.open(BINARY_LOCK_PATH, { create: true, write: true });
  await lock.lock(true);
  await removeBinariesOfExitedProcesses();
  const record = await readBinaryRecord(recordPath);
  if (
    record?.process === processIdentity && record.binaryPath === BINARY_PATH &&
    await exists(BINARY_PATH)
  ) {
    console.log("✅ Using the binary compiled for this test run:", BINARY_PATH);
    return;
  }
  await compileBinary();
  const compiled: BinaryRecord = { process: processIdentity, binaryPath: BINARY_PATH };
  await Deno.writeTextFile(recordPath, `${JSON.stringify(compiled)}\n`);
}

async function compileBinary(): Promise<void> {
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

  // The parent of the path actually being written, not E2E_BINARY_DIR: with
  // VERYFRONT_BINARY pointing elsewhere the repo-local dir is unused, and creating
  // it would fail on a read-only checkout.
  await Deno.mkdir(dirname(BINARY_PATH), { recursive: true });

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
  void (async () => {
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

/** A fresh cache per server, so servers running side by side never share cache state. */
async function getBinaryTestCacheDir(nodeEnv: string): Promise<string> {
  binaryTestCacheRoot ??= await Deno.makeTempDir({ prefix: "vf-e2e-binary-cache-" });
  return await Deno.makeTempDir({
    dir: binaryTestCacheRoot,
    prefix: nodeEnv === "production" ? "production-" : "development-",
  });
}

export async function cleanupBinaryTestCache(): Promise<void> {
  if (!binaryTestCacheRoot) return;
  const cacheRoot = binaryTestCacheRoot;
  binaryTestCacheRoot = undefined;
  await Deno.remove(cacheRoot, { recursive: true }).catch(() => {});
}

async function waitForServer(port: number, deadlineMs = 60_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/readyz`);
      // Consume the response body to avoid connection issues
      await resp.text();
      if (resp.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Server failed to start on port ${port}`);
}

async function startBinaryServer(
  projectDir: string,
  nodeEnv = "development",
  extraEnv?: Record<string, string>,
): Promise<TestServer> {
  await installBinaryTestCSSProcessor(projectDir);
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const logs: string[] = [];
    const port = await getAvailablePort();
    const cacheDir = await getBinaryTestCacheDir(nodeEnv);

    const process = new Deno.Command(BINARY_PATH, {
      args: ["serve", "--mode=production", "-p", String(port)],
      cwd: projectDir,
      clearEnv: true,
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
        continue;
      }

      throw new Error(
        `Server failed to start on port ${port} within 60s. Logs:\n${logOutput.slice(-3000)}`,
      );
    }

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
      },
    };
  }

  throw new Error("Failed to start server after all retries");
}

const BINARY_TEST_CSS_PROCESSOR = `
const compiler = Object.freeze({
  build() {
    return "";
  },
});

const processor = Object.freeze({
  cacheIdentity: "veryfront.binary-e2e.css-processor.v1",
  defaultStylesheet: "",
  async compile() {
    return compiler;
  },
});

const optimizer = Object.freeze({
  cacheIdentity: "veryfront.binary-e2e.css-optimizer.v1",
  optimize(request) {
    return Object.freeze({ css: request.css });
  },
});

export default function binaryE2ECSSProcessor() {
  return {
    name: "binary-e2e-css-processor",
    version: "1.0.0",
    capabilities: [],
    contracts: { provides: ["CSSProcessor", "CSSOptimizationEngine"] },
    setup(context) {
      context.provide("CSSProcessor", processor);
      context.provide("CSSOptimizationEngine", optimizer);
    },
  };
}
`;

async function installBinaryTestCSSProcessor(projectDir: string): Promise<void> {
  const extensionDir = join(projectDir, "extensions", "binary-e2e-css-processor");
  await Deno.mkdir(extensionDir, { recursive: true });
  await Deno.writeTextFile(join(extensionDir, "index.ts"), BINARY_TEST_CSS_PROCESSOR);
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
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${server.port}${path}`);
  } catch (cause) {
    throw new Error(
      `Request failed for ${path}\n\nRecent logs:\n${server.logs.join("").slice(-16000)}`,
      { cause },
    );
  }
  const html = await response.text();

  const recentLogs = server.logs.join("").slice(-16000);
  assertEquals(
    response.status,
    200,
    `Should return 200 for ${path}\n\nResponse body:\n${
      html.slice(0, 2000)
    }\n\nRecent logs:\n${recentLogs}`,
  );
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
    expectedCounterCount?: number;
    assertBeforeClick?: () => Promise<void>;
    assertAfterClick?: () => Promise<void>;
  } = {},
): Promise<void> {
  try {
    await page.waitForSelector('#counter[data-hydrated="yes"]', { timeout: 15_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const hydrationData = document.getElementById("veryfront-hydration-data")?.textContent ?? "";
      const counters = Array.from(document.querySelectorAll("#counter")).map((element) => ({
        html: element.outerHTML,
        text: element.textContent?.trim() ?? "",
        hydrated: element.getAttribute("data-hydrated"),
      }));
      const scripts = Array.from(document.scripts).map((script) => script.src || script.id || "");
      const resources = performance.getEntriesByType("resource").map((entry) => entry.name);

      return {
        body: document.body.innerHTML.slice(0, 2000),
        counters,
        hydrationData,
        resources,
        scripts,
      };
    });

    throw new Error(
      `Counter did not hydrate.\n${JSON.stringify(diagnostics, null, 2)}\n${String(error)}`,
    );
  }

  const initialText = await page.textContent("#counter");
  assertEquals(initialText?.trim(), "Count: 0");

  if (options.expectedCounterCount !== undefined) {
    const counterCount = await page.$$eval("#counter", (elements) => elements.length);
    assertEquals(counterCount, options.expectedCounterCount);
  }

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

  await page.$eval("#counter", (element) => {
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error(`Expected #counter to be a button, got ${element.tagName}`);
    }
    element.click();
  });
  try {
    await page.waitForFunction(
      () => document.querySelector("#counter")?.textContent?.trim() === "Count: 1",
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      body: document.body.innerHTML.slice(0, 2000),
      counters: Array.from(document.querySelectorAll("#counter")).map((element) => ({
        html: element.outerHTML,
        text: element.textContent?.trim() ?? "",
        hydrated: element.getAttribute("data-hydrated"),
      })),
    }));

    throw new Error(
      `Counter did not respond after hydration.\n${JSON.stringify(diagnostics, null, 2)}\n${
        String(error)
      }`,
    );
  }

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
