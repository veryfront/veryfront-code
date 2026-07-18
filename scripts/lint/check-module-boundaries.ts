#!/usr/bin/env -S deno run --allow-read
/**
 * Module Boundary Checker (report-only)
 *
 * Walks src/**\/*.ts (excluding *.test.ts and generated files) and counts
 * import specifiers that deep-path into one of the three hot barrel modules
 * instead of importing from the barrel itself:
 *
 *   #veryfront/errors/<anything>   → should use  #veryfront/errors
 *   #veryfront/observability/<anything> → should use  #veryfront/observability
 *   #veryfront/utils/logger/<anything>  → should use  #veryfront/utils
 *
 * Currently exits 0 (report mode) so it can run in CI without breaking the
 * build.  Flip `REPORT_ONLY = false` once all existing deep imports have been
 * migrated to barrel imports to enforce the rule as a hard gate.
 */

const REPORT_ONLY = true;

const DEEP_IMPORT_PATTERNS: Array<{ label: string; prefix: string; barrel: string }> = [
  {
    label: "errors",
    prefix: "#veryfront/errors/",
    barrel: "#veryfront/errors",
  },
  {
    label: "observability",
    prefix: "#veryfront/observability/",
    barrel: "#veryfront/observability",
  },
  {
    label: "utils/logger",
    prefix: "#veryfront/utils/logger/",
    barrel: "#veryfront/utils",
  },
];

function shouldSkip(path: string): boolean {
  return path.endsWith(".test.ts") ||
    path.endsWith(".generated.ts") ||
    path.includes("/_generated/") ||
    path.includes("/generated/");
}

/** Extract all import/export specifier strings from TypeScript source. */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];

  // Static imports: import ... from "..."
  const staticRe =
    /import\s+(?:type\s+)?(?:(?:\{[^}]*\})|(?:\*\s+as\s+\w+)|(?:\w+))?\s*(?:,\s*\{[^}]*\})?\s*from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(source)) !== null) {
    if (m[1]) specifiers.push(m[1]);
  }

  // Side-effect imports: import "..."
  const sideEffectRe = /import\s+['"]([^'"]+)['"]/g;
  while ((m = sideEffectRe.exec(source)) !== null) {
    if (m[1]) specifiers.push(m[1]);
  }

  // Dynamic imports: import("...")
  const dynamicRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicRe.exec(source)) !== null) {
    if (m[1]) specifiers.push(m[1]);
  }

  // Re-exports: export ... from "..."
  const exportRe =
    /export\s+(?:type\s+)?(?:(?:\{[^}]*\})|(?:\*))?\s*(?:as\s+\w+)?\s*from\s+['"]([^'"]+)['"]/g;
  while ((m = exportRe.exec(source)) !== null) {
    if (m[1]) specifiers.push(m[1]);
  }

  return specifiers;
}

interface Hit {
  file: string;
  specifier: string;
  pattern: string;
}

const hits: Hit[] = [];

async function walk(dir: string): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      await walk(full);
    } else if (
      entry.isFile &&
      (full.endsWith(".ts") || full.endsWith(".tsx")) &&
      !shouldSkip(full)
    ) {
      const source = await Deno.readTextFile(full);
      for (const specifier of extractSpecifiers(source)) {
        for (const pattern of DEEP_IMPORT_PATTERNS) {
          if (specifier.startsWith(pattern.prefix)) {
            hits.push({ file: full, specifier, pattern: pattern.label });
          }
        }
      }
    }
  }
}

await walk("src");

if (hits.length === 0) {
  console.log("No deep barrel imports found — all three hot modules are imported via barrel.");
  Deno.exit(0);
}

// Tally counts per file for ranking
const countByFile = new Map<string, number>();
for (const hit of hits) {
  countByFile.set(hit.file, (countByFile.get(hit.file) ?? 0) + 1);
}

// Tally counts per pattern
const countByPattern = new Map<string, number>();
for (const hit of hits) {
  countByPattern.set(hit.pattern, (countByPattern.get(hit.pattern) ?? 0) + 1);
}

console.log("Module boundary report (deep imports that bypass barrel re-exports)");
console.log("=".repeat(70));
console.log();
console.log("By module:");
for (const p of DEEP_IMPORT_PATTERNS) {
  const count = countByPattern.get(p.label) ?? 0;
  if (count > 0) {
    console.log(`  ${p.label.padEnd(20)} ${count} deep import(s)  (use ${p.barrel} instead)`);
  }
}
console.log();
console.log(`Total deep imports: ${hits.length}`);
console.log();

const TOP_N = 10;
const topFiles = [...countByFile.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, TOP_N);

console.log(`Top ${Math.min(TOP_N, topFiles.length)} offending files:`);
for (const [file, count] of topFiles) {
  console.log(`  ${count.toString().padStart(3)}  ${file}`);
}
console.log();

if (REPORT_ONLY) {
  // NOTE: Change REPORT_ONLY to false (and the exit below to Deno.exit(1)) once
  // all existing deep imports have been migrated to barrel imports, then add
  // this script to the CI lint step so it enforces the boundary as a hard gate.
  console.log(
    "(report-only mode — exits 0; set REPORT_ONLY=false to enforce in CI)",
  );
  Deno.exit(0);
} else {
  Deno.exit(1);
}
