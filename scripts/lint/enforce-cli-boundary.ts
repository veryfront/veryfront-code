#!/usr/bin/env -S deno run --allow-read

/**
 * CLI Boundary Lint
 *
 * Enforces that CLI source code depends on framework code only via
 * package surfaces (`veryfront`, `veryfront/*`) and local CLI modules.
 *
 * In particular, this bans direct framework internal aliases from `cli/`,
 * for example `#veryfront/server/production-server.ts`.
 */

import { walk } from "@std/fs";

const CLI_ROOT = "cli";
const VALID_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const SKIP_PATTERNS = [
  /\.test\./,
  /\.integration\.test\./,
  /\/test-utils\//,
];

const DIRECT_INTERNAL_PREFIX = "#veryfront/";

interface Violation {
  file: string;
  line: number;
  specifier: string;
  reason: string;
}

function shouldSkip(path: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(path));
}

function* findSpecifiers(source: string): Generator<{ specifier: string; index: number }> {
  const staticRegex = /^\s*(import|export)\s+(?:[\s\S]*?)from\s+["']([^"']+)["']/gm;
  const bareImportRegex = /^\s*import\s+["']([^"']+)["']/gm;
  const dynamicRegex = /(?<![\w$"'`])import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(staticRegex)) {
    if (match.index !== undefined && match[2]) {
      yield { specifier: match[2], index: match.index };
    }
  }
  for (const match of source.matchAll(bareImportRegex)) {
    if (match.index !== undefined && match[1]) {
      yield { specifier: match[1], index: match.index };
    }
  }
  for (const match of source.matchAll(dynamicRegex)) {
    if (match.index !== undefined && match[1]) {
      yield { specifier: match[1], index: match.index };
    }
  }
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function classifyViolation(specifier: string): string | null {
  if (!specifier.startsWith(DIRECT_INTERNAL_PREFIX)) return null;

  // Explicitly call out deep .ts imports (requested policy).
  if (/^#veryfront\/[^/]+\/.+\.ts$/.test(specifier)) {
    return "Direct deep #veryfront/**/**.ts import is forbidden in cli/. Use public `veryfront/*` exports.";
  }

  return "Direct #veryfront/* import is forbidden in cli/. Use public `veryfront/*` exports.";
}

const violations: Violation[] = [];

for await (
  const entry of walk(CLI_ROOT, {
    includeDirs: false,
    exts: VALID_EXTENSIONS,
  })
) {
  if (shouldSkip(entry.path)) continue;

  const source = await Deno.readTextFile(entry.path);
  for (const { specifier, index } of findSpecifiers(source)) {
    const reason = classifyViolation(specifier);
    if (!reason) continue;

    violations.push({
      file: entry.path,
      line: lineOf(source, index),
      specifier,
      reason,
    });
  }
}

if (violations.length > 0) {
  console.error("❌ CLI boundary violations found:\n");
  for (const violation of violations) {
    console.error(`  - ${violation.file}:${violation.line}`);
    console.error(`    ${violation.specifier}`);
    console.error(`    ${violation.reason}`);
  }
  console.error(
    "\nAllowed framework imports from cli/: `veryfront`, `veryfront/*`, and local `#cli/*` aliases.",
  );
  Deno.exit(1);
}

console.log("✅ CLI boundary check passed.");
