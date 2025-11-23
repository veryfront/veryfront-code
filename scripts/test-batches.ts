#!/usr/bin/env -S deno run --allow-all
/**
 * Run tests in batches to avoid memory issues
 *
 * This script splits the test suite into logical batches and runs them with
 * controlled concurrency, preventing V8 heap exhaustion when running the full suite.
 *
 * Features:
 * - Worker-based isolation (each batch runs in separate process)
 * - Configurable concurrency limit (default: 2 parallel batches)
 * - Automatic retry on OOM failures
 * - Memory usage tracking and reporting
 */

interface TestBatch {
  name: string;
  patterns: string[];
  description: string;
  env?: Record<string, string>;
  extraArgs?: string[];
  sequential?: boolean; // If true, this batch cannot run concurrently with other sequential batches
  resourceType?: "unit" | "integration" | "server"; // Resource usage category for smart scheduling
}

const TEST_BATCHES: TestBatch[] = [
  {
    name: "Adapters",
    patterns: ["tests/integration/adapters/*.test.ts"],
    description: "Runtime adapters (Deno, Node, Bun, Cloudflare) integration tests",
    resourceType: "integration",
  },
  {
    name: "Core - Router & Config",
    patterns: [
      "tests/integration/core/dynamic-router.test.ts",
      "tests/integration/core/config-loader-edge-cases.test.ts",
      "tests/integration/core/api-handler.test.ts",
    ],
    description: "Core routing and config tests (~50 tests)",
    resourceType: "integration",
  },
  {
    name: "Core - Bootstrap & Resolver",
    patterns: [
      "tests/integration/core/bootstrap.test.ts",
      "tests/integration/core/resolver.test.ts",
      "tests/integration/core/getEntityInfo.test.ts",
    ],
    description: "Core bootstrap and resolver tests (~80 tests)",
    resourceType: "integration",
  },
  {
    name: "Server - HMR",
    patterns: [
      "tests/integration/server/hmr*.test.ts",
    ],
    description: "HMR server tests (dynamic port 9000-12000, parallel-safe)",
    env: { DENO_JOBS: "1" },
    sequential: false, // Phase 4: Enable cross-batch parallelization (dynamic ports prevent conflicts)
    resourceType: "server",
  },
  {
    name: "Server - Dev",
    patterns: [
      "tests/integration/server/dev*.test.ts",
      "tests/integration/server/module*.test.ts",
    ],
    description: "Dev server tests (dynamic port 9000-12000, requires sequential - resource contention)",
    env: { DENO_JOBS: "1" },
    sequential: true, // Phase 4 Rollback: Resource contention causes timeouts when parallel
    resourceType: "server",
  },
  {
    name: "Server - Production & Build",
    patterns: [
      "tests/integration/server/production*.test.ts",
      "tests/integration/server/build*.test.ts",
    ],
    description: "Production and build tests (dynamic port 9000-12000, requires sequential - resource contention)",
    env: { DENO_JOBS: "1" },
    sequential: true, // Phase 4 Rollback: Resource contention causes timeouts when parallel
    resourceType: "server",
  },
  {
    name: "Server - Build Core",
    patterns: [
      "tests/integration/server/build/build.test.ts",
      "tests/integration/server/build/asset-generation.test.ts",
    ],
    description: "Core build tests (~60 tests, parallel-safe, files share state)",
    env: { DENO_JOBS: "1" },
    sequential: false, // Phase 5: Cannot split (files share test state)
    resourceType: "server",
  },
  {
    name: "Server - Build Runtime",
    patterns: [
      "tests/integration/server/build/client-runtime.test.ts",
      "tests/integration/server/build/static-generation.test.ts",
    ],
    description: "Build runtime and static generation tests (~53 tests, parallel-safe)",
    env: { DENO_JOBS: "1" },
    sequential: false, // Phase 4: Enable parallelization
    resourceType: "server",
  },
  {
    name: "Server - Modules",
    patterns: ["tests/integration/server/modules/**/*.test.ts"],
    description: "Module server tests (dynamic port 9000-12000, parallel-safe)",
    env: { DENO_JOBS: "1" },
    sequential: false, // Phase 4: Enable cross-batch parallelization
    resourceType: "server",
  },
  {
    name: "Server - RSC",
    patterns: ["tests/integration/server/rsc/**/*.test.ts"],
    description: "RSC tests (dynamic port 9000-12000, requires sequential - resource contention)",
    env: { DENO_JOBS: "1" },
    sequential: true, // Phase 4 Rollback: Resource contention causes timeouts when parallel
    resourceType: "server",
  },
  {
    name: "Server - Universal Core",
    patterns: [
      "tests/integration/server/universal/server.test.ts",
      "tests/integration/server/universal/handler.test.ts",
      "tests/integration/server/universal/ssr.test.ts",
    ],
    description: "Core universal handler tests (dynamic port 9000-12000, parallel-safe)",
    env: { DENO_JOBS: "1" },
    sequential: false, // Phase 4: Enable cross-batch parallelization (dynamic ports)
    resourceType: "server",
  },
  {
    name: "Server - Universal Features",
    patterns: [
      "tests/integration/server/universal/**/*.test.ts",
      "!tests/integration/server/universal/server.test.ts",
      "!tests/integration/server/universal/handler.test.ts",
      "!tests/integration/server/universal/ssr.test.ts",
      "tests/integration/server/universal-handler/**/*.test.ts",
    ],
    description: "Universal feature tests (dynamic port 9000-12000, parallel-safe)",
    env: { DENO_JOBS: "1" },
    sequential: false, // Phase 4: Enable cross-batch parallelization
    resourceType: "server",
  },
  {
    name: "Rendering - Core Foundation",
    patterns: ["tests/integration/render/renderer-core-foundation.test.ts"],
    description: "Foundation renderer tests - Part 1/3 (~27 tests, 8 suites)",
    resourceType: "integration",
  },
  {
    name: "Rendering - Core Features",
    patterns: ["tests/integration/render/renderer-core-features.test.ts"],
    description: "Features renderer tests - Part 2/3 (~33 tests, 10 suites)",
    resourceType: "integration",
  },
  {
    name: "Rendering - Core Edge Cases",
    patterns: ["tests/integration/render/renderer-core-edge-cases.test.ts"],
    description: "Edge cases renderer tests - Part 3/3 (~20 tests, 6 suites)",
    resourceType: "integration",
  },
  {
    name: "Rendering - Layout",
    patterns: [
      "tests/integration/render/layout-handling.test.ts",
      "tests/integration/render/layout-system/**/*.test.ts",
    ],
    description: "Layout handling and system tests (~54 tests)",
    resourceType: "integration",
  },
  {
    name: "Rendering - Virtual Modules",
    patterns: ["tests/integration/render/virtual-module-system.test.ts"],
    description: "Virtual module system tests (~11 tests)",
    resourceType: "integration",
  },
  {
    name: "Build - CSS Bundler",
    patterns: ["tests/integration/build/bundler/services/css-bundler.test.ts"],
    description: "CSS bundler tests (~16 tests, 474 LOC)",
    resourceType: "integration",
  },
  {
    name: "Build - MDX Bundler",
    patterns: ["tests/integration/build/bundler/services/mdx-bundler.test.ts"],
    description: "MDX bundler tests (~16 tests, 577 LOC)",
    resourceType: "integration",
  },
  {
    name: "Build - Script Bundler",
    patterns: ["tests/integration/build/bundler/services/script-bundler.test.ts"],
    description: "Script bundler tests (~16 tests, 731 LOC)",
    resourceType: "integration",
  },
  {
    name: "Build - Utils & Optimization",
    patterns: [
      "tests/integration/build/bundler/utils/**/*.test.ts",
      "tests/integration/build/bundler/services/optimizer.test.ts",
      "tests/integration/build/chunk-optimizer.test.ts",
    ],
    description: "Build utilities and optimization tests (~52 tests)",
    resourceType: "integration",
  },
  {
    name: "Client",
    patterns: ["tests/integration/client/**/*.test.ts"],
    description: "Client-side integration tests (router, prefetch)",
    resourceType: "integration",
  },
  {
    name: "Data",
    patterns: ["tests/integration/data/**/*.test.ts"],
    description: "Data fetching and caching integration tests",
    resourceType: "integration",
  },
  {
    name: "Framework & Lifecycle",
    patterns: [
      "tests/integration/full-lifecycle.test.ts",
      "tests/integration/veryfront-api-integration.test.ts",
      "tests/integration/framework/**/*.test.ts",
      "tests/integration/sdk/**/*.test.ts",
    ],
    description: "Full lifecycle, framework, and SDK integration tests",
    resourceType: "integration",
  },
  {
    name: "Module Loading & Routing",
    patterns: [
      "tests/integration/module-loading/**/*.test.ts",
      "tests/integration/routing/**/*.test.ts",
    ],
    description: "Module loading and routing integration tests",
    resourceType: "integration",
  },
  {
    name: "Runtime & CLI",
    patterns: [
      "tests/integration/runtime/**/*.test.ts",
      "tests/integration/cli/**/*.test.ts",
    ],
    description: "Runtime compatibility and CLI integration tests",
    resourceType: "integration",
  },
  {
    name: "Shared & Transforms",
    patterns: [
      "tests/integration/shared/**/*.test.ts",
      "tests/integration/transforms/**/*.test.ts",
    ],
    description: "Shared utilities and transform integration tests",
    resourceType: "integration",
  },
  {
    name: "Integration Tests - Other",
    patterns: [
      "tests/build/**/*.test.ts",
      "tests/render/**/*.test.ts",
      "tests/shared/**/*.test.ts",
      "tests/components/**/*.test.tsx",
    ],
    description: "Other integration tests outside main integration directory",
    resourceType: "integration",
  },
  {
    name: "Unit Tests - Client",
    patterns: ["src/rendering/client/**/*.test.ts"],
    description: "Client-side unit tests (router, prefetch, browser logger)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - Rendering",
    patterns: ["src/rendering/**/*.test.ts"],
    description: "Rendering unit tests (HTML generation, SSR, RSC)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - Transforms",
    patterns: ["src/build/transforms/**/*.test.ts"],
    description: "Code transformation unit tests (ESM, MDX, plugins)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - API (Core & Routing)",
    patterns: [
      "src/routing/api/responses.test.ts",
      "src/routing/api/context-builder.test.ts",
      "src/routing/api/dynamic-router.test.ts",
    ],
    description: "API routing core tests (merged fast batches, ~160ms combined)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - API (Routing 4)",
    patterns: ["src/routing/api/handler.test.ts"],
    description: "API handler tests (medium batch, 450 LOC)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - API (Discovery - Pages)",
    patterns: ["src/routing/api/route-discovery-pages.test.ts"],
    description: "API route discovery Pages Router tests (482 LOC)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - API (Discovery - App)",
    patterns: ["src/routing/api/route-discovery-app.test.ts"],
    description: "API route discovery App Router tests (470 LOC)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - Build",
    patterns: ["src/build/**/*.test.ts"],
    description: "Build system unit tests (chunking, bundling)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - Adapters",
    patterns: ["src/platform/adapters/**/*.test.ts"],
    description: "Runtime adapter unit tests",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - Shared",
    patterns: ["src/core/utils/**/*.test.ts", "src/platform/**/*.test.ts"],
    description: "Shared utility unit tests (logger, cache, compat, etc.)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - Observability",
    patterns: ["src/observability/**/*.test.ts"],
    description: "Observability unit tests (metrics, logging)",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - Server (Other)",
    patterns: [
      "src/server/routing/**/*.test.ts",
      "src/server/dev-server/**/*.test.ts",
    ],
    description: "Server routing and dev-server unit tests",
    resourceType: "unit",
  },
  {
    name: "Unit Tests - CLI",
    patterns: ["src/cli/**/*.test.ts"],
    description: "CLI utility unit tests",
    resourceType: "unit",
  },
];

// Configuration
const MAX_CONCURRENT_BATCHES = parseInt(Deno.env.get("TEST_CONCURRENCY") || "12"); // Phase 8: Reduced from 20 to 12 to reduce resource contention
const MAX_RETRIES = parseInt(Deno.env.get("TEST_MAX_RETRIES") || "1");
const CONFIG = new URL("../deno.json", import.meta.url).pathname;
const BATCH_DELAY_MS = parseInt(Deno.env.get("TEST_BATCH_DELAY") || "500"); // Phase 8: Increased from 300ms to 500ms to allow better cleanup between batches
const MEMORY_LIMIT_MB = parseInt(Deno.env.get("TEST_MEMORY_LIMIT") || "8192");
const TEST_TIMEOUT_MS = parseInt(Deno.env.get("TEST_TIMEOUT") || "240000"); // 4 minutes default (Server tests are slow)

// Phase 6: Per-batch memory limits for better GC performance
const MEMORY_LIMITS: Record<string, number> = {
  unit: 2048,       // Unit tests: small memory footprint
  integration: 4096, // Integration: moderate
  server: 8192,     // Server tests: full allocation
};

interface CliOptions {
  list: boolean;
  indices: number[] | null;
}

function parseCliOptions(args: string[]): CliOptions {
  const result: CliOptions = {
    list: false,
    indices: null,
  };

  const indexExpressions: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--list") {
      result.list = true;
      continue;
    }

    if (arg === "--index" || arg === "--indices") {
      const value = args[i + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      indexExpressions.push(value);
      i += 1;
      continue;
    }

    if (arg?.startsWith("--index=") || arg?.startsWith("--indices=")) {
      const value = arg.split("=", 2)[1];
      indexExpressions.push(value ?? "");
      continue;
    }
  }

  if (indexExpressions.length > 0) {
    const seen = new Set<number>();
    const indices: number[] = [];

    for (const expression of indexExpressions) {
      for (const rawToken of expression.split(",")) {
        const token = rawToken.trim();
        if (token.length === 0) continue;

        const addIndex = (oneBasedIndex: number) => {
          if (!Number.isInteger(oneBasedIndex)) {
            throw new Error(`Index must be an integer: "${token}"`);
          }
          if (oneBasedIndex < 1 || oneBasedIndex > TEST_BATCHES.length) {
            throw new Error(
              `Index ${oneBasedIndex} is out of range. There are ${TEST_BATCHES.length} batches.`,
            );
          }
          const zeroBased = oneBasedIndex - 1;
          if (!seen.has(zeroBased)) {
            seen.add(zeroBased);
            indices.push(zeroBased);
          }
        };

        if (token.includes("-")) {
          const [startRaw, endRaw] = token.split("-", 2).map((part) => part.trim());
          if (!startRaw || !endRaw) {
            throw new Error(`Invalid range format: "${token}"`);
          }
          const start = Number(startRaw);
          const end = Number(endRaw);
          const step = start <= end ? 1 : -1;
          for (let idx = start; step > 0 ? idx <= end : idx >= end; idx += step) {
            addIndex(idx);
          }
        } else {
          addIndex(Number(token));
        }
      }
    }

    result.indices = indices.length > 0 ? indices : null;
  }

  return result;
}

function printBatchList(batches: TestBatch[]): void {
  console.log("Available test batches:\n");
  batches.forEach((batch, idx) => {
    const number = String(idx + 1).padStart(2, " ");
    console.log(`${number}. ${batch.name}`);
    console.log(`    Description: ${batch.description}`);
    console.log(`    Patterns:   ${batch.patterns.join(", ")}`);
    if (batch.sequential) {
      console.log("    Notes:      Sequential (runs alone)");
    }
    console.log("");
  });
}

let CLI_OPTIONS: CliOptions;
try {
  CLI_OPTIONS = parseCliOptions(Deno.args);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ ${message}`);
  Deno.exit(1);
}

if (CLI_OPTIONS.list) {
  printBatchList(TEST_BATCHES);
  Deno.exit(0);
}

interface TestTiming {
  name: string;
  file: string;
  duration: number; // in milliseconds
  type: "file" | "test";
}

interface TestResult {
  batch: string;
  success: boolean;
  duration: number;
  output?: string;
  error?: string;
  retries: number;
  memoryPeak?: number;
  timings?: TestTiming[];
}

interface BatchOptions {
  retry?: number;
}

/**
 * Parse duration string to milliseconds
 */
function parseDuration(str: string): number {
  const match = str.match(/(\d+(?:\.\d+)?)(ms|s)/);
  if (!match || !match[1]) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2];
  return unit === "s" ? value * 1000 : value;
}

/**
 * Strip ANSI color codes from text
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Parse test timings from test output
 */
function parseTestTimings(output: string): TestTiming[] {
  const timings: TestTiming[] = [];
  const lines = output.split("\n");
  let currentFile = "";

  for (const line of lines) {
    const cleanLine = stripAnsi(line);

    // Match file declaration: "running N test from ./src/.../file.test.ts"
    const fileDeclaration = cleanLine.match(/^running \d+ tests? from \.\/(.+\.test\.ts)/);
    if (fileDeclaration && fileDeclaration[1]) {
      currentFile = fileDeclaration[1];
      continue;
    }

    // Match test/suite results with timing: "  test name ... ok (5s)"
    const resultMatch = cleanLine.match(/^(\s*)(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s+\(([^)]+)\)/);
    if (resultMatch && resultMatch[1] !== undefined && resultMatch[2] && resultMatch[3] && resultMatch[4]) {
      const indent = resultMatch[1];
      const name = resultMatch[2];
      const status = resultMatch[3];
      const duration = resultMatch[4];

      // Ignore "ignored" tests
      if (status === "ignored") continue;

      const durationMs = parseDuration(duration);
      const trimmedName = name.trim();

      // Determine if this is a file-level result or individual test
      // File-level results typically have the filename or are less indented
      const isFileLevelResult = indent.length <= 2 && currentFile &&
        (trimmedName === currentFile.split("/").pop()?.replace(".test.ts", "") ||
         trimmedName.includes(currentFile.split("/").pop()?.split(".")[0] || ""));

      if (isFileLevelResult && currentFile) {
        // This is the overall file result
        timings.push({
          name: currentFile.split("/").pop() || currentFile,
          file: currentFile,
          duration: durationMs,
          type: "file",
        });
      } else if (currentFile && durationMs > 0) {
        // This is an individual test or suite
        timings.push({
          name: trimmedName,
          file: currentFile,
          duration: durationMs,
          type: "test",
        });
      }
    }
  }

  return timings;
}

/**
 * Run a single test batch in an isolated worker process
 */
async function runBatch(
  batch: TestBatch,
  options: BatchOptions = {},
): Promise<TestResult> {
  const retryCount = options.retry || 0;
  const retryLabel = retryCount > 0 ? ` (retry ${retryCount})` : "";

  // Resource monitoring - track FDs before batch starts (optional, requires --unstable)
  let fdCountBefore: number | undefined;
  try {
    const resourcesBefore = (Deno as any).resources?.();
    if (resourcesBefore) {
      fdCountBefore = Object.keys(resourcesBefore).length;
    }
  } catch {
    // Deno.resources() not available - skip FD monitoring
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Running batch: ${batch.name}${retryLabel}`);
  console.log(`Description: ${batch.description}`);
  console.log(`Patterns: ${batch.patterns.join(", ")}`);
  console.log(`Memory limit: ${MEMORY_LIMIT_MB}MB`);
  console.log(`Timeout: ${Math.round(TEST_TIMEOUT_MS / 1000)}s`);
  console.log(`Resource type: ${batch.resourceType || "untagged"}`);
  if (fdCountBefore !== undefined) {
    console.log(`Open file descriptors: ${fdCountBefore}`);
  }
  console.log("=".repeat(60));

  const start = performance.now();

  try {
    // Phase 6: Per-batch memory allocation for better GC performance
    const memoryLimit = MEMORY_LIMITS[batch.resourceType || 'integration'];

    // Phase 6: V8 concurrent recompilation for faster JIT compilation
    const v8Flags = [
      `--max-old-space-size=${memoryLimit}`,
      `--concurrent-recompilation`,
      `--concurrent-recompilation-queue-length=12`,
    ].join(',');

    const args = [
      "test",
      "--allow-all",
      "--config",
      CONFIG,
      "--no-check",
      `--v8-flags=${v8Flags}`,
      ...batch.patterns, // Spread patterns as separate arguments
    ];

    // Add extra args if provided (e.g., --ignore flags)
    if (batch.extraArgs) {
      args.push(...batch.extraArgs);
    }

    // Prepare environment variables (merge with existing env)
    // DENO_JOBS env var controls test concurrency (no CLI flag needed)
    // VF_DISABLE_LRU_INTERVAL prevents LRU caches from starting cleanup intervals in tests
    // VF_CACHE_NAMESPACE isolates cache state between concurrent test batches
    const batchId = `batch_${batch.name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const env = {
      ...Deno.env.toObject(),
      VF_DISABLE_LRU_INTERVAL: "1",
      VF_CACHE_NAMESPACE: batchId,
      ...batch.env,
    };

    // Use "inherit" for verbose batches to avoid pipe buffer deadlock
    // RSC tests produce extensive logging that can fill pipe buffers
    const useInherit = batch.name === "Server - RSC";

    const command = new Deno.Command("deno", {
      args,
      stdin: "null", // Prevent subprocess from reading stdin (could cause hangs)
      stdout: useInherit ? "inherit" : "piped",
      stderr: useInherit ? "inherit" : "piped",
      env,
    });

    let process;
    try {
      process = command.spawn();
    } catch (spawnErr) {
      console.error(`❌ Failed to spawn subprocess for batch "${batch.name}":`, spawnErr);
      throw spawnErr;
    }

    // Add timeout to prevent indefinite hangs
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Test batch timeout after ${TEST_TIMEOUT_MS}ms - likely leaked resources (HTTP servers, file handles, etc.)`,
          ),
        );
      }, TEST_TIMEOUT_MS);
    });

    let result;
    try {
      result = await Promise.race([
        process.output(),
        timeoutPromise,
      ]);
    } catch (err) {
      // Timeout occurred - kill the process
      console.error(`⚠️  Batch "${batch.name}" timed out, killing subprocess...`);
      try {
        process.kill("SIGKILL");
        // Wait a bit for cleanup
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (killErr) {
        console.error(`Failed to kill subprocess:`, killErr);
      }
      throw err;
    } finally {
      // Always clear the timeout to prevent it from firing after process completes
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    const code = result.code;
    const stdout = useInherit ? undefined : result.stdout;
    const stderr = useInherit ? undefined : result.stderr;

    const duration = performance.now() - start;

    // When using "inherit" mode, stdout/stderr are empty (already printed to parent)
    const output = stdout ? new TextDecoder().decode(stdout) : "";
    const error = stderr ? new TextDecoder().decode(stderr) : "";

    // Parse test timings from output (skip if using inherit mode)
    const timings = useInherit ? [] : parseTestTimings(output);

    // Check for OOM error
    const isOOM = error.includes("out of memory") || error.includes("heap limit");

    // Print output (only if piped, inherit mode already printed it)
    if (!useInherit) {
      console.log(output);
      if (error && !isOOM) {
        console.error(error);
      }
    }

    const success = code === 0;

    // Resource monitoring - track FDs after batch completes (optional, requires --unstable)
    let fdCountAfter: number | undefined;
    let fdDelta: number | undefined;
    let fdWarning = "";
    try {
      const resourcesAfter = (Deno as any).resources?.();
      if (resourcesAfter && fdCountBefore !== undefined) {
        fdCountAfter = Object.keys(resourcesAfter).length;
        fdDelta = fdCountAfter - fdCountBefore;
        fdWarning = fdCountAfter > 180 ? " ⚠️  HIGH FD COUNT" : "";
      }
    } catch {
      // Deno.resources() not available - skip FD monitoring
    }

    if (success) {
      console.log(`✅ Batch "${batch.name}" passed in ${Math.round(duration)}ms`);
      if (fdCountBefore !== undefined && fdCountAfter !== undefined && fdDelta !== undefined) {
        console.log(`   FDs: ${fdCountBefore} → ${fdCountAfter} (${fdDelta >= 0 ? "+" : ""}${fdDelta})${fdWarning}`);
      }
    } else if (isOOM && retryCount < MAX_RETRIES) {
      console.warn(`⚠️  Batch "${batch.name}" OOM - will retry with lower concurrency`);
      // Wait longer before retry
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS * 2));
      return runBatch(batch, { retry: retryCount + 1 });
    } else {
      console.error(`❌ Batch "${batch.name}" failed in ${Math.round(duration)}ms`);
      if (fdCountBefore !== undefined && fdCountAfter !== undefined && fdDelta !== undefined) {
        console.log(`   FDs: ${fdCountBefore} → ${fdCountAfter} (${fdDelta >= 0 ? "+" : ""}${fdDelta})${fdWarning}`);
      }
    }

    return {
      batch: batch.name,
      success,
      duration,
      output: success ? undefined : output,
      error: success ? undefined : error,
      retries: retryCount,
      timings,
    };
  } catch (err) {
    const duration = performance.now() - start;
    console.error(`❌ Batch "${batch.name}" crashed:`, err);

    return {
      batch: batch.name,
      success: false,
      duration,
      error: String(err),
      retries: retryCount,
    };
  }
}

/**
 * Run batches with controlled concurrency using a worker pool
 * Sequential batches cannot run concurrently with each other (e.g., Server tests that compete for ports)
 */
async function runBatchesWithConcurrency(
  batches: TestBatch[],
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Smart batch ordering: Run fast tests first for better parallelization
  // Priority: unit tests (fastest) → integration tests → server tests (slowest, sequential)
  const resourceTypePriority = { "unit": 1, "integration": 2, "server": 3 };
  const sortedBatches = [...batches].sort((a, b) => {
    const priorityA = resourceTypePriority[a.resourceType || "integration"];
    const priorityB = resourceTypePriority[b.resourceType || "integration"];
    return priorityA - priorityB;
  });

  const queue = sortedBatches;
  const running = new Map<Promise<TestResult>, TestBatch>();
  let sequentialBatchRunning = false;
  let completedBatches = 0;

  while (queue.length > 0 || running.size > 0) {
    // Use full concurrency - resource monitoring will catch issues
    const effectiveMaxConcurrency = MAX_CONCURRENT_BATCHES;

    // Start new batches up to concurrency limit
    while (queue.length > 0 && running.size < effectiveMaxConcurrency) {
      const batch = queue[0]; // Peek at next batch
      if (!batch) break;

      // If this is a sequential batch, only start it if no other sequential batch is running
      if (batch.sequential && sequentialBatchRunning) {
        break; // Wait for current sequential batch to finish
      }

      // If a sequential batch is queued but we're running non-sequential batches, wait
      if (batch.sequential && running.size > 0) {
        break; // Wait for all current batches to finish before starting sequential batch
      }

      // Remove from queue and start
      queue.shift();

      if (batch.sequential) {
        sequentialBatchRunning = true;
      }

      const promise = runBatch(batch).then((result) => {
        running.delete(promise);
        if (batch.sequential) {
          sequentialBatchRunning = false;
        }
        results.push(result);
        completedBatches++;
        return result;
      });
      running.set(promise, batch);

      // Small stagger between starting batches
      if (queue.length > 0 && !batch.sequential) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Wait for at least one batch to complete
    if (running.size > 0) {
      await Promise.race(Array.from(running.keys()));

      // Longer delay after sequential batches (server tests need more cleanup time)
      const anySequential = Array.from(running.values()).some((b) => b.sequential);
      const delay = anySequential ? BATCH_DELAY_MS * 1.5 : BATCH_DELAY_MS; // Phase 5: Reduced multiplier from 2 to 1.5

      await new Promise((resolve) => setTimeout(resolve, delay));

      // Log progress every 10 batches to help diagnose issues
      if (completedBatches % 10 === 0 && completedBatches > 0) {
        console.log(`📊 Progress: ${completedBatches} batches completed, ${queue.length} remaining`);
      }
    }
  }

  return results;
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms.toFixed(0)}ms`;
}

/**
 * Analyze and report slow tests from all batches
 */
function reportSlowTests(results: TestResult[]): void {
  // Collect all timings with batch info
  interface TimingWithBatch extends TestTiming {
    batch: string;
  }

  const allTimings: TimingWithBatch[] = [];
  for (const result of results) {
    if (result.timings) {
      for (const timing of result.timings) {
        allTimings.push({ ...timing, batch: result.batch });
      }
    }
  }

  if (allTimings.length === 0) {
    return; // No timing data collected
  }

  // Sort by duration (slowest first)
  allTimings.sort((a, b) => b.duration - a.duration);

  // Report slowest test files
  console.log("\n" + "=".repeat(60));
  console.log("🐌 Slowest Test Files (Top 15)");
  console.log("=".repeat(60));

  const slowestFiles = allTimings
    .filter((t) => t.type === "file")
    .slice(0, 15);

  if (slowestFiles.length > 0) {
    for (let i = 0; i < slowestFiles.length; i++) {
      const timing = slowestFiles[i];
      if (!timing) continue;
      const rank = `${i + 1}`.padStart(2, " ");
      const duration = formatDuration(timing.duration).padStart(10);
      console.log(`${rank}. ${duration} - ${timing.file}`);
      console.log(`    Batch: ${timing.batch}`);
    }
  } else {
    console.log("No file timings collected");
  }

  // Report files over 5 seconds
  const slowFiles = allTimings.filter((t) => t.type === "file" && t.duration >= 5000);
  if (slowFiles.length > 0) {
    console.log("\n" + "=".repeat(60));
    console.log("⚠️  Test Files Over 5 Seconds (Optimization Candidates)");
    console.log("=".repeat(60));

    for (const timing of slowFiles) {
      const duration = formatDuration(timing.duration).padStart(10);
      console.log(`${duration} - ${timing.file}`);
      console.log(`           Batch: ${timing.batch}`);

      // Show slow individual tests within this file
      const testsInFile = allTimings.filter(
        (t) => t.file === timing.file && t.type === "test" && t.duration >= 1000,
      );
      if (testsInFile.length > 0) {
        console.log(`           Slow tests in file:`);
        for (const test of testsInFile) {
          console.log(`             ${formatDuration(test.duration)} - ${test.name}`);
        }
      }
      console.log();
    }
  }

  // Report individual tests over 3 seconds
  const slowTests = allTimings.filter((t) => t.type === "test" && t.duration >= 3000);
  if (slowTests.length > 0) {
    console.log("\n" + "=".repeat(60));
    console.log("⚠️  Individual Tests Over 3 Seconds");
    console.log("=".repeat(60));

    for (const timing of slowTests) {
      const duration = formatDuration(timing.duration).padStart(10);
      console.log(`${duration} - ${timing.name}`);
      console.log(`           File: ${timing.file}`);
      console.log(`           Batch: ${timing.batch}`);
      console.log();
    }
  }

  // Summary statistics
  const fileTimings = allTimings.filter((t) => t.type === "file");
  const testTimings = allTimings.filter((t) => t.type === "test");
  const totalFileTime = fileTimings.reduce((sum, t) => sum + t.duration, 0);
  const avgFileTime = fileTimings.length > 0 ? totalFileTime / fileTimings.length : 0;

  console.log("\n" + "=".repeat(60));
  console.log("📈 Timing Statistics");
  console.log("=".repeat(60));
  console.log(`Total test files analyzed: ${fileTimings.length}`);
  console.log(`Total individual tests: ${testTimings.length}`);
  console.log(`Average file execution time: ${formatDuration(avgFileTime)}`);
  console.log(`Files over 5s: ${slowFiles.length}`);
  console.log(`Tests over 3s: ${slowTests.length}`);
}

async function main() {
  const batchesToRun = CLI_OPTIONS.indices
    ? CLI_OPTIONS.indices.map((index) => TEST_BATCHES[index]).filter((b): b is TestBatch => b !== undefined)
    : TEST_BATCHES;

  if (batchesToRun.length === 0) {
    console.error("❌ No batches selected. Use --list to view available batches.");
    Deno.exit(1);
  }

  console.log("🧪 Veryfront Test Runner - Batch Mode with Worker Pool");
  console.log(`Running ${batchesToRun.length} test batch${batchesToRun.length === 1 ? "" : "es"}`);
  if (CLI_OPTIONS.indices) {
    const names = CLI_OPTIONS.indices
      .map((index) => {
        const batch = TEST_BATCHES[index];
        return batch ? `${index + 1}. ${batch.name}` : null;
      })
      .filter((name): name is string => name !== null);
    console.log(`Selected batches: ${names.join(", ")}`);
  }
  console.log(`Max concurrent batches: ${MAX_CONCURRENT_BATCHES}`);
  console.log(`Memory limit per batch: ${MEMORY_LIMIT_MB}MB`);
  console.log(
    `Test timeout per batch: ${TEST_TIMEOUT_MS}ms (${
      Math.round(TEST_TIMEOUT_MS / 1000 / 60)
    } minutes)`,
  );
  console.log(`Max retries on OOM: ${MAX_RETRIES}`);
  console.log(`Delay between batches: ${BATCH_DELAY_MS}ms\n`);

  const startTime = performance.now();

  const results = await runBatchesWithConcurrency(batchesToRun);

  const totalDuration = performance.now() - startTime;

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Test Summary");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);

  console.log(`Total batches: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`🔄 Total retries: ${totalRetries}`);
  console.log(`⏱️  Total time: ${Math.round(totalDuration / 1000)}s\n`);

  // Details for failed batches
  if (failed > 0) {
    console.log("Failed batches:");
    for (const result of results.filter((r) => !r.success)) {
      console.log(
        `  - ${result.batch} (${Math.round(result.duration)}ms, ${result.retries} retries)`,
      );
      if (result.error) {
        const errorPreview = result.error.substring(0, 200);
        console.log(`    Error: ${errorPreview}${result.error.length > 200 ? "..." : ""}`);
      }
    }
    console.log();
  }

  // Report slow tests
  reportSlowTests(results);

  // Exit with error if any batch failed
  Deno.exit(failed > 0 ? 1 : 0);
}

if (import.meta.main) {
  main();
}
