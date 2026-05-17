#!/usr/bin/env -S deno run --allow-read
/**
 * API Docs Validator
 *
 * Checks that every top-level `deno.json` export path has barrel JSDoc with
 * both a `@module` tag and at least one `@example` block. This complements
 * `lint:barrel-jsdoc` (which checks `@module` only) by also requiring examples.
 *
 * Runs as part of `deno task verify`.
 *
 * Usage: deno run --allow-read scripts/docs/validate-api-docs.ts
 */

const ROOT = Deno.cwd();

interface ValidationError {
  exportPath: string;
  filePath: string;
  missing: ("@module" | "@example")[];
}

interface ReferencePageError {
  exportPath: string;
  expectedPath: string;
}

function main(): void {
  const denoConfig = JSON.parse(Deno.readTextFileSync(`${ROOT}/deno.json`));
  const exports: Record<string, string> = denoConfig.exports ?? {};

  // Only check top-level export paths (skip deep subpaths)
  const topLevel = Object.entries(exports).filter(([path]) => {
    const parts = path.split("/");
    return parts.length <= 2;
  });

  const errors: ValidationError[] = [];
  const missingReferencePages: ReferencePageError[] = [];

  for (const [exportPath, filePath] of topLevel) {
    const absPath = `${ROOT}/${filePath.replace("./", "")}`;

    let content: string;
    try {
      content = Deno.readTextFileSync(absPath);
    } catch {
      errors.push({ exportPath, filePath, missing: ["@module", "@example"] });
      continue;
    }

    const trimmed = content.trimStart();
    const missing: ("@module" | "@example")[] = [];

    // Check for JSDoc block
    if (!trimmed.startsWith("/**")) {
      missing.push("@module", "@example");
    } else {
      const endIdx = trimmed.indexOf("*/");
      if (endIdx === -1) {
        missing.push("@module", "@example");
      } else {
        const block = trimmed.slice(0, endIdx);
        if (!block.includes("@module")) missing.push("@module");
        if (!block.includes("@example")) missing.push("@example");
      }
    }

    if (missing.length > 0) {
      errors.push({ exportPath, filePath, missing });
    }

    const slug = exportPath === "." ? "root" : exportPath.replace("./", "");
    const referencePath = `${ROOT}/docs/reference/${slug}.md`;
    try {
      Deno.statSync(referencePath);
    } catch {
      missingReferencePages.push({ exportPath, expectedPath: referencePath });
    }
  }

  if (errors.length === 0 && missingReferencePages.length === 0) {
    console.log(`All ${topLevel.length} export paths have @module and @example in their JSDoc.`);
    console.log(`All ${topLevel.length} top-level export paths have reference pages.`);
    Deno.exit(0);
  }

  if (errors.length > 0) {
    console.error(`${errors.length} export path(s) missing required JSDoc tags:\n`);
    for (const err of errors) {
      console.error(`  ${err.exportPath} (${err.filePath})`);
      console.error(`    Missing: ${err.missing.join(", ")}`);
    }
    console.error(
      "\nAdd @module and @example JSDoc to each barrel file to document the public API.",
    );
  }

  if (missingReferencePages.length > 0) {
    console.error(`\n${missingReferencePages.length} top-level export path(s) missing reference pages:\n`);
    for (const err of missingReferencePages) {
      console.error(`  ${err.exportPath} -> ${err.expectedPath}`);
    }
    console.error("\nRun deno task docs, then preserve or merge any hand-written reference pages.");
  }
  Deno.exit(1);
}

main();
