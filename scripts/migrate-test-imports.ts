#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Codemod script to migrate test imports from Deno-specific modules
 * to the portable #veryfront/testing modules.
 *
 * Transformations:
 * - `@std/assert` → `#veryfront/testing/assert`
 * - `@std/testing/bdd` → `#veryfront/testing/bdd`
 * - `Deno.makeTempDir()` → `makeTempDir()` from `#veryfront/testing/deno-compat`
 * - `Deno.makeTempFile()` → `makeTempFile()` from `#veryfront/testing/deno-compat`
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/migrate-test-imports.ts
 *   deno run --allow-read --allow-write scripts/migrate-test-imports.ts --dry-run
 */

import { walk } from "https://deno.land/std@0.220.0/fs/walk.ts";
import { join, relative } from "https://deno.land/std@0.220.0/path/mod.ts";

const DRY_RUN = Deno.args.includes("--dry-run");
const VERBOSE = Deno.args.includes("--verbose") || DRY_RUN;

interface Migration {
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
  addImport?: string;
}

// Define migrations
const migrations: Migration[] = [
  // @std/assert → #veryfront/testing/assert
  {
    pattern: /from\s+["']@std\/assert["']/g,
    replacement: 'from "#veryfront/testing/assert"',
  },
  // @std/testing/bdd → #veryfront/testing/bdd
  {
    pattern: /from\s+["']@std\/testing\/bdd["']/g,
    replacement: 'from "#veryfront/testing/bdd"',
  },
  // @std/testing → #veryfront/testing/bdd (when used for BDD)
  {
    pattern: /from\s+["']@std\/testing["']/g,
    replacement: 'from "#veryfront/testing/bdd"',
  },
  // @std/path → portable path compat
  {
    pattern: /from\s+["']@std\/path["']/g,
    replacement: 'from "#veryfront/compat/path"',
  },
];

// Patterns that need additional imports
const additionalImports: Array<{
  pattern: RegExp;
  importStatement: string;
  checkPattern: RegExp;
}> = [
  // Deno.makeTempDir() needs import from deno-compat
  {
    pattern: /Deno\.makeTempDir\s*\(/,
    importStatement: 'import { makeTempDir } from "#veryfront/testing/deno-compat";',
    checkPattern: /makeTempDir/,
  },
  // Deno.makeTempFile() needs import from deno-compat
  {
    pattern: /Deno\.makeTempFile\s*\(/,
    importStatement: 'import { makeTempFile } from "#veryfront/testing/deno-compat";',
    checkPattern: /makeTempFile/,
  },
];

// Replacements for Deno API calls
const apiReplacements: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  // Deno.makeTempDir() → makeTempDir()
  {
    pattern: /Deno\.makeTempDir\s*\(/g,
    replacement: "makeTempDir(",
  },
  // Deno.makeTempFile() → makeTempFile()
  {
    pattern: /Deno\.makeTempFile\s*\(/g,
    replacement: "makeTempFile(",
  },
];

async function processFile(filePath: string): Promise<{
  modified: boolean;
  changes: string[];
}> {
  const content = await Deno.readTextFile(filePath);
  let newContent = content;
  const changes: string[] = [];

  // Apply import migrations
  for (const migration of migrations) {
    if (migration.pattern.test(newContent)) {
      const before = newContent;
      if (typeof migration.replacement === "string") {
        newContent = newContent.replace(migration.pattern, migration.replacement);
      } else {
        newContent = newContent.replace(migration.pattern, migration.replacement);
      }
      if (before !== newContent) {
        changes.push(`Import: ${migration.pattern.source} → ${migration.replacement}`);
      }
    }
  }

  // Check for patterns that need additional imports
  const importsToAdd: string[] = [];
  for (const { pattern, importStatement, checkPattern } of additionalImports) {
    if (pattern.test(newContent) && !checkPattern.test(newContent.split("\n")[0])) {
      // Check if import already exists
      if (!newContent.includes(importStatement.replace(/^import /, ""))) {
        importsToAdd.push(importStatement);
        changes.push(`Add import: ${importStatement}`);
      }
    }
  }

  // Add imports at the top of the file (after any existing imports)
  if (importsToAdd.length > 0) {
    // Find the last import statement
    const lines = newContent.split("\n");
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ") || lines[i].match(/^import\s*{/)) {
        lastImportIndex = i;
      }
    }

    if (lastImportIndex >= 0) {
      lines.splice(lastImportIndex + 1, 0, ...importsToAdd);
      newContent = lines.join("\n");
    } else {
      // No imports found, add at the very top
      newContent = importsToAdd.join("\n") + "\n" + newContent;
    }
  }

  // Apply API replacements
  for (const { pattern, replacement } of apiReplacements) {
    if (pattern.test(newContent)) {
      const before = newContent;
      newContent = newContent.replace(pattern, replacement);
      if (before !== newContent) {
        changes.push(`API: ${pattern.source} → ${replacement}`);
      }
    }
  }

  const modified = content !== newContent;

  if (modified && !DRY_RUN) {
    await Deno.writeTextFile(filePath, newContent);
  }

  return { modified, changes };
}

async function main() {
  console.log(`\n🔄 Migrating test imports to portable #veryfront/testing modules...\n`);

  if (DRY_RUN) {
    console.log("📋 DRY RUN - No files will be modified\n");
  }

  const rootDir = Deno.cwd();
  const testDirs = ["src", "tests", "proxy"];
  let totalFiles = 0;
  let modifiedFiles = 0;

  for (const dir of testDirs) {
    const fullPath = join(rootDir, dir);
    try {
      await Deno.stat(fullPath);
    } catch {
      console.log(`⚠️  Directory not found: ${dir}`);
      continue;
    }

    console.log(`📁 Processing ${dir}/...`);

    for await (const entry of walk(fullPath, {
      exts: [".ts", ".tsx"],
      match: [/\.test\.ts$/, /\.test\.tsx$/],
      skip: [/node_modules/, /dist/, /coverage/],
    })) {
      if (!entry.isFile) continue;

      totalFiles++;
      const relPath = relative(rootDir, entry.path);

      const { modified, changes } = await processFile(entry.path);

      if (modified) {
        modifiedFiles++;
        if (VERBOSE) {
          console.log(`  ✏️  ${relPath}`);
          for (const change of changes) {
            console.log(`      - ${change}`);
          }
        }
      }
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   Total test files: ${totalFiles}`);
  console.log(`   Modified files: ${modifiedFiles}`);

  if (DRY_RUN) {
    console.log(`\n💡 Run without --dry-run to apply changes`);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  Deno.exit(1);
});
