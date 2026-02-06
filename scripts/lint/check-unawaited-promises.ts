/**
 * Check for common patterns of unawaited async destroy/cleanup calls
 * Specifically targets patterns like:
 * - renderer.destroy() (known to be async)
 * - cleanupRenderer() (known to be async)
 * - cleanupBundler() (known to be async)
 */

import { relative } from "../src/platform/compat/path-helper.ts";
import { createFileSystem, FileSystem } from "../src/platform/compat/fs.ts";
import { cwd, exit } from "../src/platform/compat/process.ts";

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

// Custom walk implementation using FileSystem abstraction
async function* walk(dir: string, fs: FileSystem, exts: string[], skip: RegExp[]): AsyncGenerator<{ path: string; isFile: boolean }> {
  try {
    for await (const entry of fs.readDir(dir)) {
      const entryPath = `${dir}/${entry.name}`;
      if (skip.some(s => s.test(entryPath))) {
        continue;
      }

      if (entry.isFile) {
        const ext = entry.name.split('.').pop();
        if (ext && exts.includes(ext)) {
          yield { path: entryPath, isFile: true };
        }
      } else if (entry.isDirectory) {
        yield* walk(entryPath, fs, exts, skip);
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Error && (e as any).code === 'ENOENT') {
      // Directory not found, gracefully skip
      return;
    }
    throw e;
  }
}

async function checkFile(filePath: string, fs: FileSystem): Promise<Issue[]> {
  const issues: Issue[] = [];
  const content = await fs.readTextFile(filePath);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
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
  const currentWorkingDir = cwd();
  const fs = createFileSystem();

  // Check src/ directory
  for await (
    const entry of walk("src", fs, ["ts", "tsx"], [/node_modules/, /dist/, /coverage/])
  ) {
    if (entry.isFile) {
      const fileIssues = await checkFile(entry.path, fs);
      issues.push(...fileIssues);
    }
  }

  // Check tests/ directory
  for await (
    const entry of walk("tests", fs, ["ts", "tsx"], [/node_modules/, /dist/, /coverage/])
  ) {
    if (entry.isFile) {
      const fileIssues = await checkFile(entry.path, fs);
      issues.push(...fileIssues);
    }
  }

  if (issues.length === 0) {
    console.log("✓ No unawaited promise issues found!");
    exit(0);
  }

  console.error(`\n❌ Found ${issues.length} potential unawaited promise issue(s):\n`);

  for (const issue of issues) {
    const relativePath = relative(currentWorkingDir, issue.file);
    console.error(`${relativePath}:${issue.line}`);
    console.error(`  Pattern: ${issue.pattern}`);
    console.error(`  Code: ${issue.code}`);
    console.error("");
  }

  console.error(
    "\n⚠️  These calls may need 'await' if they return promises.\n",
  );
  exit(1);
}

// Check if the script is run directly
// @ts-ignore - Deno global
if (import.meta.main || typeof Deno === 'undefined') {
  main();
}
