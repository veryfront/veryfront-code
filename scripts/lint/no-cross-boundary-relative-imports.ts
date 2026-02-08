#!/usr/bin/env -S deno run --allow-read
/**
 * Cross-Boundary Relative Import Linter
 *
 * Ensures that imports crossing top-level src/ directory boundaries use
 * #veryfront/ import map aliases instead of relative paths.
 *
 * RULES:
 * - Within the same top-level module: relative imports are fine ✅
 *   e.g., src/rendering/renderer.ts → ./context/render-context.ts
 * - Crossing module boundaries: must use #veryfront/ alias ✅
 *   e.g., src/rendering/renderer.ts → #veryfront/cache/keys.ts
 * - Relative cross-boundary imports: violation ❌
 *   e.g., src/rendering/renderer.ts → ../../cache/keys.ts
 *
 * Does NOT check proxy/ or test files (they have separate concerns).
 */

const root = "src";

/** Top-level modules that are exempt from this rule */
const EXEMPT_MODULES = new Set([
  "proxy", // Isolated Docker process, uses own conventions
]);

function shouldSkip(path: string): boolean {
  return (
    path.includes("_test.") ||
    path.includes(".test.") ||
    path.includes("__tests__")
  );
}

function getTopLevelModule(filePath: string): string {
  // src/rendering/foo.ts → "rendering"
  const withoutSrc = filePath.replace(/^src\//, "");
  return withoutSrc.split("/")[0] ?? "";
}

function resolveRelativeImport(
  sourceFile: string,
  importPath: string,
): string {
  const sourceDir = sourceFile.split("/").slice(0, -1);
  const parts = [...sourceDir];

  for (const segment of importPath.split("/")) {
    if (segment === "..") {
      parts.pop();
    } else if (segment !== ".") {
      parts.push(segment);
    }
  }

  return parts.join("/");
}

function extractImportPaths(text: string): Array<{ path: string; line: number }> {
  const results: Array<{ path: string; line: number }> = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Match: import ... from "..." / export ... from "..."
    const matches = line.matchAll(/(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]/g);
    for (const m of matches) {
      if (m[1]) results.push({ path: m[1], line: i + 1 });
    }
  }

  return results;
}

interface Violation {
  file: string;
  line: number;
  importPath: string;
  sourceModule: string;
  targetModule: string;
}

const violations: Violation[] = [];

async function walk(dir: string) {
  for await (const ent of Deno.readDir(dir)) {
    const full = `${dir}/${ent.name}`;
    if (ent.isDirectory) {
      await walk(full);
    } else if (ent.isFile && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
      if (shouldSkip(full)) continue;

      const sourceModule = getTopLevelModule(full);
      if (EXEMPT_MODULES.has(sourceModule)) continue;

      const text = await Deno.readTextFile(full);
      const imports = extractImportPaths(text);

      for (const { path: importPath, line } of imports) {
        // Only check relative imports that go up
        if (!importPath.startsWith("../")) continue;

        const resolved = resolveRelativeImport(full, importPath);
        const targetModule = getTopLevelModule(resolved);

        // If the resolved path leaves src/ entirely (e.g., ../../deno.json)
        if (!resolved.startsWith("src/")) {
          violations.push({
            file: full,
            line,
            importPath,
            sourceModule,
            targetModule: "(outside src/)",
          });
          continue;
        }

        // Cross-boundary: different top-level module
        if (targetModule !== sourceModule) {
          violations.push({
            file: full,
            line,
            importPath,
            sourceModule,
            targetModule,
          });
        }
      }
    }
  }
}

await walk(root);

if (violations.length > 0) {
  console.error(
    `\n❌ Found ${violations.length} cross-boundary relative import(s):\n`,
  );

  // Group by source → target
  const grouped = new Map<string, Violation[]>();
  for (const v of violations) {
    const key = `${v.sourceModule} → ${v.targetModule}`;
    const list = grouped.get(key) || [];
    list.push(v);
    grouped.set(key, list);
  }

  for (const [edge, viols] of grouped.entries()) {
    console.error(`  ${edge} (${viols.length}):`);
    for (const v of viols) {
      console.error(`    ${v.file}:${v.line}`);
      console.error(`    └─ "${v.importPath}"`);

      // Suggest the #veryfront/ equivalent
      const resolved = resolveRelativeImport(v.file, v.importPath);
      const alias = resolved.replace(/^src\//, "#veryfront/");
      console.error(`    💡 use: "${alias}"\n`);
    }
  }

  console.error(
    "Use #veryfront/ import aliases for cross-module imports.\n" +
      'Example: import { foo } from "#veryfront/cache/keys.ts"\n',
  );

  Deno.exit(1);
} else {
  console.log(
    "✅ No cross-boundary relative imports — all modules use #veryfront/ aliases correctly!",
  );
}
