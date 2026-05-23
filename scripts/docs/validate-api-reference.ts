#!/usr/bin/env -S deno run --allow-read
/**
 * API Docs Validator
 *
 * Checks that:
 * 1. Every top-level `deno.json` export path has barrel JSDoc with both a
 *    `@module` tag and at least one `@example` block. This complements
 *    `lint:barrel-jsdoc` (which checks `@module` only) by also requiring
 *    examples.
 * 2. Every public import surface has a reference page at
 *    `docs/api-reference/veryfront/<slug>.md`. The root export maps to
 *    `index.md`. Synthetic parents that only own deep imports (e.g.
 *    `channels`) also require a page.
 * 3. The public `docs/api-reference/index.md` landing page exists.
 * 4. Generated reference tables do not contain known placeholder wording.
 *
 * Runs as part of `deno task verify`.
 *
 * Usage: deno run --allow-read scripts/docs/validate-api-reference.ts
 */

const ROOT = Deno.cwd();

/** Slugs that own only deep imports and have no top-level barrel JSDoc. */
const SYNTHETIC_PARENTS = new Set<string>(["channels"]);

interface ValidationError {
  exportPath: string;
  filePath: string;
  missing: ("@module" | "@example")[];
}

interface ReferencePageError {
  identifier: string;
  expectedPath: string;
}

interface ExtraReferencePageError {
  slug: string;
  path: string;
}

interface ReferenceQualityError {
  path: string;
  line: number;
  phrase: string;
  text: string;
}

const CASE_SENSITIVE_BAD_REFERENCE_PHRASES = [
  "Constant for ",
  "Function for ",
  "Interface for ",
  "Returns whether ",
  "Type alias for ",
  "Handle ",
] as const;

const CASE_INSENSITIVE_BAD_REFERENCE_PHRASES = [
  " a feature is enabled",
  " a part carries",
  "ctaprops",
  "internals value",
  "mcpregistry",
  "mcpstats",
  "open ai",
  "otlpwith",
  "rscenabled",
] as const;

function topLevelSlug(exportPath: string): string {
  if (exportPath === ".") return "index";
  return exportPath.replace("./", "").split("/")[0];
}

function extractReferenceDescription(line: string): string | undefined {
  const match = line.match(/^\|\s*`[^`]+`\s*\|\s*([^|]*?)\s*\|/);
  return match?.[1].trim();
}

function main(): void {
  const denoConfig = JSON.parse(Deno.readTextFileSync(`${ROOT}/deno.json`));
  const exports: Record<string, string> = denoConfig.exports ?? {};

  // Only check top-level export paths for JSDoc tags (skip deep subpaths).
  const topLevel = Object.entries(exports).filter(([path]) => {
    const parts = path.split("/");
    return parts.length <= 2;
  });

  const errors: ValidationError[] = [];
  const missingReferencePages: ReferencePageError[] = [];
  const extraReferencePages: ExtraReferencePageError[] = [];
  const referenceQualityErrors: ReferenceQualityError[] = [];

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

    // Check for JSDoc block.
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
  }

  // Required reference pages: one per top-level slug plus synthetic parents.
  const requiredSlugs = new Set<string>();
  for (const [exportPath] of Object.entries(exports)) {
    requiredSlugs.add(topLevelSlug(exportPath));
  }
  for (const slug of SYNTHETIC_PARENTS) {
    requiredSlugs.add(slug);
  }

  for (const slug of requiredSlugs) {
    const referencePath = `${ROOT}/docs/api-reference/veryfront/${slug}.md`;
    try {
      Deno.statSync(referencePath);
    } catch {
      missingReferencePages.push({
        identifier: slug === "index" ? "veryfront" : `veryfront/${slug}`,
        expectedPath: referencePath,
      });
    }
  }

  const referenceDir = `${ROOT}/docs/api-reference/veryfront`;
  try {
    for (const entry of Deno.readDirSync(referenceDir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const slug = entry.name.replace(/\.md$/, "");
      const path = `${referenceDir}/${entry.name}`;
      if (!requiredSlugs.has(slug)) {
        extraReferencePages.push({
          slug,
          path,
        });
      }

      const content = Deno.readTextFileSync(path);
      const lines = content.split("\n");
      for (const [index, text] of lines.entries()) {
        const description = extractReferenceDescription(text);
        if (!description) continue;
        for (const phrase of CASE_SENSITIVE_BAD_REFERENCE_PHRASES) {
          if (!description.includes(phrase)) continue;
          referenceQualityErrors.push({
            path,
            line: index + 1,
            phrase,
            text,
          });
        }
        const lowerDescription = description.toLowerCase();
        for (const phrase of CASE_INSENSITIVE_BAD_REFERENCE_PHRASES) {
          if (!lowerDescription.includes(phrase)) continue;
          referenceQualityErrors.push({
            path,
            line: index + 1,
            phrase,
            text,
          });
        }
      }
    }
  } catch {
    // Missing required pages above already reports the broken reference tree.
  }

  // Public section landing page that explains the section contents.
  const indexPath = `${ROOT}/docs/api-reference/index.md`;
  let indexMissing = false;
  try {
    Deno.statSync(indexPath);
  } catch {
    indexMissing = true;
  }

  if (
    errors.length === 0 &&
    missingReferencePages.length === 0 &&
    extraReferencePages.length === 0 &&
    referenceQualityErrors.length === 0 &&
    !indexMissing
  ) {
    console.log(
      `All ${topLevel.length} top-level export paths have @module and @example in their JSDoc.`,
    );
    console.log(
      `All ${requiredSlugs.size} reference pages exist under docs/api-reference/veryfront/.`,
    );
    console.log("docs/api-reference/index.md exists.");
    console.log("Generated reference pages passed placeholder wording checks.");
    Deno.exit(0);
  }

  if (errors.length > 0) {
    console.error(
      `${errors.length} export path(s) missing required JSDoc tags:\n`,
    );
    for (const err of errors) {
      console.error(`  ${err.exportPath} (${err.filePath})`);
      console.error(`    Missing: ${err.missing.join(", ")}`);
    }
    console.error(
      "\nAdd @module and @example JSDoc to each barrel file to document the public API.",
    );
  }

  if (missingReferencePages.length > 0) {
    console.error(
      `\n${missingReferencePages.length} reference page(s) missing under docs/api-reference/veryfront/:\n`,
    );
    for (const err of missingReferencePages) {
      console.error(`  ${err.identifier} -> ${err.expectedPath}`);
    }
    console.error("\nRun `deno task docs` to regenerate the reference tree.");
  }

  if (extraReferencePages.length > 0) {
    console.error(
      `\n${extraReferencePages.length} stale reference page(s) found under docs/api-reference/veryfront/:\n`,
    );
    for (const err of extraReferencePages) {
      console.error(`  ${err.slug} -> ${err.path}`);
    }
    console.error(
      "\nRun `deno task docs` to remove stale generated reference pages.",
    );
  }

  if (referenceQualityErrors.length > 0) {
    console.error(
      `\n${referenceQualityErrors.length} generated reference quality issue(s) found:\n`,
    );
    for (const err of referenceQualityErrors.slice(0, 30)) {
      console.error(`  ${err.path}:${err.line}`);
      console.error(`    Matched: ${err.phrase}`);
      console.error(`    ${err.text}`);
    }
    if (referenceQualityErrors.length > 30) {
      console.error(
        `  ... ${referenceQualityErrors.length - 30} more issue(s) omitted.`,
      );
    }
    console.error("\nFix the source JSDoc, then run `deno task docs`.");
  }

  if (indexMissing) {
    console.error(
      `\nMissing docs/api-reference/index.md (run \`deno task docs\`).`,
    );
  }

  Deno.exit(1);
}

main();
