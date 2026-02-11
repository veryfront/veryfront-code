#!/usr/bin/env -S deno run --allow-read
/**
 * Wildcard Export Linter
 *
 * Fails if any barrel file (index.ts) under src/ contains `export * from` statements.
 * All barrel exports should be explicit named exports to prevent internal symbol leakage.
 *
 * Usage: deno run --allow-read scripts/lint/ban-wildcard-exports.ts
 */

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";

const ROOT = "src";
const WILDCARD_PATTERN = /export\s+\*\s+from\s+/;

interface Violation {
  file: string;
  line: number;
  text: string;
}

async function main(): Promise<void> {
  const violations: Violation[] = [];

  for await (const entry of walk(ROOT, {
    match: [/index\.ts$/],
    skip: [/node_modules/, /__tests__/],
  })) {
    if (!entry.isFile) continue;
    if (!entry.name.match(/^index\.ts$/)) continue;

    const content = await Deno.readTextFile(entry.path);
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trimStart();
      if (trimmedLine.startsWith("//") || trimmedLine.startsWith("*")) continue;
      if (WILDCARD_PATTERN.test(line)) {
        violations.push({
          file: entry.path,
          line: i + 1,
          text: line.trim(),
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log("No wildcard exports found in barrel files.");
    Deno.exit(0);
  }

  console.error(`Found ${violations.length} wildcard export(s) in barrel files:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  console.error(
    "\nReplace `export * from` with explicit named exports in barrel files.",
  );
  Deno.exit(1);
}

main();
