/**
 * Check for common patterns of unawaited async destroy/cleanup calls
 * Specifically targets patterns like:
 * - renderer.destroy() (known to be async)
 * - cleanupRenderer() (known to be async)
 * - cleanupBundler() (known to be async)
 */

import { walk } from "https://deno.land/std@0.220.0/fs/walk.ts";
import { relative } from "https://deno.land/std@0.220.0/path/mod.ts";

interface Issue {
  file: string;
  line: number;
  code: string;
  pattern: string;
}

// Only check for specific known-async patterns to reduce false positives
const PATTERNS = [
  // renderer.destroy() - known to be async
  {
    regex: /^(?!.*await\s+).*renderer\.destroy\(\)/,
    description: "renderer.destroy() called without await (async method)",
  },
  // cleanupRenderer() - known to be async
  {
    regex: /^(?!.*await\s+).*cleanupRenderer\(/,
    description: "cleanupRenderer() called without await (async function)",
  },
  // cleanupBundler() - known to be async
  {
    regex: /^(?!.*await\s+).*cleanupBundler\(/,
    description: "cleanupBundler() called without await (async function)",
  },
];

async function checkFile(filePath: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const content = await Deno.readTextFile(filePath);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments, empty lines, and function declarations
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.length === 0 ||
      trimmed.startsWith("export async function") ||
      trimmed.startsWith("async function") ||
      trimmed.startsWith("function ")
    ) {
      continue;
    }

    for (const pattern of PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        // Additional check: make sure this is a statement call, not part of declarations
        if (
          !trimmed.includes("= ") &&
          !trimmed.startsWith("return") &&
          !trimmed.includes("function") &&
          trimmed.includes("()")
        ) {
          issues.push({
            file: filePath,
            line: i + 1,
            code: trimmed,
            pattern: pattern.description,
          });
        }
      }
    }
  }

  return issues;
}

async function main() {
  const issues: Issue[] = [];
  const cwd = Deno.cwd();

  // Check src/ directory
  for await (
    const entry of walk("src", {
      exts: ["ts", "tsx"],
      skip: [/node_modules/, /dist/, /coverage/],
    })
  ) {
    if (entry.isFile) {
      const fileIssues = await checkFile(entry.path);
      issues.push(...fileIssues);
    }
  }

  // Check tests/ directory
  try {
    for await (
      const entry of walk("tests", {
        exts: ["ts", "tsx"],
        skip: [/node_modules/, /dist/, /coverage/],
      })
    ) {
      if (entry.isFile) {
        const fileIssues = await checkFile(entry.path);
        issues.push(...fileIssues);
      }
    }
  } catch {
    // tests directory might not exist
  }

  if (issues.length === 0) {
    console.log("✓ No unawaited promise issues found!");
    Deno.exit(0);
  }

  console.error(`\n❌ Found ${issues.length} potential unawaited promise issue(s):\n`);

  for (const issue of issues) {
    const relativePath = relative(cwd, issue.file);
    console.error(`${relativePath}:${issue.line}`);
    console.error(`  Pattern: ${issue.pattern}`);
    console.error(`  Code: ${issue.code}`);
    console.error("");
  }

  console.error(
    "\n⚠️  These calls may need 'await' if they return promises.\n",
  );
  Deno.exit(1);
}

if (import.meta.main) {
  main();
}
