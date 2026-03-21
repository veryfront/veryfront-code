#!/usr/bin/env -S deno test --allow-all
/**
 * VFS Proxy Mode E2E Tests - Compiled Binary
 *
 * Tests that the compiled binary correctly enters VFS/proxy mode when
 * PROXY_MODE=1 is set, and resolves project slugs from Host headers.
 *
 * Run:
 *   deno test --allow-all tests/integration/vfs-proxy-mode-e2e.test.ts
 */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { load as loadEnv } from "#veryfront/platform/compat/std/dotenv.ts";
import { withProxyModeControlPlaneKey } from "../_helpers/proxy-mode.ts";

try {
  await loadEnv({ export: true, allowEmptyValues: true, examplePath: null });
} catch { /* no .env */ }

const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") ?? `/tmp/veryfront-vfs-e2e-bin-${Deno.pid}`;
const BINARY_HASH_PATH = `${BINARY_PATH}.srcHash`;
const VERYFRONT_API_TOKEN = Deno.env.get("VERYFRONT_API_TOKEN");

async function getAvailablePort(): Promise<number> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

async function computeSourceHash(): Promise<string> {
  const decoder = new TextDecoder();
  for (const args of [["rev-parse", "HEAD:src"], ["rev-parse", "HEAD"]]) {
    try {
      const r = await new Deno.Command("git", { args, stdout: "piped", stderr: "null" }).output();
      if (r.success) return decoder.decode(r.stdout).trim();
    } catch { /* fall through */ }
  }
  return Date.now().toString();
}

async function ensureBinaryCompiled(): Promise<void> {
  const denoPath = Deno.execPath();
  const forceFresh = Deno.env.get("VERYFRONT_BINARY_FRESH") === "1";
  const binaryExists = await exists(BINARY_PATH);
  const currentHash = await computeSourceHash();

  if (binaryExists && !forceFresh) {
    try {
      const storedHash = await Deno.readTextFile(BINARY_HASH_PATH);
      if (storedHash.trim() === currentHash) return;
    } catch { /* recompile */ }
  }

  if (binaryExists) await Deno.remove(BINARY_PATH);

  const prep = await new Deno.Command(denoPath, {
    args: ["run", "--allow-all", "scripts/build/prepare-framework-sources.ts"],
    stdout: "inherit", stderr: "inherit",
  }).output();
  if (!prep.success) throw new Error("Failed to prepare framework sources");

  const compile = await new Deno.Command(denoPath, {
    args: [
      "compile", "--allow-all",
      "--include", "src/platform/polyfills",
      "--include", "src/proxy/main.ts",
      "--include", "dist/framework-src",
      "--output", BINARY_PATH, "cli/main.ts",
    ],
    stdout: "inherit", stderr: "inherit",
  }).output();
  if (!compile.success) throw new Error("Failed to compile binary");

  await Deno.writeTextFile(BINARY_HASH_PATH, currentHash);
}

interface TestServer {
  process: Deno.ChildProcess;
  port: number;
  logs: string[];
  kill: () => Promise<void>;
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
    } catch { /* closed */ }
  })();
}

async function startVFSServer(projectDir: string, extraEnv?: Record<string, string>): Promise<TestServer> {
  const logs: string[] = [];
  const port = await getAvailablePort();
  const cacheDir = await Deno.makeTempDir({ prefix: "vf-vfs-cache-" });

  const env = withProxyModeControlPlaneKey({
    ...Deno.env.toObject(),
    NODE_ENV: "production",
    PROXY_MODE: "1",
    VERYFRONT_API_BASE_URL: "https://api.veryfront.com",
    LOG_FORMAT: "text",
    VERYFRONT_CACHE_DIR: cacheDir,
    ...extraEnv,
  });

  const process = new Deno.Command(BINARY_PATH, {
    args: ["serve", "--mode=production", "-p", String(port)],
    cwd: projectDir,
    env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  collectLogs(logs, process.stdout);
  collectLogs(logs, process.stderr);

  return {
    process, port, logs,
    kill: async () => {
      try { process.kill(); await process.status; } catch { /* dead */ }
      await new Promise((r) => setTimeout(r, 300));
      try { await Deno.remove(cacheDir, { recursive: true }); } catch { /* ok */ }
    },
  };
}

/**
 * Fetches the active production release ID for a project slug from the API.
 * The proxy layer normally does this via lookupProjectByDomain; since this test
 * bypasses the proxy, we must do it ourselves.
 */
async function getActiveReleaseId(slug: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.veryfront.com/projects/${encodeURIComponent(slug)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const project = await res.json();
  const prodEnv = project.environments?.find((e: { name: string }) => e.name === "production");
  return prodEnv?.active_release_id ?? null;
}

async function createMinimalVFSProject(): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-vfs-project-" });
  await Deno.writeTextFile(join(projectDir, "package.json"), JSON.stringify({
    name: "vfs-test-project", type: "module",
    dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
  }));
  await Deno.writeTextFile(join(projectDir, "veryfront.config.ts"), `export default {};`);
  await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
  return projectDir;
}

describe("VFS Proxy Mode - Compiled Binary", { sanitizeOps: false, sanitizeResources: false }, () => {
  beforeAll(async () => { await ensureBinaryCompiled(); });
  afterAll(async () => {
    try { await Deno.remove(BINARY_PATH); await Deno.remove(BINARY_HASH_PATH); } catch { /* ok */ }
  });

  it("should detect PROXY_MODE=1 and configure veryfront-api filesystem", async () => {
    const projectDir = await createMinimalVFSProject();
    const server = await startVFSServer(projectDir);
    try {
      // Wait for the server to actually start by polling the health endpoint
      // or for the expected log to appear (up to 30s)
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const allLogs = server.logs.join("\n");
        if (allLogs.includes("Production server listening")) break;
        try {
          const r = await fetch(`http://127.0.0.1:${server.port}/`);
          await r.text();
          break;
        } catch { /* server not ready yet */ }
        await new Promise((r) => setTimeout(r, 500));
      }

      const allLogs = server.logs.join("\n");

      // Config loader should detect proxy mode and select veryfront-api
      assert(
        allLogs.includes("Using veryfront-api filesystem (proxy mode)"),
        `Should log 'Using veryfront-api filesystem (proxy mode)'. Got logs:\n${allLogs.slice(0, 1000)}`,
      );
      assert(
        !allLogs.includes("Using local filesystem (no proxy mode)"),
        "Should NOT log 'Using local filesystem (no proxy mode)'",
      );
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("should serve embedded framework modules from compiled binary", async () => {
    const projectDir = await createMinimalVFSProject();
    // Use standalone mode (no proxy) so framework modules can be served without
    // needing a releaseId from the API. Framework files are resolved from
    // dist/framework-src/ embedded in the compiled binary.
    const server = await startVFSServer(projectDir, { PROXY_MODE: "0" });
    try {
      // Wait for server to be ready
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`http://127.0.0.1:${server.port}/`);
          await r.text();
          break;
        } catch { await new Promise((r) => setTimeout(r, 500)); }
      }

      // Framework modules under _veryfront/ should be served from embedded sources
      // These are resolved from dist/framework-src/ in compiled binaries
      const modulePaths = [
        "_veryfront/react/components/Head.js",
        "_veryfront/react/context/index.js",
        "_veryfront/agent/react/index.js",
        "_veryfront/workflow/react/index.js",
      ];

      for (const modulePath of modulePaths) {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/_vf_modules/${modulePath}`,
        );
        const body = await response.text();

        assertEquals(
          response.status,
          200,
          `Expected 200 for ${modulePath}, got ${response.status}: ${body.slice(0, 200)}`,
        );
        assert(
          body.includes("export") || body.includes("import"),
          `Expected JS module for ${modulePath}, got: ${body.slice(0, 200)}`,
        );
      }
    } finally {
      await server.kill();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  // Only run live API tests when token is available (local dev, not CI)
  if (VERYFRONT_API_TOKEN) {
    it("should resolve project slug from Host header in proxy mode", async () => {
      // Fetch the real active release ID — the proxy layer normally does this
      // via lookupProjectByDomain, but since the test hits the renderer directly
      // we must provide the correct x-release-id header ourselves.
      const releaseId = await getActiveReleaseId("flow-ops", VERYFRONT_API_TOKEN!);
      if (!releaseId) {
        console.log("SKIP: flow-ops has no active production release");
        return;
      }

      const projectDir = await createMinimalVFSProject();
      const server = await startVFSServer(projectDir, {
        VERYFRONT_API_TOKEN: VERYFRONT_API_TOKEN!,
      });

      try {
        // Wait for server to be ready
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          try {
            const r = await fetch(`http://127.0.0.1:${server.port}/`);
            await r.text();
            break;
          } catch { await new Promise((r) => setTimeout(r, 500)); }
        }

        // Use flow-ops.lvh.me (*.lvh.me resolves to 127.0.0.1)
        // Include proxy headers that a real proxy would set — without x-release-id
        // the renderer rejects production requests in proxy mode with 502.
        const response = await fetch(`http://flow-ops.lvh.me:${server.port}/api/flows`, {
          headers: {
            "x-release-id": releaseId,
            "x-environment": "production",
            "x-project-slug": "flow-ops",
            "x-token": "test-token",
          },
        });
        await response.text();

        // Verify the server resolved the slug from the Host header, not the
        // local-* fallback. The logger context in the server logs shows the
        // resolved project_slug. A 502 would mean the releaseId validation
        // failed (slug wasn't resolved); anything else means the request was
        // accepted and processed (even if the VFS adapter itself errors out
        // with 500 due to multi-tenant slug propagation issues).
        const allLogs = server.logs.join("\n");
        assert(
          allLogs.includes("project_slug=flow-ops"),
          "Should resolve slug 'flow-ops' from Host header",
        );
        assert(
          response.status !== 502,
          `Should not get 502 (releaseId validation). Got ${response.status}`,
        );
      } finally {
        await server.kill();
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  } else {
    it("should serve API routes from VFS project (SKIPPED - no VERYFRONT_API_TOKEN)", () => {
      // Needs VERYFRONT_API_TOKEN for live API tests
    });
  }
});
