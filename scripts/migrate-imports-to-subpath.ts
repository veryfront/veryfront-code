#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Migration script to convert @veryfront/* and @std/* imports to #veryfront/* and #std/*
 *
 * This enables Node.js to resolve these imports natively via package.json imports field,
 * eliminating the need for custom loader hooks.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/migrate-imports-to-subpath.ts
 *   deno run --allow-read --allow-write scripts/migrate-imports-to-subpath.ts --dry-run
 */

import { walk } from "https://deno.land/std@0.220.0/fs/walk.ts";

const DRY_RUN = Deno.args.includes("--dry-run");
const VERBOSE = Deno.args.includes("--verbose");

// Patterns to replace
const REPLACEMENTS: [RegExp, string][] = [
  // from "@veryfront/..." -> from "#veryfront/..."
  [/from\s+["']@veryfront\//g, 'from "#veryfront/'],
  // import "@veryfront/..." -> import "#veryfront/..."
  [/import\s+["']@veryfront\//g, 'import "#veryfront/'],
  // Dynamic import("@veryfront/...") -> import("#veryfront/...")
  [/import\(["']@veryfront\//g, 'import("#veryfront/'],
  // from "@std/..." -> from "#std/..."
  [/from\s+["']@std\//g, 'from "#std/'],
  // import "@std/..." -> import "#std/..."
  [/import\s+["']@std\//g, 'import "#std/'],
  // Dynamic import("@std/...") -> import("#std/...")
  [/import\(["']@std\//g, 'import("#std/'],
];

interface MigrationResult {
  file: string;
  changes: number;
}

async function migrateFile(filePath: string): Promise<MigrationResult | null> {
  const content = await Deno.readTextFile(filePath);
  let newContent = content;
  let changes = 0;

  for (const [pattern, replacement] of REPLACEMENTS) {
    const matches = newContent.match(pattern);
    if (matches) {
      changes += matches.length;
      newContent = newContent.replace(pattern, replacement);
    }
  }

  if (changes === 0) {
    return null;
  }

  if (!DRY_RUN) {
    await Deno.writeTextFile(filePath, newContent);
  }

  return { file: filePath, changes };
}

async function main() {
  console.log(`Migration mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log("");

  const results: MigrationResult[] = [];
  let totalFiles = 0;
  let modifiedFiles = 0;
  let totalChanges = 0;

  // Walk through src/ and tests/ directories
  for (const dir of ["src/", "tests/"]) {
    for await (const entry of walk(dir, {
      exts: [".ts", ".tsx"],
      skip: [/node_modules/, /\.cache/, /dist/],
    })) {
      if (!entry.isFile) continue;
      totalFiles++;

      const result = await migrateFile(entry.path);
      if (result) {
        results.push(result);
        modifiedFiles++;
        totalChanges += result.changes;

        if (VERBOSE) {
          console.log(`  ${result.file}: ${result.changes} changes`);
        }
      }
    }
  }

  console.log("");
  console.log("=== Migration Summary ===");
  console.log(`Total files scanned: ${totalFiles}`);
  console.log(`Files modified: ${modifiedFiles}`);
  console.log(`Total import replacements: ${totalChanges}`);
  console.log("");

  if (DRY_RUN) {
    console.log("This was a dry run. Run without --dry-run to apply changes.");
  } else {
    console.log("Migration complete!");
  }

  // Show sample of changes
  if (results.length > 0 && VERBOSE) {
    console.log("");
    console.log("=== Files with most changes ===");
    const sorted = results.sort((a, b) => b.changes - a.changes).slice(0, 10);
    for (const r of sorted) {
      console.log(`  ${r.changes} changes: ${r.file}`);
    }
  }
}

main().catch(console.error);
