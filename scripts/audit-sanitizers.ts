#!/usr/bin/env -S deno run --allow-read
/**
 * Sanitizer Audit Script
 *
 * Analyzes test files with disabled sanitizers and categorizes them:
 * - Legitimate (React SSR with MessagePort)
 * - Needs fixing (resource leaks)
 * - Unknown (requires investigation)
 *
 * Usage:
 *   deno run --allow-read scripts/audit-sanitizers.ts
 *   deno run --allow-read scripts/audit-sanitizers.ts --verbose
 */

import { walk } from "std/fs/walk.ts";

const VERBOSE = Deno.args.includes("--verbose");

interface TestFile {
  path: string;
  hasSanitizeResourcesDisabled: boolean;
  hasSanitizeOpsDisabled: boolean;
  category: "legitimate" | "needs-fixing" | "unknown";
  reason: string;
  lineNumber?: number;
}

const results: TestFile[] = [];

/**
 * Check if file content suggests it's a React SSR test
 */
function isReactSSRTest(content: string): boolean {
  const ssrIndicators = [
    "renderToString",
    "renderToStaticMarkup",
    "renderToPipeableStream",
    "renderToReadableStream",
    "React.renderToString",
    "SSR",
    "server-side rendering",
    "streaming",
    "MessagePort", // The actual reason for disabling sanitizers
  ];

  return ssrIndicators.some((indicator) => content.includes(indicator));
}

/**
 * Check if file has proper documentation for disabled sanitizers
 */
function hasProperDocumentation(content: string): boolean {
  const lines = content.split("\n");

  // Find the line with sanitize disable
  const disableLineIndex = lines.findIndex(
    (line) =>
      line.includes("sanitizeResources: false") ||
      line.includes("sanitizeOps: false"),
  );

  if (disableLineIndex === -1) return false;

  // Check 5 lines before for documentation
  const contextLines = lines.slice(
    Math.max(0, disableLineIndex - 5),
    disableLineIndex,
  ).join("\n");

  return (
    contextLines.includes("React 19") ||
    contextLines.includes("MessagePort") ||
    contextLines.includes("SSR") ||
    contextLines.includes("known issue")
  );
}

/**
 * Check for common resource leak patterns
 */
function hasResourceLeakPatterns(content: string): string[] {
  const leaks: string[] = [];

  // Pattern 1: renderer.destroy() without await
  if (/renderer\.destroy\(\)(?!\s*\.then)/.test(content) && !content.includes("await renderer.destroy()")) {
    leaks.push("renderer.destroy() called without await");
  }

  // Pattern 2: cleanupRenderer() without await
  if (/cleanupRenderer\(/.test(content) && !content.includes("await cleanupRenderer(")) {
    leaks.push("cleanupRenderer() called without await");
  }

  // Pattern 3: server.stop() without await
  if (/server\.stop\(\)(?!\s*\.then)/.test(content) && !content.includes("await server.stop()")) {
    leaks.push("server.stop() called without await");
  }

  // Pattern 4: Missing finally block for cleanup
  if (content.includes("createDevServer") || content.includes("createProductionServer")) {
    if (!content.includes("finally") && !content.includes("withTestContext")) {
      leaks.push("Server created without finally block or TestContext");
    }
  }

  // Pattern 5: fetch() without response.body?.cancel()
  if (content.includes("await fetch(") && !content.includes("response.body?.cancel()")) {
    leaks.push("Fetch responses may not be properly consumed");
  }

  return leaks;
}

/**
 * Categorize a test file
 */
function categorizeTest(path: string, content: string): TestFile {
  const hasSanitizeResourcesDisabled = content.includes("sanitizeResources: false");
  const hasSanitizeOpsDisabled = content.includes("sanitizeOps: false");

  if (!hasSanitizeResourcesDisabled && !hasSanitizeOpsDisabled) {
    // Not relevant for this audit
    return {
      path,
      hasSanitizeResourcesDisabled: false,
      hasSanitizeOpsDisabled: false,
      category: "unknown",
      reason: "No disabled sanitizers",
    };
  }

  // Check if it's a legitimate React SSR test
  if (isReactSSRTest(content) && hasProperDocumentation(content)) {
    return {
      path,
      hasSanitizeResourcesDisabled,
      hasSanitizeOpsDisabled,
      category: "legitimate",
      reason: "React SSR test with MessagePort (documented)",
    };
  }

  // Check for resource leak patterns
  const leakPatterns = hasResourceLeakPatterns(content);
  if (leakPatterns.length > 0) {
    return {
      path,
      hasSanitizeResourcesDisabled,
      hasSanitizeOpsDisabled,
      category: "needs-fixing",
      reason: leakPatterns.join("; "),
    };
  }

  // Check if it's SSR but not documented
  if (isReactSSRTest(content)) {
    return {
      path,
      hasSanitizeResourcesDisabled,
      hasSanitizeOpsDisabled,
      category: "legitimate",
      reason: "React SSR test (needs documentation)",
    };
  }

  // Unknown reason
  return {
    path,
    hasSanitizeResourcesDisabled,
    hasSanitizeOpsDisabled,
    category: "unknown",
    reason: "Unknown reason for disabled sanitizers - manual investigation needed",
  };
}

/**
 * Analyze all test files
 */
async function analyzeTests() {
  console.log("🔍 Scanning test files for disabled sanitizers...\n");

  const testDirs = ["tests", "src"];

  for (const dir of testDirs) {
    try {
      for await (
        const entry of walk(dir, {
          exts: ["ts", "tsx"],
          skip: [/node_modules/, /\.veryfront/, /coverage/],
        })
      ) {
        if (!entry.isFile) continue;
        if (!entry.name.includes("test")) continue;

        const content = await Deno.readTextFile(entry.path);

        if (
          content.includes("sanitizeResources: false") ||
          content.includes("sanitizeOps: false")
        ) {
          const result = categorizeTest(entry.path, content);
          results.push(result);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      throw error;
    }
  }
}

/**
 * Generate report
 */
function generateReport() {
  // Group by category
  const byCategory = {
    legitimate: results.filter((r) => r.category === "legitimate"),
    "needs-fixing": results.filter((r) => r.category === "needs-fixing"),
    unknown: results.filter((r) => r.category === "unknown"),
  };

  console.log("📊 SANITIZER AUDIT REPORT\n");
  console.log("=".repeat(80));

  // Summary
  console.log("\n📈 SUMMARY\n");
  console.log(`Total files with disabled sanitizers: ${results.length}`);
  console.log(
    `  ✅ Legitimate (React SSR): ${byCategory.legitimate.length} (${
      Math.round((byCategory.legitimate.length / results.length) * 100)
    }%)`,
  );
  console.log(
    `  ⚠️  Needs Fixing (Resource Leaks): ${byCategory["needs-fixing"].length} (${
      Math.round((byCategory["needs-fixing"].length / results.length) * 100)
    }%)`,
  );
  console.log(
    `  ❓ Unknown (Manual Review): ${byCategory.unknown.length} (${
      Math.round((byCategory.unknown.length / results.length) * 100)
    }%)`,
  );

  // Legitimate tests
  if (byCategory.legitimate.length > 0) {
    console.log("\n✅ LEGITIMATE (React SSR Tests)\n");
    for (const test of byCategory.legitimate) {
      console.log(`  ${test.path}`);
      if (VERBOSE) {
        console.log(`    Reason: ${test.reason}`);
      }
    }
  }

  // Needs fixing
  if (byCategory["needs-fixing"].length > 0) {
    console.log("\n⚠️  NEEDS FIXING (Resource Leaks)\n");
    for (const test of byCategory["needs-fixing"]) {
      console.log(`  ${test.path}`);
      console.log(`    Issues: ${test.reason}`);
    }
  }

  // Unknown
  if (byCategory.unknown.length > 0) {
    console.log("\n❓ UNKNOWN (Manual Investigation Required)\n");
    for (const test of byCategory.unknown) {
      console.log(`  ${test.path}`);
      if (VERBOSE) {
        console.log(`    Reason: ${test.reason}`);
      }
    }
  }

  console.log("\n" + "=".repeat(80));

  // Recommendations
  console.log("\n💡 RECOMMENDATIONS\n");

  if (byCategory["needs-fixing"].length > 0) {
    console.log(`1. Fix ${byCategory["needs-fixing"].length} files with resource leaks:`);
    console.log("   - Add await to renderer.destroy() calls");
    console.log("   - Add await to cleanup functions");
    console.log("   - Use TestContext for automatic cleanup");
    console.log("   - Add finally blocks for proper cleanup");
    console.log();
  }

  if (byCategory.unknown.length > 0) {
    console.log(`2. Investigate ${byCategory.unknown.length} files with unknown reasons:`);
    console.log("   - Check if they're actually SSR tests");
    console.log("   - Look for hidden resource leaks");
    console.log("   - Consider if sanitizers can be re-enabled");
    console.log();
  }

  if (byCategory.legitimate.length > 0) {
    console.log(`3. Document ${byCategory.legitimate.length} legitimate SSR tests:`);
    console.log("   - Add comment explaining React 19 MessagePort issue");
    console.log("   - Reference style guide section");
    console.log();
  }

  console.log("4. After fixes:");
  console.log("   - Re-run this audit");
  console.log("   - Run tests to ensure they pass");
  console.log("   - Target: <30 files with disabled sanitizers");
}

/**
 * Main execution
 */
async function main() {
  await analyzeTests();
  generateReport();

  // Exit code based on findings
  const needsFix = results.filter((r) => r.category === "needs-fixing").length;
  if (needsFix > 0) {
    console.log(`\n⚠️  ${needsFix} files need fixing`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    Deno.exit(1);
  });
}
