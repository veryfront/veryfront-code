#!/usr/bin/env -S deno run --allow-read
/**
 * @veryfront/internal Import Guard
 *
 * Prevents new call sites from importing the monolithic '@veryfront/internal' entry point.
 * Instead, callers must use the scoped modules (e.g. '@veryfront/internal/logger').
 */

import { walk } from "std/fs/walk.ts";
import { relative } from "std/path/mod.ts";

const INTERNAL_PREFIX = "@veryfront/internal";
const ROOTS_TO_SCAN = ["src", "packages", "scripts", "examples"];
const VALID_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const SKIP_DIR_PATTERNS = [/\/dist\//, /\/coverage\//, /\/\.git\//, /\/node_modules\//];
const KNOWN_SUBMODULES = ["config", "errors", "logger", "middleware", "security"];

interface Violation {
  file: string;
  line: number;
  specifier: string;
  snippet: string;
}

function isRootSpecifier(specifier: string): boolean {
  if (!specifier.startsWith(INTERNAL_PREFIX)) {
    return false;
  }

  const remainder = specifier.slice(INTERNAL_PREFIX.length);

  if (remainder === "") {
    return true;
  }

  const first = remainder[0];

  if (first === "/") {
    const segment = remainder.slice(1).split(/[/?#]/)[0] ?? "";
    if (segment === "" || segment === "index" || segment === "mod") {
      return true;
    }
    return false;
  }

  if (first === "." || first === "?" || first === "#") {
    return true;
  }

  // Handles cases like '@veryfront/internalized' (not a match).
  return false;
}

function getLineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

function* findSpecifiers(source: string): Generator<{ specifier: string; index: number }> {
  const staticRegex = /^\s*(import|export)\s+(?:[\s\S]*?)from\s+['"]([^'"]+)['"]/gm;
  const bareImportRegex = /^\s*import\s+['"]([^'"]+)['"]/gm;
  const dynamicRegex = /(?<![\w$"'`])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

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

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];

  for (const root of ROOTS_TO_SCAN) {
    try {
      await Deno.stat(root);
    } catch {
      continue;
    }

    for await (
      const entry of walk(root, {
        includeDirs: false,
        exts: VALID_EXTENSIONS,
        skip: SKIP_DIR_PATTERNS,
      })
    ) {
      files.push(entry.path);
    }
  }

  return files;
}

function formatSnippet(sourceLine: string, specifier: string): string {
  const trimmed = sourceLine.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed.replace(specifier, specifier);
}

const files = await collectFiles();
const violations: Violation[] = [];

for (const file of files) {
  const content = await Deno.readTextFile(file);

  for (const { specifier, index } of findSpecifiers(content)) {
    if (!isRootSpecifier(specifier)) {
      continue;
    }

    const lineNumber = getLineNumber(content, index);
    const snippet = content.split("\n")[lineNumber - 1]?.trim() ?? "";

    violations.push({
      file,
      line: lineNumber,
      specifier,
      snippet: formatSnippet(snippet, specifier),
    });
  }
}

if (violations.length > 0) {
  console.error("🚫 Found imports that target the deprecated '@veryfront/internal' root entry point:\n");
  for (const violation of violations) {
    console.error(
      `  - ${relative(Deno.cwd(), violation.file)}:${violation.line} → ${violation.specifier}`,
    );
    if (violation.snippet) {
      console.error(`    ${violation.snippet}`);
    }
  }
  console.error(
    `\nUse explicit submodules instead (${KNOWN_SUBMODULES.map(s => `'${INTERNAL_PREFIX}/${s}'`).join(", ")}).`,
  );
  Deno.exit(1);
}

console.log("✅ All files import '@veryfront/internal' via scoped modules.");
