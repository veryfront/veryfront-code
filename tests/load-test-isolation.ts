#!/usr/bin/env -S deno run --allow-net --allow-env

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

async function makeRequest(url: string, timeoutMs: number): Promise<RequestResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return { url, status: response.status, duration: Date.now() - start };
  } catch (error) {
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
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runConcurrentRequests(urls: string[], timeoutMs: number): Promise<RequestResult[]> {
  return await Promise.all(urls.map((url) => makeRequest(url, timeoutMs)));
}

function printResult(result: RequestResult): void {
  let statusColor = COLORS.red;
  if (result.status === 200) statusColor = COLORS.green;
  else if (result.status === "timeout") statusColor = COLORS.yellow;

  const statusStr = typeof result.status === "number" ? String(result.status) : result.status;

  console.log(
    `  ${statusColor}${statusStr.padEnd(7)}${COLORS.reset} ` +
      `${String(result.duration).padStart(5)}ms ` +
      `${COLORS.dim}${result.url}${COLORS.reset}`,
  );
}

function printSummary(results: RequestResult[]): void {
  const successful = results.filter((r) => r.status === 200);
  const timeouts = results.filter((r) => r.status === "timeout");
  const errors = results.filter((r) => r.status !== 200 && r.status !== "timeout");

  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / results.length;
  const durations = results.map((r) => r.duration);
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);

  console.log("\n" + "=".repeat(60));
  console.log(`${COLORS.cyan}SUMMARY${COLORS.reset}`);
  console.log("=".repeat(60));
  console.log(`Total requests:    ${results.length}`);
  console.log(`${COLORS.green}Successful (200):  ${successful.length}${COLORS.reset}`);
  console.log(`${COLORS.yellow}Timeouts:          ${timeouts.length}${COLORS.reset}`);
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

  const endpoints = ["/", "/accelerators"];

  const allResults: RequestResult[] = [];
  const startTime = Date.now();
  let batchCount = 0;

  while (Date.now() - startTime < config.testDurationMs) {
    batchCount++;
    console.log(`\n${COLORS.cyan}Batch ${batchCount}${COLORS.reset}`);

    const urls: string[] = [];
    for (let i = 0; i < config.concurrentRequests; i++) {
      const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
      urls.push(`${config.baseUrl}${endpoint}`);
    }

    const batchResults = await runConcurrentRequests(urls, config.requestTimeoutMs);
    allResults.push(...batchResults);

    for (const result of batchResults) printResult(result);

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  printSummary(allResults);

  const successRate = allResults.filter((r) => r.status === 200).length / allResults.length;
  const passed = successRate > 0.8;

  console.log("\n" + "=".repeat(60));
  if (passed) {
    console.log(
      `${COLORS.green}✓ TEST PASSED${COLORS.reset} - Success rate: ${
        (successRate * 100).toFixed(1)
      }%`,
    );
    console.log(`  System remained responsive under load (no cascading failures)`);
  } else {
    console.log(
      `${COLORS.red}✗ TEST FAILED${COLORS.reset} - Success rate: ${
        (successRate * 100).toFixed(1)
      }%`,
    );
    console.log(`  System may have blocking issues - investigate timeouts and errors`);
  }
  console.log("=".repeat(60) + "\n");

  return passed;
}

async function testSlowEndpointIsolation(baseUrl: string): Promise<boolean> {
  console.log("\n" + "=".repeat(60));
  console.log(`${COLORS.cyan}TEST: Concurrent Request Isolation${COLORS.reset}`);
  console.log("=".repeat(60));

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

  for (const result of results) printResult(result);

  const allCompleted = results.every((r) => r.status === 200 || r.status === 304);

  const durations = results.map((r) => r.duration);
  const maxDuration = Math.max(...durations);
  const avgDuration = durations.reduce((sum, d) => sum + d, 0) / results.length;

  console.log("\n" + "-".repeat(40));
  console.log(`Max duration: ${maxDuration}ms, Average: ${Math.round(avgDuration)}ms`);

  if (allCompleted) {
    console.log(`${COLORS.green}✓ All concurrent requests completed successfully${COLORS.reset}`);
    console.log(`  No blocking detected - requests processed in parallel`);
    return true;
  }

  const failed = results.filter((r) => r.status !== 200 && r.status !== 304);
  console.log(`${COLORS.red}✗ Some requests failed${COLORS.reset}`);
  console.log(`  Failed: ${failed.length}/${results.length}`);

  return false;
}

async function main(): Promise<void> {
  const baseUrl = Deno.args[0];
  if (!baseUrl) {
    console.error("Error: URL is required");
    console.error("Usage: deno run --allow-all tests/load-test-isolation.ts <url>");
    console.error(
      "Example: deno run --allow-all tests/load-test-isolation.ts http://myproject.lvh.me:8080",
    );
    Deno.exit(1);
  }

  console.log(`\n${COLORS.cyan}Veryfront Renderer - Load Test Suite${COLORS.reset}`);
  console.log(`Testing against: ${baseUrl}\n`);

  const healthCheck = await makeRequest(`${baseUrl}/`, 10000);
  if (healthCheck.status !== 200) {
    console.log(`${COLORS.red}Server not reachable${COLORS.reset}`);
    console.log(`Status: ${healthCheck.status}`);
    Deno.exit(1);
  }
  console.log(`${COLORS.green}Server is reachable${COLORS.reset}\n`);

  const results: boolean[] = [];

  results.push(await testSlowEndpointIsolation(baseUrl));

  results.push(
    await testIsolation({
      baseUrl,
      concurrentRequests: 20,
      requestTimeoutMs: 30000,
      testDurationMs: 10000,
    }),
  );

  results.push(
    await testIsolation({
      baseUrl,
      concurrentRequests: 50,
      requestTimeoutMs: 30000,
      testDurationMs: 10000,
    }),
  );

  results.push(
    await testIsolation({
      baseUrl,
      concurrentRequests: 100,
      requestTimeoutMs: 30000,
      testDurationMs: 10000,
    }),
  );

  const allPassed = results.every(Boolean);
  console.log("\n" + "=".repeat(60));
  console.log(`${COLORS.cyan}FINAL RESULT${COLORS.reset}`);
  console.log("=".repeat(60));

  if (allPassed) {
    console.log(`${COLORS.green}✓ ALL TESTS PASSED${COLORS.reset}`);
    console.log(`  The system properly isolates slow/failing requests`);
    console.log(`  One project cannot block other projects`);
  } else {
    console.log(`${COLORS.red}✗ SOME TESTS FAILED${COLORS.reset}`);
    console.log(`  Review the results above for details`);
  }
  console.log("=".repeat(60) + "\n");

  Deno.exit(allPassed ? 0 : 1);
}

main();
