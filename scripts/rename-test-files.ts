#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Automated Test File Renaming Script
 *
 * Renames all `_test.ts` files to `.test.ts` with kebab-case naming.
 * This enforces the project's test naming convention.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/rename-test-files.ts
 *   deno run --allow-read --allow-write scripts/rename-test-files.ts --dry-run
 */

import { walk } from "std/fs/walk.ts";
import { dirname, join } from "std/path/mod.ts";

const DRY_RUN = Deno.args.includes("--dry-run");

interface RenameOperation {
  oldPath: string;
  newPath: string;
  reason: string;
}

/**
 * Convert snake_case or PascalCase to kebab-case
 */
function toKebabCase(str: string): string {
  return str
    // Handle PascalCase: insert hyphen before capitals
    .replace(/([A-Z])/g, "-$1")
    // Handle snake_case: replace underscores with hyphens
    .replace(/_/g, "-")
    // Lowercase everything
    .toLowerCase()
    // Remove leading hyphen if present
    .replace(/^-/, "")
    // Collapse multiple hyphens
    .replace(/-+/g, "-");
}

/**
 * Generate new filename following conventions
 */
function generateNewFilename(oldFilename: string): string | null {
  // Pattern 1: _test.ts -> .test.ts
  if (oldFilename.endsWith("_test.ts")) {
    const base = oldFilename.slice(0, -8); // Remove "_test.ts"
    const kebab = toKebabCase(base);
    return `${kebab}.test.ts`;
  }

  // Pattern 2: _test.tsx -> .test.tsx
  if (oldFilename.endsWith("_test.tsx")) {
    const base = oldFilename.slice(0, -9); // Remove "_test.tsx"
    const kebab = toKebabCase(base);
    return `${kebab}.test.tsx`;
  }

  // Not a file that needs renaming
  return null;
}

/**
 * Find all files that need renaming
 */
async function findFilesToRename(): Promise<RenameOperation[]> {
  const operations: RenameOperation[] = [];

  // Search in both tests/ and src/ directories
  for (const rootDir of ["tests", "src"]) {
    try {
      for await (
        const entry of walk(rootDir, {
          exts: ["ts", "tsx"],
          skip: [/node_modules/, /\.veryfront/, /coverage/],
        })
      ) {
        if (!entry.isFile) continue;

        const filename = entry.name;
        const newFilename = generateNewFilename(filename);

        if (newFilename && newFilename !== filename) {
          const dir = dirname(entry.path);
          const newPath = join(dir, newFilename);

          operations.push({
            oldPath: entry.path,
            newPath,
            reason: `Rename ${filename} to ${newFilename} (enforce naming convention)`,
          });
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.warn(`Directory ${rootDir} not found, skipping...`);
      } else {
        throw error;
      }
    }
  }

  return operations;
}

/**
 * Perform rename operations
 */
async function performRenames(operations: RenameOperation[]): Promise<void> {
  let successCount = 0;
  let errorCount = 0;

  for (const op of operations) {
    try {
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would rename:`);
        console.log(`  ${op.oldPath}`);
        console.log(`  → ${op.newPath}`);
        console.log(`  Reason: ${op.reason}`);
        console.log();
      } else {
        await Deno.rename(op.oldPath, op.newPath);
        console.log(`✅ Renamed: ${op.oldPath} → ${op.newPath}`);
        successCount++;
      }
    } catch (error) {
      console.error(`❌ Failed to rename ${op.oldPath}:`, error);
      errorCount++;
    }
  }

  if (!DRY_RUN) {
    console.log(`\nCompleted: ${successCount} files renamed, ${errorCount} errors`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("🔍 Scanning for files with old naming convention...\n");

  const operations = await findFilesToRename();

  if (operations.length === 0) {
    console.log("✅ No files found with old naming convention (_test.ts)");
    console.log("All test files already follow the .test.ts convention!");
    return;
  }

  console.log(`Found ${operations.length} files to rename:\n`);

  // Group by directory for better readability
  const byDirectory = new Map<string, RenameOperation[]>();
  for (const op of operations) {
    const dir = dirname(op.oldPath);
    if (!byDirectory.has(dir)) {
      byDirectory.set(dir, []);
    }
    byDirectory.get(dir)!.push(op);
  }

  // Display grouped operations
  for (const [dir, ops] of byDirectory.entries()) {
    console.log(`📁 ${dir}/`);
    for (const op of ops) {
      const oldName = op.oldPath.split("/").pop();
      const newName = op.newPath.split("/").pop();
      console.log(`   ${oldName} → ${newName}`);
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - No files were actually renamed");
    console.log("Run without --dry-run to perform actual renames\n");
  } else {
    console.log("⚠️  About to rename files. This operation cannot be undone.");
    console.log("Press Ctrl+C to cancel, or wait 3 seconds to proceed...\n");

    // Wait 3 seconds before proceeding
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  await performRenames(operations);

  if (!DRY_RUN && operations.length > 0) {
    console.log("\n📝 Next steps:");
    console.log("1. Update any imports referencing renamed files");
    console.log("2. Run tests to verify: deno task test");
    console.log("3. Commit changes: git add . && git commit -m 'chore: standardize test file naming'");
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    Deno.exit(1);
  });
}
