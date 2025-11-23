#!/usr/bin/env -S deno run --allow-read --allow-run --allow-env
/**
 * Test Timing Analyzer
 *
 * Analyzes test execution times to identify slow tests that need optimization.
 *
 * Usage:
 *   deno run --allow-read --allow-run --allow-env scripts/analyze-test-timings.ts [batch-number]
 *   deno run --allow-read --allow-run --allow-env scripts/analyze-test-timings.ts --all
 *
 * Examples:
 *   scripts/analyze-test-timings.ts 8           # Analyze batch 8 only
 *   scripts/analyze-test-timings.ts --all       # Analyze all batches
 *   scripts/analyze-test-timings.ts             # Analyze all batches (default)
 */

interface TestResult {
  name: string;
  file: string;
  duration: number; // in milliseconds
  type: "file" | "test" | "step";
}

interface TestStats {
  name: string;
  file: string;
  duration: number;
  batch: string;
  type: "file" | "test" | "step";
}

const BATCHES: Array<{ name: string; pattern: string; env: Record<string, string> }> = [
  {
    name: "Build",
    pattern: "tests/integration/build/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Adapters",
    pattern: "tests/integration/adapters/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Core & Config",
    pattern: "tests/integration/core/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "CLI",
    pattern: "tests/integration/cli/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Rendering",
    pattern: "tests/integration/{render,rendering}/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Client & Router",
    pattern: "tests/integration/client/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Data Fetching",
    pattern: "tests/integration/data/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Server - Universal",
    pattern: "tests/integration/server/universal/**/*.test.ts",
    env: { VERYFRONT_EXPERIMENTAL_RSC: "1" },
  },
  {
    name: "Server - Core",
    pattern: "tests/integration/server/{dev-server,hmr-server,build-routes,build-service-worker,build}/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Server - Modules",
    pattern: "tests/integration/server/modules/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Server - RSC",
    pattern: "tests/integration/server/rsc/**/*.test.ts",
    env: { VERYFRONT_EXPERIMENTAL_RSC: "1" },
  },
  {
    name: "Renderer",
    pattern: "tests/integration/renderer/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "RSC Dev",
    pattern: "tests/integration/rsc/**/*.test.ts",
    env: { VERYFRONT_EXPERIMENTAL_RSC: "1" },
  },
  {
    name: "Routing",
    pattern: "tests/integration/routing/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Runtime",
    pattern: "tests/integration/runtime/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "SDK",
    pattern: "tests/integration/sdk/**/*.test.ts",
    env: {} as Record<string, string>,
  },
  {
    name: "Transforms",
    pattern: "tests/integration/transforms/**/*.test.ts",
    env: {} as Record<string, string>,
  },
];

function parseDuration(str: string): number {
  // Parse formats like "5s", "1.2s", "500ms", "(5s)", "[5s]"
  const match = str.match(/(\d+(?:\.\d+)?)(ms|s)/);
  if (!match || !match[1]) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2];

  return unit === "s" ? value * 1000 : value;
}

async function runTestsWithTiming(
  pattern: string,
  batchEnv: Record<string, string>,
): Promise<TestResult[]> {
  const env = {
    ...Deno.env.toObject(),
    VF_DISABLE_LRU_INTERVAL: "1",
    ...batchEnv,
  };

  const cmd = new Deno.Command("deno", {
    args: [
      "test",
      "--allow-all",
      "--unstable-temporal",
      pattern,
    ],
    env,
    stdout: "piped",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const { stdout, stderr } = await process.output();
  const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);

  const results: TestResult[] = [];
  const lines = output.split("\n");

  let currentFile = "";

  for (const line of lines) {
    // Match file execution lines like:
    // "tests/integration/server/universal/api.test.ts ... ok (5s)"
    const fileMatch = line.match(/^(src\/.*\.test\.ts)\s+\.\.\.\s+(ok|FAILED)\s+\(([^)]+)\)/);
    if (fileMatch && fileMatch[1] && fileMatch[3]) {
      const file = fileMatch[1];
      const duration = fileMatch[3];
      currentFile = file;
      const durationMs = parseDuration(duration);
      results.push({
        name: file.split("/").pop() || file,
        file,
        duration: durationMs,
        type: "file",
      });
      continue;
    }

    // Match test execution lines like:
    // "    handles GET /api/test ... ok (50ms)"
    // "    handles GET /api/test ... ok (1.2s)"
    const testMatch = line.match(/^\s{2,}(.+?)\s+\.\.\.\s+(ok|FAILED)\s+\(([^)]+)\)/);
    if (testMatch && testMatch[1] && testMatch[3]) {
      const name = testMatch[1];
      const duration = testMatch[3];
      const durationMs = parseDuration(duration);
      results.push({
        name: name.trim(),
        file: currentFile || "unknown",
        duration: durationMs,
        type: "test",
      });
      continue;
    }

    // Match step execution lines like:
    // "      step 1 ... ok (10ms)"
    const stepMatch = line.match(/^\s{4,}(.+?)\s+\.\.\.\s+(ok|FAILED)\s+\(([^)]+)\)/);
    if (stepMatch && stepMatch[1] && stepMatch[3]) {
      const name = stepMatch[1];
      const duration = stepMatch[3];
      const durationMs = parseDuration(duration);
      results.push({
        name: `  └─ ${name.trim()}`,
        file: currentFile || "unknown",
        duration: durationMs,
        type: "step",
      });
    }
  }

  return results;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms.toFixed(0)}ms`;
}

function analyzeResults(allResults: Map<string, TestResult[]>) {
  const allTests: TestStats[] = [];

  // Collect all test stats
  for (const [batch, results] of allResults.entries()) {
    for (const test of results) {
      allTests.push({
        name: test.name,
        file: test.file,
        duration: test.duration,
        batch,
        type: test.type,
      });
    }
  }

  // Sort by duration (slowest first)
  allTests.sort((a, b) => b.duration - a.duration);

  // Print top 30 slowest items (files or tests)
  console.log("\n" + "=".repeat(80));
  console.log("TOP 30 SLOWEST TESTS");
  console.log("=".repeat(80));

  const top30 = allTests.filter((t) => t.type !== "step").slice(0, 30);
  for (let i = 0; i < top30.length; i++) {
    const test = top30[i];
    if (!test) continue;
    const rank = `${i + 1}`.padStart(2, " ");
    const duration = formatDuration(test.duration).padStart(10);
    const typeLabel = test.type === "file" ? "[FILE]" : "[TEST]";

    console.log(`${rank}. ${duration} ${typeLabel} ${test.name}`);
    if (test.type === "test") {
      console.log(`    File: ${test.file}`);
    }
    console.log(`    Batch: ${test.batch}`);
    console.log();
  }

  // Print statistics by batch
  console.log("\n" + "=".repeat(80));
  console.log("STATISTICS BY BATCH");
  console.log("=".repeat(80));

  for (const [batch, results] of allResults.entries()) {
    const fileResults = results.filter((r) => r.type === "file");
    const totalDuration = fileResults.reduce((sum, test) => sum + test.duration, 0);
    const avgDuration = fileResults.length > 0 ? totalDuration / fileResults.length : 0;
    const slowest = fileResults.reduce(
      (max, test) => (test.duration > (max?.duration || 0) ? test : max),
      fileResults[0],
    );

    console.log(`\n${batch}:`);
    console.log(`  Total files: ${fileResults.length}`);
    console.log(`  Total time: ${formatDuration(totalDuration)}`);
    console.log(`  Average per file: ${formatDuration(avgDuration)}`);
    if (slowest) {
      console.log(`  Slowest file: ${formatDuration(slowest.duration)} - ${slowest.name}`);
    }
  }

  // Print files over threshold
  console.log("\n" + "=".repeat(80));
  console.log("TEST FILES OVER 5 SECONDS (Optimization Candidates)");
  console.log("=".repeat(80));

  const slowFiles = allTests.filter((t) => t.type === "file" && t.duration >= 5000);
  if (slowFiles.length === 0) {
    console.log("\nNo test files over 5 seconds found. Good job! 🎉");
  } else {
    for (const test of slowFiles) {
      const duration = formatDuration(test.duration).padStart(10);
      console.log(`${duration} - ${test.file}`);
      console.log(`           Batch: ${test.batch}`);

      // Show individual tests within this file
      const testsInFile = allTests.filter(
        (t) => t.file === test.file && t.type === "test" && t.duration >= 1000,
      );
      if (testsInFile.length > 0) {
        console.log(`           Slow tests in file:`);
        for (const slowTest of testsInFile) {
          console.log(`             ${formatDuration(slowTest.duration)} - ${slowTest.name}`);
        }
      }
      console.log();
    }
  }

  // Print individual tests over threshold
  console.log("\n" + "=".repeat(80));
  console.log("INDIVIDUAL TESTS OVER 3 SECONDS");
  console.log("=".repeat(80));

  const slowIndividualTests = allTests.filter((t) => t.type === "test" && t.duration >= 3000);
  if (slowIndividualTests.length === 0) {
    console.log("\nNo individual tests over 3 seconds found. Excellent! 🎉");
  } else {
    for (const test of slowIndividualTests) {
      const duration = formatDuration(test.duration).padStart(10);
      console.log(`${duration} - ${test.name}`);
      console.log(`           File: ${test.file}`);
      console.log(`           Batch: ${test.batch}`);
      console.log();
    }
  }
}

async function main() {
  const args = Deno.args;
  const batchArg = args[0];

  let batchesToRun: Array<{ name: string; pattern: string; env: Record<string, string> }>;

  if (batchArg && batchArg !== "--all") {
    const batchIndex = parseInt(batchArg, 10) - 1;
    if (batchIndex < 0 || batchIndex >= BATCHES.length) {
      console.error(`Invalid batch number. Must be between 1 and ${BATCHES.length}`);
      Deno.exit(1);
    }
    const batch = BATCHES[batchIndex];
    if (!batch) {
      console.error(`Invalid batch number. Must be between 1 and ${BATCHES.length}`);
      Deno.exit(1);
    }
    batchesToRun = [batch];
    console.log(`Analyzing test timings for batch ${batchArg}: ${batch.name}...\n`);
  } else {
    batchesToRun = BATCHES;
    console.log("Analyzing test timings for all batches...\n");
  }

  const allResults = new Map<string, TestResult[]>();

  for (const batch of batchesToRun) {
    console.log(`Running batch: ${batch.name}...`);

    try {
      const results = await runTestsWithTiming(batch.pattern, batch.env);
      const fileResults = results.filter((r) => r.type === "file");
      allResults.set(batch.name, results);
      console.log(`  ✓ Completed ${batch.name}: ${fileResults.length} test files\n`);
    } catch (error) {
      console.error(`  ✗ Failed ${batch.name}:`, error);
    }
  }

  analyzeResults(allResults);
}

if (import.meta.main) {
  await main();
}
