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

import { walk } from "#std/fs/walk";
import { relative } from "#std/path";

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

// Specific files where platform-specific code is allowed.
// These are worker entrypoints, test utilities, CLI-only code, smoke tests,
// sandbox workers, proxy modules, and runtime detection — all of which
// legitimately need direct platform API access.
const ALLOWED_FILES = new Set([
  // Test framework – directly wraps Deno.env for per-test isolation
  "src/testing/bdd.ts",
  // Explicit Deno compat layer for tests (makeTempFile, exit, etc.)
  "src/testing/deno-compat.ts",
  // Smoke test script — runs with `deno run --allow-all`
  "src/provider/local/_smoke-test.ts",
  // Worker entrypoints — run in their own Deno subprocess
  "src/workflow/worker/job-entrypoint.ts",
  "src/workflow/worker/dynamic-job-entrypoint.ts",
  // Worker process executor — spawns subprocesses with Deno.Command
  "src/workflow/worker/executors/process.ts",
  // CLI error boundary — CLI-specific, exits process on fatal errors
  "src/errors/middleware/cli-error-boundary.ts",
  // Test helper for sandbox tests
  "src/sandbox/sandbox.test-helpers.ts",
  // Sandbox worker script — needs direct Deno API access (env, fs)
  "src/security/sandbox/worker-script.ts",
  // Proxy modules — Deno-native network proxy layer
  "src/proxy/env.ts",
  "src/proxy/logger.ts",
  "src/proxy/renderer-router.ts",
  // Runtime detection guards — must inspect global.Deno / global.process
  "src/utils/runtime-guards.ts",
  // Workspace sync — heavy Deno FS usage for local file operations
  "src/workflow/claude-code/workspace-sync.ts",
  // Agent runtime skill loader — uses node:fs/node:path for file discovery
  "src/agent/runtime/builtin-skill-files.ts",
]);

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
  "cli/utils/package-manager.ts": ["Deno.Command()", "Deno.build"],
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

  // Agent definition loaders intentionally stay synchronous because the public runtime
  // steering path resolves definitions during service construction.
  "src/agent/hosted/veryfront-cloud-agent-service.ts": ["node: import"],
  "src/agent/runtime/agent-definition-files.ts": ["node: import"],
  "src/agent/runtime/project-skill-catalog.ts": ["node: import"],
  // Live eval PDF fixtures return Buffer for Node-compatible multipart uploads.
  "src/agent/testing/live-evals/formatting.ts": ["node: import"],

  // --- AsyncLocalStorage from node:async_hooks ---
  // No platform abstraction exists for AsyncLocalStorage; these are server-only
  // modules that rely on Node.js/Deno built-in async context propagation.
  "src/utils/cache-dir.ts": ["node: import"],
  "src/utils/logger/request-context.ts": ["node: import"],
  "src/transforms/esm/in-flight-manager.ts": ["node: import"],
  "src/react/head-collector.ts": ["node: import"],
  "src/server/project-env/storage.ts": ["node: import"],
  "src/workflow/executor/step-executor.ts": ["node: import"],
  "src/modules/react-loader/css-import-collector.ts": ["node: import"],
  "src/cache/request-cache-batcher.ts": ["node: import"],
  "src/cache/cache-key-builder.ts": ["node: import"],
  "src/provider/veryfront-cloud/context.ts": ["node: import"],
  "src/observability/request-profiler.ts": ["node: import"],

  // --- node:buffer (File / Buffer) ---
  // File is global only on Node 20+; import from node:buffer for Node 18 compat
  "src/embedding/upload-handler.ts": ["node: import"],
  "src/security/input-validation/parsers.ts": ["node: import"],
  // Buffer used for constant-time comparison in auth handler
  "src/security/http/auth.ts": ["node: import"],

  // --- node:zlib ---
  // gunzipSync used for distributed cache decompression
  "src/transforms/esm/http-cache-wrapper.ts": ["node: import"],

  // --- node:url ---
  // fileURLToPath for resolving React import paths in Node.js MDX loader
  "src/transforms/mdx/esm-module-loader/utils/react-transforms.ts": ["node: import"],

  // --- Code generation: emits node: imports / Deno API calls as string literals ---
  // Module loader emits require shims and env access as generated code
  "src/routing/api/module-loader/loader.ts": [
    "node: import",
    "Deno.env",
    "process.env",
  ],
  // Compiled binary require shim emits node:module/node:path imports
  "src/routing/api/module-loader/external-import-rewriter.ts": ["node: import"],

  // --- Deno FS in server-side modules ---
  // Extension discovery reads package.json with Deno.readTextFile
  "src/extensions/discovery.ts": ["Deno.readTextFile()"],
  // Studio bridge handler reads TypeScript source for on-the-fly bundling
  "src/server/handlers/studio/bridge-modules.handler.ts": ["Deno.readTextFile()"],
  // Plugin loader writes temp files for dynamic import in compiled binaries
  "src/html/styles-builder/plugin-loader.ts": ["Deno.writeTextFile()"],
  // JSDoc example references Deno.cwd() — not runtime code
  "src/extensions/index.ts": ["Deno.cwd()"],
  // JSDoc example references process.env — not runtime code
  "src/runs/index.ts": ["process.env"],
  // JSDoc example references import { createServer } from "node:http"
  "src/server/index.ts": ["node: import"],
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

  // Check if file is individually allowed
  if (ALLOWED_FILES.has(relativePath)) {
    return violations;
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
  const srcDir = new URL("../../src", import.meta.url).pathname;
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
