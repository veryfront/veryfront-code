#!/usr/bin/env -S deno test --allow-all
/**
 * VFS Proxy Mode E2E Tests - Compiled Binary
 *
 * Tests that the compiled binary correctly enters VFS/proxy mode when
 * PROXY_MODE=1 is set, and resolves project slugs from Host headers.
 *
 * Run:
 *   deno task test:e2e:binary:vfs-proxy
 */
import "../_helpers/contract-init.ts";

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { load as loadEnv } from "#veryfront/platform/compat/std/dotenv.ts";
import { SERVER_CONFIG, TEST_TIMEOUTS } from "../_helpers/constants.ts";
import { fetchWithTimeout, pollHttpReadyByTimeout } from "../_helpers/http-polling.ts";
import { withoutHostBinaryInfraEnv, withProxyModeControlPlaneKey } from "../_helpers/proxy-mode.ts";
import {
  BINARY_PATH,
  cleanupCompiledBinaryArtifacts,
  ensureBinaryCompiled,
} from "./compiled-binary-e2e.test-helpers.ts";

try {
  await loadEnv({ export: true, allowEmptyValues: true, examplePath: null });
} catch { /* no .env */ }

const VERYFRONT_API_TOKEN = Deno.env.get("VERYFRONT_API_TOKEN");

async function getAvailablePort(): Promise<number> {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

interface TestServer {
  process: Deno.ChildProcess;
  port: number;
  logs: string[];
  kill: () => Promise<void>;
}

async function collectLogs(
  logs: string[],
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      if (decoded) logs.push(decoded);
    }
  } catch {
    /* process stream closed during teardown */
  } finally {
    const trailing = decoder.decode();
    if (trailing) logs.push(trailing);
    reader.releaseLock();
  }
}

async function startVFSServer(
  projectDir: string,
  extraEnv?: Record<string, string>,
): Promise<TestServer> {
  const logs: string[] = [];
  const port = await getAvailablePort();
  const cacheDir = await Deno.makeTempDir({ prefix: "vf-vfs-cache-" });

  const env = withProxyModeControlPlaneKey({
    ...withoutHostBinaryInfraEnv(Deno.env.toObject()),
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
    clearEnv: true,
    env,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const logReaders = [
    collectLogs(logs, process.stdout),
    collectLogs(logs, process.stderr),
  ];

  return {
    process,
    port,
    logs,
    kill: async () => {
      try {
        process.kill();
        await process.status;
      } catch { /* dead */ }
      await Promise.allSettled(logReaders);
      try {
        await Deno.remove(cacheDir, { recursive: true });
      } catch { /* ok */ }
    },
  };
}

function getServerLogs(server: TestServer): string {
  return server.logs.join("");
}

async function waitForVFSServerReady(server: TestServer): Promise<void> {
  const readinessController = new AbortController();
  const readiness = pollHttpReadyByTimeout(
    `http://127.0.0.1:${server.port}/readyz`,
    {
      timeoutMs: TEST_TIMEOUTS.E2E,
      requestTimeoutMs: SERVER_CONFIG.FETCH_TIMEOUT,
      verifyWithSecondRequest: true,
      signal: readinessController.signal,
    },
  );
  const earlyExit: Promise<never> = server.process.status.then((status) => {
    throw new Error(
      `Compiled server exited before readiness (code ${status.code}, signal ${
        status.signal ?? "none"
      }). Logs:\n${getServerLogs(server).slice(-3000)}`,
    );
  });
  const result = await (async () => {
    try {
      return await Promise.race([readiness, earlyExit]);
    } finally {
      readinessController.abort();
    }
  })();

  if (result.ready) return;

  throw new Error(
    `Compiled server was not ready after ${TEST_TIMEOUTS.E2E}ms ` +
      `(${result.attempts} attempts). Last error: ${result.lastError?.message ?? "none"}. Logs:\n${
        getServerLogs(server).slice(-3000)
      }`,
  );
}

/**
 * Fetches the active production release ID for a project slug from the API.
 * The proxy layer normally does this via lookupProjectByDomain; since this test
 * bypasses the proxy, we must do it ourselves.
 */
async function getActiveReleaseId(slug: string, token: string): Promise<string | null> {
  const res = await fetchWithTimeout(
    `https://api.veryfront.com/projects/${encodeURIComponent(slug)}`,
    TEST_TIMEOUTS.E2E,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const project = await res.json();
  const prodEnv = project.environments?.find((e: { name: string }) => e.name === "production");
  return prodEnv?.active_release_id ?? null;
}

async function createMinimalVFSProject(): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-vfs-project-" });
  await Deno.writeTextFile(
    join(projectDir, "package.json"),
    JSON.stringify({
      name: "vfs-test-project",
      type: "module",
      dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
    }),
  );
  await Deno.writeTextFile(join(projectDir, "veryfront.config.ts"), `export default {};`);
  await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
  return projectDir;
}

describe(
  "VFS Proxy Mode - Compiled Binary",
  {
    sanitizeOps: false,
    sanitizeResources: false,
    timeout: 600_000,
  },
  () => {
    beforeAll(async () => {
      await ensureBinaryCompiled();
    });
    afterAll(async () => {
      await cleanupCompiledBinaryArtifacts();
    });

    it("should detect PROXY_MODE=1 and configure veryfront-api filesystem", async () => {
      const projectDir = await createMinimalVFSProject();
      const server = await startVFSServer(projectDir);
      try {
        await waitForVFSServerReady(server);
        const allLogs = getServerLogs(server);

        // Config loader should detect proxy mode and select veryfront-api
        assert(
          allLogs.includes("Using veryfront-api filesystem (proxy mode)"),
          `Should log 'Using veryfront-api filesystem (proxy mode)'. Got logs:\n${
            allLogs.slice(0, 1000)
          }`,
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
        await waitForVFSServerReady(server);

        // Framework modules under _veryfront/ should be served from embedded sources
        // These are resolved from dist/framework-src/ in compiled binaries
        const modulePaths = [
          "_veryfront/react/components/Head.js",
          "_veryfront/react/context/index.js",
          "_veryfront/agent/react/index.js",
          "_veryfront/workflow/react/index.js",
        ];

        for (const modulePath of modulePaths) {
          const response = await fetchWithTimeout(
            `http://127.0.0.1:${server.port}/_vf_modules/${modulePath}`,
            TEST_TIMEOUTS.E2E,
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
          await waitForVFSServerReady(server);

          // Use flow-ops.lvh.me (*.lvh.me resolves to 127.0.0.1)
          // Include proxy headers that a real proxy would set — without x-release-id
          // the renderer rejects production requests in proxy mode with 502.
          const response = await fetchWithTimeout(
            `http://flow-ops.lvh.me:${server.port}/api/flows`,
            TEST_TIMEOUTS.E2E,
            {
              headers: {
                "x-release-id": releaseId,
                "x-environment": "production",
                "x-project-slug": "flow-ops",
                "x-token": "test-token",
              },
            },
          );
          await response.text();

          // Verify the server resolved the slug from the Host header, not the
          // local-* fallback. The logger context in the server logs shows the
          // resolved project_slug. A 502 would mean the releaseId validation
          // failed (slug wasn't resolved); anything else means the request was
          // accepted and processed (even if the VFS adapter itself errors out
          // with 500 due to multi-tenant slug propagation issues).
          const allLogs = getServerLogs(server);
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
  },
);
