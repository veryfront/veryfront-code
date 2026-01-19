#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Migration script to add .ts extensions to #veryfront/* and #std/* imports.
 *
 * This enables Deno to resolve imports without --sloppy-imports flag.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/migrate-imports-add-extensions.ts
 *   deno run --allow-read --allow-write scripts/migrate-imports-add-extensions.ts --dry-run
 */

import { walk } from "https://deno.land/std@0.220.0/fs/walk.ts";
import { exists } from "https://deno.land/std@0.220.0/fs/exists.ts";
import { dirname, join } from "https://deno.land/std@0.220.0/path/mod.ts";

const DRY_RUN = Deno.args.includes("--dry-run");
const VERBOSE = Deno.args.includes("--verbose");

const PROJECT_ROOT = Deno.cwd();

interface MigrationResult {
  file: string;
  changes: number;
}

// Check if a path needs .ts extension by looking at the filesystem
async function needsExtension(importPath: string): Promise<boolean> {
  // Already has extension
  if (importPath.endsWith(".ts") || importPath.endsWith(".tsx") || importPath.endsWith(".js")) {
    return false;
  }

  // Map import path to filesystem path
  let fsPath: string;
  if (importPath.startsWith("#veryfront/")) {
    fsPath = join(PROJECT_ROOT, "src", importPath.slice("#veryfront/".length));
  } else if (importPath.startsWith("#std/")) {
    // #std/* maps to various places, check deno.json mappings
    // For simplicity, assume these need .ts if they don't have it
    return true;
  } else if (importPath.startsWith("#testing")) {
    fsPath = join(PROJECT_ROOT, "src/testing", importPath.slice("#testing".length) || "");
  } else {
    return false;
  }

  // Check if it's a file (needs .ts) or directory (needs /index.ts)
  const asFile = fsPath + ".ts";
  const asIndex = join(fsPath, "index.ts");

  const fileExists = await exists(asFile);
  const indexExists = await exists(asIndex);

  if (fileExists) {
    return true; // Add .ts
  }
  if (indexExists) {
    return false; // Don't add extension, it resolves to index.ts via explicit mapping
  }

  // Check for .tsx
  const asTsxFile = fsPath + ".tsx";
  if (await exists(asTsxFile)) {
    return true; // Will add .ts, then we'll fix to .tsx in a second pass
  }

  return false;
}

// Regex to match import statements with #veryfront/ or #std/ or #testing
const IMPORT_PATTERN = /(from\s+["']|import\s*\(\s*["'])(#veryfront\/[^"']+|#std\/[^"']+|#testing[^"']*)(["'])/g;

async function migrateFile(filePath: string): Promise<MigrationResult | null> {
  const content = await Deno.readTextFile(filePath);
  let newContent = content;
  let changes = 0;

  // Find all imports and check each one
  const matches = [...content.matchAll(IMPORT_PATTERN)];

  for (const match of matches) {
    const prefix = match[1];  // 'from "' or 'import("'
    const importPath = match[2];  // '#veryfront/testing/assert'
    const suffix = match[3];  // '"'

    // Skip if already has extension
    if (importPath.endsWith(".ts") || importPath.endsWith(".tsx") || importPath.endsWith(".js")) {
      continue;
    }

    // Check if this import needs an extension
    if (await needsExtension(importPath)) {
      const oldImport = `${prefix}${importPath}${suffix}`;
      const newImport = `${prefix}${importPath}.ts${suffix}`;

      // Only replace the first occurrence to avoid issues with duplicate matches
      const index = newContent.indexOf(oldImport);
      if (index !== -1) {
        newContent = newContent.slice(0, index) + newImport + newContent.slice(index + oldImport.length);
        changes++;

        if (VERBOSE) {
          console.log(`  ${importPath} -> ${importPath}.ts`);
        }
      }
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
  console.log("Adding .ts extensions to #veryfront/* and #std/* imports...");
  console.log("");

  const results: MigrationResult[] = [];
  let totalFiles = 0;
  let modifiedFiles = 0;
  let totalChanges = 0;

  // Walk through src/ directory
  for await (const entry of walk("src/", {
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
    }
  }

  console.log("");
  console.log("=== Migration Summary ===");
  console.log(`Total files scanned: ${totalFiles}`);
  console.log(`Files modified: ${modifiedFiles}`);
  console.log(`Total extensions added: ${totalChanges}`);
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
