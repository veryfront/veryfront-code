#!/usr/bin/env -S deno run --allow-read

/**
 * Architecture Validation Script
 *
 * Enforces architectural constraints on the handler system:
 * - Maximum 3 levels deep from src/server/handlers/
 * - No nested handlers/ directories (handlers within handlers)
 * - Maximum 150 LOC per handler file
 * - Consistent .handler.ts naming for handler files
 *
 * Run: deno task validate:architecture
 * Or:  deno run --allow-read scripts/validate-architecture.ts
 */

import { walk } from "jsr:@std/fs/walk";

interface ValidationRule {
  name: string;
  check: () => Promise<Violation[]>;
}

interface Violation {
  rule: string;
  path: string;
  message: string;
  severity: "error" | "warning";
}

const HANDLERS_ROOT = "src/server/handlers";
const MAX_DEPTH = 3; // Maximum depth from handlers/ to any file
const MAX_HANDLER_LOC = 150; // Maximum lines of code for a handler file
const HANDLER_PATTERN = /\.handler\.ts$/;

async function countLines(path: string): Promise<number> {
  const content = await Deno.readTextFile(path);
  return content.split("\n").length;
}

async function checkMaxDepth(): Promise<Violation[]> {
  const violations: Violation[] = [];

  try {
    for await (const entry of walk(HANDLERS_ROOT, { includeFiles: true })) {
      if (!entry.isFile) continue;

      // Calculate depth from HANDLERS_ROOT
      const relativePath = entry.path.replace(HANDLERS_ROOT + "/", "");
      const segments = relativePath.split("/");
      const depth = segments.length;

      if (depth > MAX_DEPTH) {
        violations.push({
          rule: "max-depth",
          path: entry.path,
          message: `File is ${depth} levels deep (max: ${MAX_DEPTH}). Path: ${relativePath}`,
          severity: "error",
        });
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      // Directory doesn't exist yet, that's OK
      return [];
    }
    throw e;
  }

  return violations;
}

async function checkNoNestedHandlers(): Promise<Violation[]> {
  const violations: Violation[] = [];

  try {
    for await (const entry of walk(HANDLERS_ROOT, { includeDirs: true })) {
      if (!entry.isDirectory) continue;
      if (entry.name !== "handlers") continue;

      // Skip the root handlers directory itself
      if (entry.path === HANDLERS_ROOT) continue;

      violations.push({
        rule: "no-nested-handlers",
        path: entry.path,
        message: `Found nested "handlers" directory. This creates confusion.`,
        severity: "error",
      });
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return [];
    }
    throw e;
  }

  return violations;
}

async function checkHandlerLOC(): Promise<Violation[]> {
  const violations: Violation[] = [];

  try {
    for await (const entry of walk(HANDLERS_ROOT, { includeFiles: true })) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".ts")) continue;

      // Only check files that look like handlers (have "handler" in name or are in handlers dir)
      const isHandler =
        entry.name.includes("handler") ||
        entry.name.includes("Handler") ||
        HANDLER_PATTERN.test(entry.name);

      if (!isHandler) continue;

      // Skip test files
      if (entry.name.includes(".test.")) continue;

      const loc = await countLines(entry.path);
      if (loc > MAX_HANDLER_LOC) {
        violations.push({
          rule: "max-handler-loc",
          path: entry.path,
          message: `Handler has ${loc} lines (max: ${MAX_HANDLER_LOC}). Consider extracting to a service.`,
          severity: "warning",
        });
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return [];
    }
    throw e;
  }

  return violations;
}

async function checkNamingConvention(): Promise<Violation[]> {
  const violations: Violation[] = [];
  const exceptions = new Set([
    "index.ts",
    "types.ts",
    "base.ts",
    "cors.ts", // Will be renamed in Phase 2
    "not-found.ts", // Will be renamed in Phase 2
  ]);

  try {
    // Only check direct handler files (not deep nested ones)
    for await (const entry of walk(HANDLERS_ROOT, { includeFiles: true, maxDepth: 3 })) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.includes(".test.")) continue;
      if (exceptions.has(entry.name)) continue;

      // Check if file contains a handler class
      const content = await Deno.readTextFile(entry.path);
      const hasHandlerClass = /export\s+class\s+\w+Handler\s+extends\s+BaseHandler/.test(
        content
      );

      if (hasHandlerClass && !HANDLER_PATTERN.test(entry.name)) {
        violations.push({
          rule: "naming-convention",
          path: entry.path,
          message: `Handler file should use .handler.ts suffix. Found: ${entry.name}`,
          severity: "warning",
        });
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return [];
    }
    throw e;
  }

  return violations;
}

async function main() {
  console.log("🏗️  Architecture Validation\n");
  console.log("Checking architectural constraints...\n");

  const rules: ValidationRule[] = [
    { name: "Maximum Depth (3 levels)", check: checkMaxDepth },
    { name: "No Nested Handlers", check: checkNoNestedHandlers },
    { name: "Handler LOC Limit", check: checkHandlerLOC },
    { name: "Naming Convention", check: checkNamingConvention },
  ];

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const rule of rules) {
    const violations = await rule.check();
    const errors = violations.filter((v) => v.severity === "error");
    const warnings = violations.filter((v) => v.severity === "warning");

    if (violations.length === 0) {
      console.log(`✅ ${rule.name}: PASS`);
    } else {
      if (errors.length > 0) {
        console.log(`❌ ${rule.name}: ${errors.length} error(s)`);
        errors.forEach((v) => console.log(`   ${v.path}: ${v.message}`));
      }
      if (warnings.length > 0) {
        console.log(`⚠️  ${rule.name}: ${warnings.length} warning(s)`);
        warnings.forEach((v) => console.log(`   ${v.path}: ${v.message}`));
      }
    }

    totalErrors += errors.length;
    totalWarnings += warnings.length;
  }

  console.log("\n---");
  console.log(`Total: ${totalErrors} error(s), ${totalWarnings} warning(s)`);

  if (totalErrors > 0) {
    console.log("\n❌ Architecture validation FAILED");
    Deno.exit(1);
  }

  if (totalWarnings > 0) {
    console.log("\n⚠️  Architecture validation passed with warnings");
    Deno.exit(0);
  }

  console.log("\n✅ Architecture validation PASSED");
  Deno.exit(0);
}

main();
