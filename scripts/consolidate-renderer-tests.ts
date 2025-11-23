#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Consolidate Rendering Test Directories
 *
 * Merges tests/integration/render/, rendering/, and renderer/ into a single
 * tests/integration/renderer/ directory.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/consolidate-renderer-tests.ts
 *   deno run --allow-read --allow-write scripts/consolidate-renderer-tests.ts --dry-run
 */

import { walk } from "std/fs/walk.ts";
import { dirname, join, relative } from "std/path/mod.ts";

const DRY_RUN = Deno.args.includes("--dry-run");
const TARGET_DIR = "tests/integration/renderer";

interface MoveOperation {
  source: string;
  target: string;
  reason: string;
}

const operations: MoveOperation[] = [];

/**
 * Plan: Move files from render/ and rendering/ to renderer/
 */
async function planMoves() {
  // Move from render/ to renderer/
  const renderDir = "tests/integration/render";
  try {
    for await (const entry of walk(renderDir, { includeDirs: false, skip: [/node_modules/] })) {
      if (entry.isFile) {
        const relativePath = relative(renderDir, entry.path);
        const targetPath = join(TARGET_DIR, relativePath);

        // Handle duplicate: virtual-module-system.test.ts
        if (relativePath === "virtual-module-system.test.ts") {
          // The render/ version is more comprehensive (288 lines)
          // Rename it to be the main one, and rename renderer/ version to smoke test
          operations.push({
            source: entry.path,
            target: targetPath.replace(".test.ts", "-comprehensive.test.ts"),
            reason: "Merge comprehensive virtual-module-system tests",
          });

          // Mark renderer/ version for renaming
          const rendererVersion = join(TARGET_DIR, "virtual-module-system.test.ts");
          operations.push({
            source: rendererVersion,
            target: rendererVersion.replace(".test.ts", "-smoke.test.ts"),
            reason: "Rename existing simple tests to smoke tests",
          });
        } else {
          operations.push({
            source: entry.path,
            target: targetPath,
            reason: "Move from render/ to renderer/",
          });
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  // Move from rendering/ to renderer/
  const renderingDir = "tests/integration/rendering";
  try {
    for await (const entry of walk(renderingDir, { includeDirs: false, skip: [/node_modules/] })) {
      if (entry.isFile) {
        const relativePath = relative(renderingDir, entry.path);
        const targetPath = join(TARGET_DIR, relativePath);

        operations.push({
          source: entry.path,
          target: targetPath,
          reason: "Move from rendering/ to renderer/",
        });
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/**
 * Execute the move operations
 */
async function executeMoves() {
  let successCount = 0;
  let errorCount = 0;

  for (const op of operations) {
    try {
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would move:`);
        console.log(`  ${op.source}`);
        console.log(`  → ${op.target}`);
        console.log(`  Reason: ${op.reason}`);
        console.log();
      } else {
        // Ensure target directory exists
        const targetDir = dirname(op.target);
        await Deno.mkdir(targetDir, { recursive: true });

        // Move the file
        await Deno.rename(op.source, op.target);
        console.log(`✅ Moved: ${op.source} → ${op.target}`);
        successCount++;
      }
    } catch (error) {
      console.error(`❌ Failed to move ${op.source}:`, error);
      errorCount++;
    }
  }

  if (!DRY_RUN && operations.length > 0) {
    console.log(`\nCompleted: ${successCount} files moved, ${errorCount} errors`);
  }
}

/**
 * Remove empty directories
 */
async function cleanupEmptyDirs() {
  const dirsToRemove = [
    "tests/integration/render",
    "tests/integration/rendering",
  ];

  for (const dir of dirsToRemove) {
    try {
      if (DRY_RUN) {
        console.log(`[DRY RUN] Would remove empty directory: ${dir}`);
      } else {
        // Check if empty
        const entries = [];
        for await (const _ of Deno.readDir(dir)) {
          entries.push(_);
        }

        if (entries.length === 0) {
          await Deno.remove(dir);
          console.log(`✅ Removed empty directory: ${dir}`);
        } else {
          console.log(`ℹ️  Directory not empty, keeping: ${dir}`);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Already removed or doesn't exist
        continue;
      }
      console.error(`❌ Failed to remove ${dir}:`, error);
    }
  }
}

/**
 * Update imports in affected files
 */
async function updateImports() {
  console.log("\n📝 Checking for imports that need updating...");

  const filesToCheck: string[] = [];

  // Collect all test files that might have imports
  for await (
    const entry of walk("tests/integration", {
      exts: ["ts", "tsx"],
      skip: [/node_modules/],
    })
  ) {
    if (entry.isFile) {
      filesToCheck.push(entry.path);
    }
  }

  const importPatterns = [
    { old: "../render/", new: "../renderer/" },
    { old: "../rendering/", new: "../renderer/" },
    { old: "../../render/", new: "../../renderer/" },
    { old: "../../rendering/", new: "../../renderer/" },
    { old: "../../../render/", new: "../../../renderer/" },
    { old: "../../../rendering/", new: "../../../renderer/" },
  ];

  let updatedCount = 0;

  for (const filePath of filesToCheck) {
    try {
      let content = await Deno.readTextFile(filePath);
      let modified = false;

      for (const pattern of importPatterns) {
        if (content.includes(pattern.old)) {
          content = content.replaceAll(pattern.old, pattern.new);
          modified = true;
        }
      }

      if (modified) {
        if (DRY_RUN) {
          console.log(`[DRY RUN] Would update imports in: ${filePath}`);
        } else {
          await Deno.writeTextFile(filePath, content);
          console.log(`✅ Updated imports in: ${filePath}`);
          updatedCount++;
        }
      }
    } catch (error) {
      console.error(`❌ Failed to update ${filePath}:`, error);
    }
  }

  if (updatedCount > 0) {
    console.log(`\nUpdated imports in ${updatedCount} files`);
  } else {
    console.log("\nNo import updates needed");
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("🔍 Planning directory consolidation...\n");

  await planMoves();

  if (operations.length === 0) {
    console.log("✅ No files to move - directories already consolidated!");
    return;
  }

  console.log(`Found ${operations.length} operations to perform:\n`);

  // Group by source directory
  const bySource = new Map<string, MoveOperation[]>();
  for (const op of operations) {
    const sourceDir = dirname(op.source).split("/").slice(0, 3).join("/");
    if (!bySource.has(sourceDir)) {
      bySource.set(sourceDir, []);
    }
    bySource.get(sourceDir)!.push(op);
  }

  for (const [sourceDir, ops] of bySource.entries()) {
    console.log(`📁 From ${sourceDir}/`);
    for (const op of ops) {
      const sourceName = op.source.split("/").pop();
      const targetName = op.target.split("/").pop();
      if (sourceName !== targetName) {
        console.log(`   ${sourceName} → ${targetName}`);
      } else {
        console.log(`   ${sourceName}`);
      }
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - No files will be moved");
    console.log("Run without --dry-run to perform actual moves\n");
  } else {
    console.log("⚠️  About to move files and update imports.");
    console.log("Press Ctrl+C to cancel, or wait 3 seconds to proceed...\n");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  await executeMoves();
  await updateImports();
  await cleanupEmptyDirs();

  if (!DRY_RUN && operations.length > 0) {
    console.log("\n✅ Directory consolidation complete!");
    console.log("\n📝 Next steps:");
    console.log("1. Run tests to verify: deno task test");
    console.log("2. Review changes: git diff");
    console.log("3. Commit: git add . && git commit -m 'refactor: consolidate rendering test directories'");
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error);
    Deno.exit(1);
  });
}
