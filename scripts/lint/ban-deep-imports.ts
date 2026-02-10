#!/usr/bin/env -S deno run --allow-read
/**
 * Deep Import Linter
 *
 * Checks for imports that bypass barrel files (index.ts) in modules with established boundaries.
 * Helps enforce module encapsulation by preventing direct imports to internal module files.
 *
 * RULES:
 * - INTERNAL imports (within same module tree): Use relative paths (e.g., ./file.ts, ../file.ts) ✅
 * - EXTERNAL imports (from different modules): Use barrel files (e.g., #api, #data) ✅
 *
 * Examples:
 * ✅ CORRECT - Internal: server/build/build/build-executor.ts imports from '../static-generation.ts'
 * ✅ CORRECT - External: server/handlers/api.ts imports from '#api'
 * ❌ WRONG - External: server/handlers/api.ts imports from '../../api/handler.ts' (bypass barrel)
 *
 * Modules with barrel files (should use barrel for external imports):
 * - api/ (#api)
 * - cli/ (#cli)
 * - components/ (#components)
 * - data/ (#data)
 * - dev/ (#dev)
 * - modules/ (#modules)
 * - server/build/ (#server/build)
 * - server/build/build/ (#server/build/build)
 * - server/modules/ (#server/modules)
 * - rendering/cache/ (#rendering/cache)
 * - rendering/cache/stores/ (#rendering/cache/stores)
 * - rendering/utils/ (#rendering/utils)
 * - rendering/adapters/ (#rendering/adapters)
 * - rendering/rsc/actions/ (#rendering/rsc/actions)
 * - rendering/shared/constants/ (#rendering/shared/constants)
 */

const root = "src";

// Modules with barrel files that should not have deep imports from outside
const BARREL_MODULES = [
  "agent/middleware",
  "api",
  "cli",
  "components",
  "data",
  "dev",
  "html/hydration-script-builder/templates",
  "modules",
  "platform/adapters/runtime",
  "provider/adapters",
  "rendering/cache",
  "rendering/cache/stores",
  "rendering/client",
  "rendering/rsc/actions",
  "rendering/shared/constants",
  "rendering/utils",
  "security/http",
  "server/build",
  "server/build/build",
  "server/modules",
  "utils/cache",
  "utils/cache/stores/memory",
  "utils/constants",
  "utils/logger",
];

function shouldSkip(path: string): boolean {
  // Skip test files - they may need to test internals
  return path.includes("/tests/") || path.includes(".test.ts");
}

function getModuleFromPath(path: string): string {
  // Extract module path from file path
  // e.g., "src/api/handler.ts" -> "api"
  // e.g., "src/server/build/build/build-orchestrator.ts" -> "server/build/build"
  const parts = path.replace("src/", "").split("/");

  // Try to match against known barrel modules (longest match first)
  const sortedModules = [...BARREL_MODULES].sort((a, b) => b.length - a.length);
  for (const mod of sortedModules) {
    const modParts = mod.split("/");
    if (parts.slice(0, modParts.length).join("/") === mod) {
      return mod;
    }
  }

  // Fallback to top-level directory
  return parts[0] || "";
}

function extractImports(text: string): string[] {
  // Extract import statements (both static and dynamic)
  const imports: string[] = [];

  // Static imports: import ... from "..."
  const staticImportRegex = /import\s+(?:(?:\{[^}]*\})|(?:\*\s+as\s+\w+)|(?:\w+))?\s*(?:,\s*\{[^}]*\})?\s*from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = staticImportRegex.exec(text)) !== null) {
    if (match[1]) imports.push(match[1]);
  }

  // Dynamic imports: import("...")
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(text)) !== null) {
    if (match[1]) imports.push(match[1]);
  }

  // Export re-exports: export ... from "..."
  const exportRegex = /export\s+(?:(?:\{[^}]*\})|(?:\*))?\s*(?:as\s+\w+)?\s*from\s+['"]([^'"]+)['"]/g;
  while ((match = exportRegex.exec(text)) !== null) {
    if (match[1]) imports.push(match[1]);
  }

  return imports;
}

function isInSameModuleTree(sourceModule: string, targetModule: string): boolean {
  // Check if modules are in the same module tree
  // e.g., "server/build/build" is in the same tree as "server/build"
  // e.g., "rendering/cache" is in the same tree as "rendering/cache/stores"

  // Exact match
  if (sourceModule === targetModule) return true;

  // Check if one is a parent of the other
  const sourceParts = sourceModule.split("/");
  const targetParts = targetModule.split("/");

  // Find common root by comparing path segments
  const minLength = Math.min(sourceParts.length, targetParts.length);
  let commonDepth = 0;
  for (let i = 0; i < minLength; i++) {
    if (sourceParts[i] === targetParts[i]) {
      commonDepth++;
    } else {
      break;
    }
  }

  // If they share the same root directory, check if both are in BARREL_MODULES
  if (commonDepth > 0) {
    const commonRoot = sourceParts.slice(0, commonDepth).join("/");

    // Both modules must be registered as barrel modules under the same parent
    const sourceBelongs = BARREL_MODULES.some(m => sourceModule.startsWith(m) || m.startsWith(sourceModule));
    const targetBelongs = BARREL_MODULES.some(m => targetModule.startsWith(m) || m.startsWith(targetModule));

    if (sourceBelongs && targetBelongs) {
      // Check if they're in the same top-level module
      return sourceParts[0] === targetParts[0];
    }
  }

  return false;
}

function isDeepImport(
  sourcePath: string,
  importPath: string,
  sourceModule: string,
): { isDeep: boolean; targetModule?: string; suggestion?: string } {
  // Skip non-relative imports (npm packages, URLs, import maps)
  if (!importPath.startsWith("./") && !importPath.startsWith("../")) {
    return { isDeep: false };
  }

  // Resolve the import path relative to source file
  const sourceDir = sourcePath.split("/").slice(0, -1).join("/");
  const resolvedParts = [...sourceDir.split("/")];

  for (const part of importPath.split("/")) {
    if (part === "..") {
      resolvedParts.pop();
    } else if (part !== ".") {
      resolvedParts.push(part);
    }
  }

  const resolvedPath = resolvedParts.join("/");
  const targetModule = getModuleFromPath(resolvedPath);

  // INTERNAL IMPORT: If importing within the same module tree, relative imports are OK
  if (isInSameModuleTree(sourceModule, targetModule)) {
    return { isDeep: false };
  }

  // EXTERNAL IMPORT: If importing from a different barrel module
  if (BARREL_MODULES.includes(targetModule)) {
    // Check if importing index.ts (barrel file) - this is OK
    if (resolvedPath.endsWith(`/${targetModule}/index.ts`)) {
      return { isDeep: false };
    }

    // This is a deep import - bypassing the barrel file
    const suggestion = targetModule.includes("/")
      ? `#${targetModule.replace(/\//g, "/")}`
      : `#${targetModule}`;

    return {
      isDeep: true,
      targetModule,
      suggestion,
    };
  }

  return { isDeep: false };
}

interface Violation {
  file: string;
  line: number;
  importPath: string;
  targetModule: string;
  suggestion: string;
}

const violations: Violation[] = [];

async function walk(dir: string) {
  for await (const ent of Deno.readDir(dir)) {
    const full = `${dir}/${ent.name}`;
    if (ent.isDirectory) {
      await walk(full);
    } else if (ent.isFile && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
      if (shouldSkip(full)) continue;

      const text = await Deno.readTextFile(full);
      const sourceModule = getModuleFromPath(full);
      const imports = extractImports(text);

      for (const importPath of imports) {
        const result = isDeepImport(full, importPath, sourceModule);
        if (result.isDeep && result.targetModule && result.suggestion) {
          // Find line number
          const lines = text.split(/\r?\n/);
          const lineIdx = lines.findIndex((line) => line.includes(importPath));

          violations.push({
            file: full,
            line: lineIdx + 1,
            importPath,
            targetModule: result.targetModule,
            suggestion: result.suggestion,
          });
        }
      }
    }
  }
}

await walk(root);

if (violations.length > 0) {
  console.error("❌ Found deep imports bypassing barrel files:\n");

  // Group by target module for better readability
  const byModule = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = byModule.get(v.targetModule) || [];
    list.push(v);
    byModule.set(v.targetModule, list);
  }

  for (const [module, viols] of byModule.entries()) {
    console.error(`\n📦 Module: ${module}/`);
    const firstViol = viols[0];
    if (firstViol) {
      console.error(`   Suggested import: ${firstViol.suggestion}\n`);
    }
    for (const v of viols) {
      console.error(`   ${v.file}:${v.line}`);
      console.error(`   └─ import from "${v.importPath}"\n`);
    }
  }

  console.error(
    `\nTotal violations: ${violations.length}\n`,
  );
  console.error("💡 Tip: Use import map aliases (e.g., #api, #data) or import from barrel files (index.ts)\n");

  Deno.exit(1);
} else {
  console.log("✅ No deep imports found - all modules use barrel files correctly!");
}
