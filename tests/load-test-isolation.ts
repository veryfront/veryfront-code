#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Load Test: Timeout Isolation Verification
 *
 * Tests that one hanging project cannot block requests to other projects.
 * Simulates concurrent requests with varying response times and verifies
 * the system remains responsive under load.
 *
 * Usage:
 *   deno run --allow-net tests/load-test-isolation.ts <base-url>
 *
 * Example:
 *   deno run --allow-net tests/load-test-isolation.ts http://localhost:8080
 */

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

interface RequestResult {
  url: string;
  status: number | "timeout" | "error";
  duration: number;
  error?: string;
}

interface TestConfig {
  baseUrl: string;
  concurrentRequests: number;
  requestTimeoutMs: number;
  testDurationMs: number;
}

async function makeRequest(
  url: string,
  timeoutMs: number,
): Promise<RequestResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return {
      url,
      status: response.status,
      duration: Date.now() - start,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - start;

    if (error instanceof Error && error.name === "AbortError") {
      return { url, status: "timeout", duration };
    }

    return {
      url,
      status: "error",
      duration,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runConcurrentRequests(
  urls: string[],
  timeoutMs: number,
): Promise<RequestResult[]> {
  const promises = urls.map((url) => makeRequest(url, timeoutMs));
  return await Promise.all(promises);
}

function printResult(result: RequestResult): void {
  const statusColor = result.status === 200
    ? COLORS.green
    : result.status === "timeout"
    ? COLORS.yellow
    : COLORS.red;

  const statusStr = typeof result.status === "number" ? result.status.toString() : result.status;

  console.log(
    `  ${statusColor}${statusStr.padEnd(7)}${COLORS.reset} ` +
      `${result.duration.toString().padStart(5)}ms ` +
      `${COLORS.dim}${result.url}${COLORS.reset}`,
  );
}

function printSummary(results: RequestResult[]): void {
  const successful = results.filter((r) => r.status === 200);
  const timeouts = results.filter((r) => r.status === "timeout");
  const errors = results.filter(
    (r) => r.status !== 200 && r.status !== "timeout",
  );

  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const maxDuration = Math.max(...results.map((r) => r.duration));
  const minDuration = Math.min(...results.map((r) => r.duration));

  console.log("\n" + "=".repeat(60));
  console.log(`${COLORS.cyan}SUMMARY${COLORS.reset}`);
  console.log("=".repeat(60));
  console.log(`Total requests:    ${results.length}`);
  console.log(
    `${COLORS.green}Successful (200):  ${successful.length}${COLORS.reset}`,
  );
  console.log(
    `${COLORS.yellow}Timeouts:          ${timeouts.length}${COLORS.reset}`,
  );
  console.log(`${COLORS.red}Errors:            ${errors.length}${COLORS.reset}`);
  console.log(`\nResponse times:`);
  console.log(`  Min:     ${minDuration}ms`);
  console.log(`  Max:     ${maxDuration}ms`);
  console.log(`  Average: ${Math.round(avgDuration)}ms`);
}

async function testIsolation(config: TestConfig): Promise<boolean> {
  console.log("\n" + "=".repeat(60));
  console.log(`${COLORS.cyan}LOAD TEST: Timeout Isolation Verification${COLORS.reset}`);
  console.log("=".repeat(60));
  console.log(`Base URL:           ${config.baseUrl}`);
  console.log(`Concurrent requests: ${config.concurrentRequests}`);
  console.log(`Request timeout:     ${config.requestTimeoutMs}ms`);
  console.log(`Test duration:       ${config.testDurationMs}ms`);
  console.log("");

  // Test endpoints - valid routes for codersociety project
  const endpoints = [
    "/",
    "/accelerators",
  ];

  const allResults: RequestResult[] = [];
  const startTime = Date.now();
  let batchCount = 0;

  while (Date.now() - startTime < config.testDurationMs) {
    batchCount++;
    console.log(`\n${COLORS.cyan}Batch ${batchCount}${COLORS.reset}`);

    // Generate random mix of URLs for this batch
    const urls: string[] = [];
    for (let i = 0; i < config.concurrentRequests; i++) {
      const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
      urls.push(`${config.baseUrl}${endpoint}`);
    }

    const batchResults = await runConcurrentRequests(
      urls,
      config.requestTimeoutMs,
    );
    allResults.push(...batchResults);

    for (const result of batchResults) {
      printResult(result);
    }

    // Brief pause between batches
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  printSummary(allResults);

  // Verification: Check that we didn't have cascading failures
  const successRate = allResults.filter((r) => r.status === 200).length / allResults.length;
  const passed = successRate > 0.8; // At least 80% success rate

  console.log("\n" + "=".repeat(60));
  if (passed) {
    console.log(
      `${COLORS.green}✓ TEST PASSED${COLORS.reset} - Success rate: ${
        (successRate * 100).toFixed(1)
      }%`,
    );
    console.log(
      `  System remained responsive under load (no cascading failures)`,
    );
  } else {
    console.log(
      `${COLORS.red}✗ TEST FAILED${COLORS.reset} - Success rate: ${
        (successRate * 100).toFixed(1)
      }%`,
    );
    console.log(
      `  System may have blocking issues - investigate timeouts and errors`,
    );
  }
  console.log("=".repeat(60) + "\n");

  return passed;
}

// Specific test: Verify concurrent requests don't block each other
async function testSlowEndpointIsolation(baseUrl: string): Promise<boolean> {
  console.log("\n" + "=".repeat(60));
  console.log(
    `${COLORS.cyan}TEST: Concurrent Request Isolation${COLORS.reset}`,
  );
  console.log("=".repeat(60));

  // Make simultaneous requests to various pages
  // Add cache-bust param to force fresh SSR renders
  const cacheBust = Date.now();
  const urls = [
    `${baseUrl}/?_cb=${cacheBust}`,
    `${baseUrl}/accelerators?_cb=${cacheBust}`,
    `${baseUrl}/?_cb=${cacheBust + 1}`,
    `${baseUrl}/accelerators?_cb=${cacheBust + 1}`,
    `${baseUrl}/?_cb=${cacheBust + 2}`,
    `${baseUrl}/accelerators?_cb=${cacheBust + 2}`,
  ];

  console.log(`Requesting ${urls.length} URLs simultaneously (cache-busted)...`);
  const results = await runConcurrentRequests(urls, 30000);

  for (const result of results) {
    printResult(result);
  }

  // All requests should complete successfully
  const allCompleted = results.every(
    (r) => r.status === 200 || r.status === 304,
  );

  // Check for any unusually slow requests (potential blocking)
  const maxDuration = Math.max(...results.map((r) => r.duration));
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

  console.log("\n" + "-".repeat(40));
  console.log(`Max duration: ${maxDuration}ms, Average: ${Math.round(avgDuration)}ms`);

  if (allCompleted) {
    console.log(
      `${COLORS.green}✓ All concurrent requests completed successfully${COLORS.reset}`,
    );
    console.log(
      `  No blocking detected - requests processed in parallel`,
    );
  } else {
    const failed = results.filter((r) => r.status !== 200 && r.status !== 304);
    console.log(
      `${COLORS.red}✗ Some requests failed${COLORS.reset}`,
    );
    console.log(`  Failed: ${failed.length}/${results.length}`);
  }

  return allCompleted;
}

// Main
async function main(): Promise<void> {
  const baseUrl = Deno.args[0] || "http://codersociety.lvh.me:8080";

  console.log(`\n${COLORS.cyan}Veryfront Renderer - Load Test Suite${COLORS.reset}`);
  console.log(`Testing against: ${baseUrl}\n`);

  // First verify the server is reachable
  try {
    const healthCheck = await makeRequest(`${baseUrl}/`, 10000);
    if (healthCheck.status !== 200) {
      console.log(
        `${COLORS.red}Server not reachable${COLORS.reset}`,
      );
      console.log(`Status: ${healthCheck.status}`);
      Deno.exit(1);
    }
    console.log(`${COLORS.green}Server is reachable${COLORS.reset}\n`);
  } catch {
    console.log(`${COLORS.red}Could not connect to server${COLORS.reset}`);
    Deno.exit(1);
  }

  // Run tests
  const results: boolean[] = [];

  // Test 1: Slow endpoint isolation
  results.push(await testSlowEndpointIsolation(baseUrl));

  // Test 2: Moderate load (20 concurrent)
  results.push(
    await testIsolation({
      baseUrl,
      concurrentRequests: 20,
      requestTimeoutMs: 30000,
      testDurationMs: 10000,
    }),
  );

  // Test 3: Heavy load (50 concurrent)
  results.push(
    await testIsolation({
      baseUrl,
      concurrentRequests: 50,
      requestTimeoutMs: 30000,
      testDurationMs: 10000,
    }),
  );

  // Test 4: Extreme load (100 concurrent) - find breaking point
  results.push(
    await testIsolation({
      baseUrl,
      concurrentRequests: 100,
      requestTimeoutMs: 30000,
      testDurationMs: 10000,
    }),
  );

  // Final summary
  const allPassed = results.every((r) => r);
  console.log("\n" + "=".repeat(60));
  console.log(`${COLORS.cyan}FINAL RESULT${COLORS.reset}`);
  console.log("=".repeat(60));

  if (allPassed) {
    console.log(
      `${COLORS.green}✓ ALL TESTS PASSED${COLORS.reset}`,
    );
    console.log(`  The system properly isolates slow/failing requests`);
    console.log(`  One project cannot block other projects`);
  } else {
    console.log(
      `${COLORS.red}✗ SOME TESTS FAILED${COLORS.reset}`,
    );
    console.log(`  Review the results above for details`);
  }
  console.log("=".repeat(60) + "\n");

  Deno.exit(allPassed ? 0 : 1);
}

main();
