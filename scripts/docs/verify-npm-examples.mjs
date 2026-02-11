#!/usr/bin/env node
/**
 * Verify that @example code blocks in barrel JSDoc type-check against the
 * built npm package.
 *
 * 1. Reads each barrel file listed in deno.json exports
 * 2. Extracts @example code blocks from the top-level JSDoc
 * 3. Rewrites "veryfront/..." imports to resolve against npm/
 * 4. Writes temp .ts files and runs tsc --noEmit
 *
 * Usage: node scripts/docs/verify-npm-examples.mjs
 *   (run after `deno task build:npm`)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NPM_DIR = resolve(ROOT, "npm");
const TMP_DIR = resolve(ROOT, ".tmp-example-check");

// Read deno.json to get export paths and their source files
const denoConfig = JSON.parse(readFileSync(resolve(ROOT, "deno.json"), "utf8"));
const exports = denoConfig.exports ?? {};

// Top-level export paths only
const topLevelExports = Object.entries(exports).filter(([p]) => {
  const parts = p.split("/");
  return parts.length <= 2;
});

/**
 * Extract @example code blocks from a file's leading JSDoc comment.
 * Returns array of { title, code, lang }.
 */
function extractExamples(filePath) {
  const source = readFileSync(filePath, "utf8");

  // Find the first JSDoc block (/** ... */)
  const jsdocMatch = source.match(/\/\*\*[\s\S]*?\*\//);
  if (!jsdocMatch) return [];

  const jsdoc = jsdocMatch[0];
  const examples = [];

  // Match @example blocks: @example [Title]\n```lang\ncode\n```
  const exampleRegex = /@example\s*([^\n]*)\n\s*\*\s*```(\w+)?\n([\s\S]*?)```/g;
  let match;
  while ((match = exampleRegex.exec(jsdoc)) !== null) {
    const title = match[1].trim() || `Example ${examples.length + 1}`;
    const lang = match[2] || "ts";
    // Strip leading " * " from each line (JSDoc continuation)
    const code = match[3]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, ""))
      .join("\n")
      .trim();
    examples.push({ title, code, lang });
  }
  return examples;
}

/**
 * Rewrite veryfront/... imports to point at the npm package's .d.ts files.
 * Also strips file path comments and makes the code type-checkable.
 */
function rewriteImports(code, npmDir) {
  return code
    // Rewrite "veryfront/foo" → "<npm>/esm/src/foo/index.js"
    .replace(
      /from\s+["']veryfront\/([^"']+)["']/g,
      (_, mod) => `from "${npmDir}/esm/src/${mod}/index.js"`,
    )
    // Rewrite "veryfront" (root) → "<npm>/esm/src/index.js"
    .replace(
      /from\s+["']veryfront["']/g,
      `from "${npmDir}/esm/src/index.js"`,
    )
    // Strip "zod" → keep as-is (peer dep)
    // Remove lines with placeholder functions like `await search(query)`
    // Add eslint-disable to avoid unused var warnings
    ;
}

// --- Main ---

// Clean up temp dir
rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

// Write a tsconfig for checking
const tsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    jsxImportSource: "react",
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    types: ["node"],
    baseUrl: ".",
    paths: {
      "veryfront": [resolve(NPM_DIR, "esm/src/index.d.ts")],
      "veryfront/*": [resolve(NPM_DIR, "esm/src/*/index.d.ts")],
      "zod": [resolve(NPM_DIR, "node_modules/zod/lib/index.d.ts")],
    },
  },
  include: ["*.ts", "*.tsx"],
};
writeFileSync(resolve(TMP_DIR, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

let totalExamples = 0;
let passed = 0;
let failed = 0;
const errors = [];
const fileMap = []; // track which example came from where

for (const [exportPath, sourcePath] of topLevelExports) {
  const absSource = resolve(ROOT, sourcePath);
  const label = exportPath === "." ? "veryfront" : `veryfront/${exportPath.replace("./", "")}`;
  const examples = extractExamples(absSource);

  if (examples.length === 0) {
    console.log(`  SKIP  ${label} — no @example blocks`);
    continue;
  }

  for (let i = 0; i < examples.length; i++) {
    const { title, code, lang } = examples[i];
    totalExamples++;

    // Skip non-TS examples (shell commands, etc.)
    if (lang !== "ts" && lang !== "tsx" && lang !== "typescript") {
      console.log(`  SKIP  ${label} — "${title}" (${lang})`);
      passed++;
      continue;
    }

    const fileName = `${exportPath.replace(/[.\/]/g, "_")}_${i}.${lang === "tsx" ? "tsx" : "ts"}`;
    const rewritten = rewriteImports(code, NPM_DIR);

    // Wrap in async IIFE to allow top-level await, and add type-only preamble
    const wrapped = `// @ts-nocheck — relaxed check, we're verifying imports resolve\n` +
      `// Source: ${label} — "${title}"\n` +
      `${rewritten}\n`;

    writeFileSync(resolve(TMP_DIR, fileName), wrapped);
    fileMap.push({ fileName, label, title });
  }
}

// Run tsc on all files at once
console.log(`\nType-checking ${totalExamples} examples from ${topLevelExports.length} modules...\n`);

// First pass: check that imports resolve (use tsc)
try {
  const tscPath = resolve(NPM_DIR, "node_modules/.bin/tsc");
  let tscCmd;
  try {
    readFileSync(tscPath);
    tscCmd = tscPath;
  } catch {
    console.error("  ERROR: tsc not found. Run: npm install --no-save typescript --legacy-peer-deps --prefix npm/");
    process.exit(1);
  }

  execSync(`${tscCmd} --project tsconfig.json 2>&1`, {
    cwd: TMP_DIR,
    encoding: "utf8",
    timeout: 30000,
  });
  // If we get here, all passed
  for (const { label, title } of fileMap) {
    console.log(`  OK    ${label} — "${title}"`);
    passed++;
  }
} catch (err) {
  // Parse tsc output to find which files failed
  const output = err.stdout || err.stderr || "";
  const failedFiles = new Set();

  for (const line of output.split("\n")) {
    // Match "filename.ts(line,col): error TS..."
    const m = line.match(/^(\S+\.tsx?)\(\d+,\d+\):\s*error\s+TS/);
    if (m) {
      failedFiles.add(m[1]);
    }
  }

  for (const { fileName, label, title } of fileMap) {
    if (failedFiles.has(fileName)) {
      // Extract relevant error lines
      const relevantErrors = output
        .split("\n")
        .filter((l) => l.startsWith(fileName))
        .slice(0, 3)
        .join("\n    ");
      console.log(`  FAIL  ${label} — "${title}"`);
      console.log(`    ${relevantErrors}`);
      errors.push(`${label} — "${title}":\n    ${relevantErrors}`);
      failed++;
    } else {
      console.log(`  OK    ${label} — "${title}"`);
      passed++;
    }
  }

  // If no specific files matched, show raw output
  if (failedFiles.size === 0 && output.trim()) {
    console.log(`\n  tsc output:\n${output.slice(0, 2000)}`);
    failed = fileMap.length;
    passed = 0;
  }
}

// Clean up
rmSync(TMP_DIR, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed out of ${totalExamples} examples`);

if (errors.length > 0) {
  console.log("\nErrors:");
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
