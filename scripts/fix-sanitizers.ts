#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Sanitizer Fix Script
 *
 * Automatically re-enables sanitizers for tests that don't need them disabled.
 * Only React SSR tests with MessagePort issues need disabled sanitizers.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/fix-sanitizers.ts
 *   deno run --allow-read --allow-write scripts/fix-sanitizers.ts --dry-run
 */

import { walk } from "std/fs/walk.ts";

const DRY_RUN = Deno.args.includes("--dry-run");

interface Fix {
  path: string;
  reason: string;
  needsSanitizers: boolean;
}

const fixes: Fix[] = [];

/**
 * Check if a test file uses React SSR rendering or servers that perform SSR
 */
function usesReactSSR(content: string): boolean {
  const ssrIndicators = [
    "renderToString",
    "renderToStaticMarkup",
    "renderToPipeableStream",
    "renderToReadableStream",
    "createRenderer",
    "renderer.renderPage",
    "React.renderToString",
    "ReactDOM.renderToString",
    "ReactDOMServer",
    "createDevServer", // Dev servers perform SSR
    "createProductionServer", // Production servers perform SSR
    "startUniversalServer", // Universal server performs SSR
    "createTestDevServer", // Test dev servers perform SSR
    "withTestServer", // Test server helper that wraps SSR servers
  ];

  return ssrIndicators.some((indicator) => content.includes(indicator));
}

/**
 * Check if test has disabled sanitizers
 */
function hasDisabledSanitizers(content: string): {
  resources: boolean;
  ops: boolean;
} {
  return {
    resources: content.includes("sanitizeResources: false"),
    ops: content.includes("sanitizeOps: false"),
  };
}

/**
 * Add documentation comment for SSR tests
 */
function addSSRDocumentation(content: string): string {
  // Find describe or Deno.test with disabled sanitizers
  const describeMatch = content.match(
    /(describe\([^{]+\{[^}]*sanitizeResources: false[^}]*\})/s,
  );
  const denoTestMatch = content.match(
    /(Deno\.test\([^{]+\{[^}]*sanitizeResources: false[^}]*\})/s,
  );

  const match = describeMatch || denoTestMatch;
  if (!match) return content;

  const block = match[0];
  const hasDoc = content
    .slice(Math.max(0, content.indexOf(block) - 300), content.indexOf(block))
    .includes("React 19");

  if (hasDoc) return content; // Already documented

  const doc = `  // Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
  // See: https://github.com/facebook/react/issues/24669
  `;

  return content.replace(block, doc + block);
}

/**
 * Remove disabled sanitizers from test
 */
function removeSanitizerDisabling(content: string): string {
  // Pattern 1: describe block with disabled sanitizers
  content = content.replace(
    /(describe\(\s*"[^"]+",\s*)\{[^}]*sanitizeResources:\s*false[^}]*sanitizeOps:\s*false[^}]*\},(\s*\(\))/gs,
    "$1$2",
  );

  // Pattern 2: Deno.test with disabled sanitizers
  content = content.replace(
    /(Deno\.test\(\s*)\{[^}]*sanitizeResources:\s*false[^}]*sanitizeOps:\s*false[^}]*\},(\s*async)/gs,
    "$1$2",
  );

  // Pattern 3: it() with disabled sanitizers
  content = content.replace(
    /(it\(\s*"[^"]+",\s*)\{[^}]*sanitizeResources:\s*false[^}]*sanitizeOps:\s*false[^}]*\},(\s*async)/gs,
    "$1$2",
  );

  return content;
}

/**
 * Fix fetch response consumption (add .text() to unconsumed responses)
 */
function fixFetchResponses(content: string): string {
  // This is a heuristic fix - look for fetch calls that don't consume response
  // Pattern: await fetch(...) without .text(), .json(), etc.

  // Skip if response is already consumed
  if (content.includes("await res.text()") || content.includes("await response.text()")) {
    return content;
  }

  // Look for fetch without consumption
  const fetchPattern = /(const res = await fetch\([^)]+\);)(\s+)(assertEquals\(res\.status)/g;

  return content.replace(fetchPattern, (match, fetchCall, whitespace, assertion) => {
    return `${fetchCall}${whitespace}await res.text(); // Consume response body${whitespace}${assertion}`;
  });
}

/**
 * Analyze and fix a test file
 */
async function analyzeAndFix(path: string) {
  const content = await Deno.readTextFile(path);
  const disabled = hasDisabledSanitizers(content);

  if (!disabled.resources && !disabled.ops) {
    return; // No disabled sanitizers
  }

  const usesSSR = usesReactSSR(content);
  let newContent = content;
  let changes: string[] = [];

  if (usesSSR) {
    // Legitimate SSR test - add documentation
    const documented = addSSRDocumentation(content);
    if (documented !== content) {
      newContent = documented;
      changes.push("Added SSR documentation");
    }
    fixes.push({
      path,
      reason: "Legitimate SSR test - kept disabled sanitizers, added docs",
      needsSanitizers: true,
    });
  } else {
    // Not an SSR test - remove disabled sanitizers
    newContent = removeSanitizerDisabling(content);

    // Also fix any fetch response issues
    newContent = fixFetchResponses(newContent);

    if (newContent !== content) {
      changes.push("Re-enabled sanitizers");
      if (newContent.includes("// Consume response body")) {
        changes.push("Fixed fetch response consumption");
      }
    }

    fixes.push({
      path,
      reason: `Not an SSR test - ${changes.join(", ")}`,
      needsSanitizers: false,
    });
  }

  if (newContent !== content && !DRY_RUN) {
    await Deno.writeTextFile(path, newContent);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("🔧 Analyzing and fixing sanitizer issues...\n");

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - No files will be modified\n");
  }

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

        await analyzeAndFix(entry.path);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      throw error;
    }
  }

  // Generate report
  console.log("📊 SANITIZER FIX REPORT\n");
  console.log("=".repeat(80));

  const legitSSR = fixes.filter((f) => f.needsSanitizers);
  const fixed = fixes.filter((f) => !f.needsSanitizers);

  console.log(`\n✅ LEGITIMATE SSR TESTS (${legitSSR.length})`);
  console.log("These tests need disabled sanitizers due to React 19 MessagePort:\n");
  for (const fix of legitSSR) {
    console.log(`  ${fix.path}`);
  }

  console.log(`\n🔧 FIXED TESTS (${fixed.length})`);
  console.log("Re-enabled sanitizers for non-SSR tests:\n");
  for (const fix of fixed) {
    console.log(`  ${fix.path}`);
    console.log(`    → ${fix.reason}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log(
    `\n📈 Summary: ${legitSSR.length} legitimate, ${fixed.length} fixed`,
  );

  if (DRY_RUN) {
    console.log("\n💡 Run without --dry-run to apply changes");
  } else {
    console.log("\n✅ Changes applied successfully!");
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    Deno.exit(1);
  });
}
