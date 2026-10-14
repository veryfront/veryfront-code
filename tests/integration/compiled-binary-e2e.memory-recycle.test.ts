/**
 * Compiled Binary E2E memory recycle regression. It lives beside the sharded
 * compiled-binary-e2e.suite.ts so the e2e:binary suite runs it alongside the
 * shards against the same compiled binary.
 */
import "../_helpers/contract-init.ts";

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { load as loadEnv } from "#veryfront/platform/compat/std/dotenv.ts";
import { PROVIDER_ENV_KEYS } from "../../scripts/test/suites.ts";
import { withoutHostBinaryInfraEnv } from "../_helpers/proxy-mode.ts";
import {
  BINARY_PATH,
  cleanupBinaryTestCache,
  COMPILED_BINARY_E2E_OPTIONS,
  createTestProject,
  ensureBinaryCompiled,
} from "./compiled-binary-e2e.test-helpers.ts";

// Load .env file for test configuration (VERYFRONT_BINARY_FRESH, etc.)
try {
  await loadEnv({ export: true, allowEmptyValues: true, examplePath: null });
} catch {
  // .env file doesn't exist - that's fine
}
for (const key of PROVIDER_ENV_KEYS) Deno.env.delete(key);

// Separate suite lets the native lifecycle regression run without browser fixtures.
describe("Compiled Binary Memory Recycle", COMPILED_BINARY_E2E_OPTIONS, () => {
  beforeAll(ensureBinaryCompiled);
  afterAll(cleanupBinaryTestCache);
  it("should recycle compiled production serve after sustained RSS pressure", async () => {
    const projectDir = await createTestProject(
      "memory-recycle",
      "export default function Home() { return <main>Memory recycle</main>; }",
    );
    const process = new Deno.Command(BINARY_PATH, {
      args: ["serve", "--mode=production", "--hostname=127.0.0.1", "-p", "0"],
      cwd: projectDir,
      clearEnv: true,
      env: {
        ...withoutHostBinaryInfraEnv(Deno.env.toObject()),
        NODE_ENV: "production",
        LOG_FORMAT: "text",
        VERYFRONT_CACHE_DIR: join(projectDir, ".cache"),
        ENABLE_MEMORY_MONITORING: "false",
        MEMORY_MONITORING_INTERVAL_MS: "25",
        MEMORY_RECYCLE_ENABLED: "true",
        // A controlled threshold exercises the real sampler without allocating
        // enough memory to pressure the test host.
        MEMORY_RECYCLE_RSS_THRESHOLD_MB: "1",
        MEMORY_RECYCLE_CONSECUTIVE_SAMPLES: "2",
        SHUTDOWN_DRAIN_TIMEOUT_MS: "100",
        SHUTDOWN_CLEANUP_TIMEOUT_MS: "100",
      },
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        process.kill("SIGKILL");
      } catch {
        // The child can finish just before the timeout callback runs.
      }
    }, 30_000);

    try {
      const result = await process.output();
      const decoder = new TextDecoder();
      const logs = decoder.decode(result.stdout) + decoder.decode(result.stderr);
      assert(!timedOut, `Compiled serve did not exit after memory pressure:\n${logs}`);
      assertEquals(result.code, 0, logs);
      assertEquals(logs.split("RSS recycle threshold reached").length - 1, 1, logs);
      assertEquals(
        logs.split("Received memory-pressure, initiating graceful shutdown...").length - 1,
        1,
        logs,
      );
      assertStringIncludes(logs, "Server marked as not ready", logs);
      assertStringIncludes(logs, "Memory monitoring stopped", logs);
      assertStringIncludes(logs, "Graceful shutdown complete", logs);
    } finally {
      clearTimeout(timeout);
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});
