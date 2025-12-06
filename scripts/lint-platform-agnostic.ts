#!/usr/bin/env -S deno run --allow-read
/**
 * Platform Agnosticism Linter
 *
 * This script scans the codebase for platform-specific code outside the allowed directories.
 * Platform-specific code (Deno APIs, Node.js APIs, process.*, etc.) should only exist in:
 * - src/platform/ (platform abstraction layer)
 * - src/_shims/ (polyfill shims)
 * - *.test.ts files (test files may use platform APIs)
 *
 * Run: deno run --allow-read scripts/lint-platform-agnostic.ts
 * Or:  deno task lint:platform
 */

import { walk } from "jsr:@std/fs@1/walk";
import { relative } from "jsr:@std/path@1";

// Patterns that indicate platform-specific code
const VIOLATION_PATTERNS = [
  // Node.js imports
  { pattern: /from\s+["']node:/g, name: "node: import" },
  { pattern: /import\s+["']node:/g, name: "node: import" },
  { pattern: /require\s*\(\s*["']node:/g, name: "node: require" },

  // Direct process access (including via globalThis/global)
  { pattern: /(?<!\.)process\.env(?!\s*\.\s*NODE_ENV\s*[:=])/g, name: "process.env" },
  { pattern: /(?<!\.)process\.cwd\s*\(/g, name: "process.cwd()" },
  { pattern: /(?<!\.)process\.exit\s*\(/g, name: "process.exit()" },
  { pattern: /(?<!\.)process\.argv/g, name: "process.argv" },
  { pattern: /(?<!\.)process\.platform/g, name: "process.platform" },
  { pattern: /(?<!\.)process\.memoryUsage\s*\(/g, name: "process.memoryUsage()" },
  { pattern: /globalThis\.process/g, name: "globalThis.process" },
  { pattern: /global\.process/g, name: "global.process" },
  { pattern: /_global\.process/g, name: "_global.process" },

  // Direct Deno API access (must use platform abstractions)
  { pattern: /Deno\.readFile\s*\(/g, name: "Deno.readFile()" },
  { pattern: /Deno\.writeFile\s*\(/g, name: "Deno.writeFile()" },
  { pattern: /Deno\.readTextFile\s*\(/g, name: "Deno.readTextFile()" },
  { pattern: /Deno\.writeTextFile\s*\(/g, name: "Deno.writeTextFile()" },
  { pattern: /Deno\.cwd\s*\(/g, name: "Deno.cwd()" },
  { pattern: /Deno\.exit\s*\(/g, name: "Deno.exit()" },
  { pattern: /Deno\.args(?![a-zA-Z])/g, name: "Deno.args" },
  { pattern: /Deno\.env\./g, name: "Deno.env" },
  { pattern: /Deno\.Command\s*\(/g, name: "Deno.Command()" },
  { pattern: /Deno\.build\./g, name: "Deno.build" },
  { pattern: /globalThis\.Deno/g, name: "globalThis.Deno" },
  { pattern: /global\.Deno/g, name: "global.Deno" },
];

// Directories where platform-specific code is allowed
const ALLOWED_PATHS = [
  "src/platform/",
  "src/_shims/",
];

// File patterns to skip
const SKIP_PATTERNS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /test\//,
  /tests\//,
  /__tests__\//,
];

// Specific exceptions (with justification required in comments)
const EXCEPTIONS: Record<string, string[]> = {
  // esbuild define options use "process.env.NODE_ENV" as string key for build-time substitution
  "src/build/bundler/code-splitter/build-context.ts": ["process.env"],
  "src/build/renderer/services/script-bundler.ts": ["process.env"],
  // package-manager.ts uses proper isDeno guards for platform code
  "src/cli/utils/package-manager.ts": ["Deno.Command()", "Deno.build"],
  // production-build files use node:path intentionally for Node.js npm package runtime
  // These files are only executed in npm package context where node:path is available
  "src/build/production-build/asset-generation.ts": ["node: import"],
  "src/build/production-build/client-runtime.ts": ["node: import"],
  "src/build/production-build/static-generation.ts": ["node: import"],
  "src/build/production-build/build/build-initializer.ts": ["node: import"],
  "src/build/production-build/build/code-splitter-orchestrator.ts": ["node: import"],
  "src/build/production-build/build/build-setup.ts": ["node: import"],
  "src/build/production-build/build/output-generator.ts": ["node: import"],
  // ai/utils/setup.ts references process.cwd and Deno.cwd in documentation/comments only
  "src/ai/utils/setup.ts": ["process.cwd()", "Deno.cwd()"],
  // ai/workflow/backends/inngest.ts references process.env in documentation
  "src/ai/workflow/backends/inngest.ts": ["process.env"],
  // build/config/environment.ts documents process.env.NODE_ENV in JSDoc comment
  "src/build/config/environment.ts": ["process.env"],
};

interface Violation {
  file: string;
  line: number;
  column: number;
  pattern: string;
  match: string;
}

async function scanFile(filePath: string, relativePath: string): Promise<Violation[]> {
  const violations: Violation[] = [];

  // Check if file is in allowed path
  for (const allowedPath of ALLOWED_PATHS) {
    if (relativePath.startsWith(allowedPath)) {
      return violations;
    }
  }

  // Check if file matches skip patterns
  for (const skipPattern of SKIP_PATTERNS) {
    if (skipPattern.test(relativePath)) {
      return violations;
    }
  }

  const content = await Deno.readTextFile(filePath);
  const lines = content.split("\n");

  for (const { pattern, name } of VIOLATION_PATTERNS) {
    // Check if this pattern is excepted for this file
    const fileExceptions = EXCEPTIONS[relativePath] || [];
    if (fileExceptions.includes(name)) {
      continue;
    }

    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Calculate line and column
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;
      const lastNewline = beforeMatch.lastIndexOf("\n");
      const column = match.index - lastNewline;

      // Skip if in a comment
      const line = lines[lineNumber - 1] || "";
      const beforeMatchInLine = line.substring(0, column);
      if (beforeMatchInLine.includes("//") || beforeMatchInLine.includes("/*")) {
        continue;
      }

      // Skip string literals that are just documenting patterns (like in this file)
      if (line.includes('pattern:') || line.includes('name:')) {
        continue;
      }

      violations.push({
        file: relativePath,
        line: lineNumber,
        column,
        pattern: name,
        match: match[0].trim(),
      });
    }
  }

  return violations;
}

async function main() {
  const srcDir = new URL("../src", import.meta.url).pathname;
  const violations: Violation[] = [];

  console.log("Scanning for platform-specific code violations...\n");

  for await (const entry of walk(srcDir, {
    exts: [".ts", ".tsx"],
    skip: [/node_modules/, /\.d\.ts$/],
  })) {
    if (entry.isFile) {
      const relativePath = "src/" + relative(srcDir, entry.path);
      const fileViolations = await scanFile(entry.path, relativePath);
      violations.push(...fileViolations);
    }
  }

  if (violations.length === 0) {
    console.log("No platform-specific code violations found.");
    Deno.exit(0);
  }

  console.log(`Found ${violations.length} violation(s):\n`);

  // Group by file
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = byFile.get(v.file) || [];
    existing.push(v);
    byFile.set(v.file, existing);
  }

  for (const [file, fileViolations] of byFile) {
    console.log(`\x1b[33m${file}\x1b[0m`);
    for (const v of fileViolations) {
      console.log(`  Line ${v.line}: ${v.pattern} - "${v.match}"`);
    }
    console.log();
  }

  console.log("\x1b[31mPlatform-specific code should only exist in:\x1b[0m");
  console.log("  - src/platform/ (abstraction layer)");
  console.log("  - src/_shims/ (polyfill shims)");
  console.log("\nUse platform abstractions instead:");
  console.log("  - import { getEnv, cwd, exit } from \"platform/compat/process.ts\"");
  console.log("  - import { isNode, isDeno } from \"platform/compat/runtime.ts\"");
  console.log("  - import { createFileSystem } from \"platform/compat/fs.ts\"");

  Deno.exit(1);
}

main();
