#!/usr/bin/env -S deno run --allow-read
/**
 * Guide Validator
 *
 * Checks that all public guide .md files in docs/getting-started/ and
 * docs/guides/ have:
 * 1. Valid frontmatter (title, description, order)
 * 2. Valid internal cross-references (relative .md links map to real files)
 * 3. Valid API reference links (relative ../api-reference/*.md links map to real files)
 * 4. Balanced code blocks (every ``` has a closing ```)
 * 5. Required sections (## Next or ## Related at the end)
 * 6. All guides listed in index.md exist as files
 *
 * Usage: deno run --allow-read scripts/docs/validate-guides.ts
 */

import { collectVeryfrontImports, createPublicImportValidator } from "./guide-validation.ts";

const ROOT = Deno.cwd();
const GETTING_STARTED_DIR = `${ROOT}/docs/getting-started`;
const GUIDES_DIR = `${ROOT}/docs/guides`;
const REF_DIR = `${ROOT}/docs/api-reference/veryfront`;

interface PublicDocFile {
  filename: string;
  filepath: string;
  section: "getting-started" | "guides";
  shortName: string;
  slug: string;
}

interface Issue {
  file: string;
  message: string;
}

const issues: Issue[] = [];
const warnings: Issue[] = [];
const guideOrders = new Map<string, string[]>();

function addIssue(file: string, message: string) {
  issues.push({ file, message });
}

function addWarning(file: string, message: string) {
  warnings.push({ file, message });
}

// Map from slug to expected guide metadata.
const GUIDE_SLUG_TO_FILE: Record<string, PublicDocFile> = {};
const REF_SLUG_TO_FILE: Record<string, string> = {};

// Collect all public guide .md files. README.md is repo-maintainer
// documentation, not a published guide, so it is skipped from guide validation.
const guideFiles: PublicDocFile[] = [];
for (
  const section of [
    { name: "getting-started" as const, dir: GETTING_STARTED_DIR },
    { name: "guides" as const, dir: GUIDES_DIR },
  ]
) {
  for (const entry of Deno.readDirSync(section.dir)) {
    if (entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md") {
      const slug = entry.name.replace(".md", "");
      const file = {
        filename: entry.name,
        filepath: `${section.dir}/${entry.name}`,
        section: section.name,
        shortName: `${section.name}/${entry.name}`,
        slug,
      };
      guideFiles.push(file);
      GUIDE_SLUG_TO_FILE[slug] = file;
    }
  }
}

// Collect all reference .md files
try {
  for (const entry of Deno.readDirSync(REF_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      const slug = entry.name.replace(".md", "");
      REF_SLUG_TO_FILE[slug] = entry.name;
    }
  }
} catch {
  addWarning("api-reference", "Could not read docs/api-reference/ directory");
}

// 1. Validate each guide file
for (const file of guideFiles) {
  const { filename, filepath, section, shortName } = file;
  const content = Deno.readTextFileSync(filepath);

  // --- Frontmatter ---
  if (!content.startsWith("---\n")) {
    addIssue(shortName, "Missing frontmatter (must start with ---)");
    continue;
  }

  const fmEnd = content.indexOf("\n---\n", 4);
  if (fmEnd === -1) {
    addIssue(shortName, "Malformed frontmatter (no closing ---)");
    continue;
  }

  const frontmatter = content.slice(4, fmEnd);
  const fmLines = frontmatter.split("\n");
  const fmKeys = fmLines
    .filter((l) => l.includes(":"))
    .map((l) => l.split(":")[0].trim());

  for (const required of ["title", "description", "order"]) {
    if (!fmKeys.includes(required)) {
      addIssue(shortName, `Missing frontmatter field: ${required}`);
    }
  }

  const orderLine = fmLines.find((line) => line.startsWith("order:"));
  if (orderLine) {
    const order = Number(orderLine.split(":")[1].trim());
    if (!Number.isInteger(order)) {
      addIssue(shortName, "Frontmatter field order must be an integer");
    } else {
      const key = `${section}:${order}`;
      const files = guideOrders.get(key) ?? [];
      files.push(filename);
      guideOrders.set(key, files);
    }
  }

  const body = content.slice(fmEnd + 5); // after \n---\n

  // --- Code blocks balanced ---
  const codeBlockMatches = body.match(/^```/gm);
  if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
    addIssue(shortName, `Unbalanced code blocks (${codeBlockMatches.length} \`\`\` markers, should be even)`);
  }

  // --- Internal docs links (relative) ---
  const markdownLinkRe = /\]\((\.{1,2}\/[^)#]+\.md)(?:#[^)]+)?\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkRe.exec(content))) {
    const target = match[1];
    const resolvedPath = new URL(target, `file://${filepath}`).pathname;
    try {
      const stat = Deno.statSync(resolvedPath);
      if (!stat.isFile) {
        addIssue(shortName, `Broken docs link: ${target} (not a file)`);
      }
    } catch {
      addIssue(shortName, `Broken docs link: ${target} (no matching file)`);
    }
  }

  // --- API reference links (relative) ---
  const refLinkRe = /\(\.\.\/api-reference\/veryfront\/([a-z0-9-]+)\.md\)/g;
  for (
    let refMatch = refLinkRe.exec(content);
    refMatch !== null;
    refMatch = refLinkRe.exec(content)
  ) {
    const slug = refMatch[1];
    if (!REF_SLUG_TO_FILE[slug]) {
      addWarning(
        shortName,
        `Reference link: ../api-reference/veryfront/${slug}.md (no matching file)`,
      );
    }
  }

  // --- Check for stale absolute links ---
  if (/\/code\/(guides|api|api-reference|getting-started)\//.test(content)) {
    addIssue(shortName, "Contains stale absolute /code/ docs links, should use relative paths");
  }

  // --- Required closing sections (skip index.md) ---
  if (filename !== "index.md") {
    const hasNext = body.includes("## Next");
    const hasRelated = body.includes("## Related");
    if (!hasNext && !hasRelated) {
      addWarning(shortName, "Missing both ## Next and ## Related sections");
    }
  }
}

for (const [key, files] of guideOrders) {
  if (files.length > 1) {
    addIssue(key.split(":")[0], `Duplicate guide order ${key.split(":")[1]}: ${files.join(", ")}`);
  }
}

// 2. Validate that every guide is listed in either index.md or
//    veryfront-code.md. Both files act as catalog roots: the Intro page
//    links onward to Veryfront Code, and Veryfront Code carries the
//    topic-grouped tables.
const catalogFiles = ["getting-started/index.md", "getting-started/veryfront-code.md"];
const listedSlugs = new Set<string>();

for (const catalogFile of catalogFiles) {
  const filepath = `${ROOT}/docs/${catalogFile}`;
  let content: string;
  try {
    content = Deno.readTextFileSync(filepath);
  } catch {
    addIssue(catalogFile, `Could not read ${catalogFile}`);
    continue;
  }

  const linkRe = /\((?:\.\/|\.\.\/guides\/|\.\.\/getting-started\/)([a-z0-9-]+)\.md\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(content))) {
    const slug = m[1];
    listedSlugs.add(slug);
    if (!GUIDE_SLUG_TO_FILE[slug]) {
      addIssue(
        catalogFile,
        `Catalog links to ${slug}.md but no file exists`,
      );
    }
  }
}

for (const file of guideFiles) {
  if (catalogFiles.includes(file.shortName)) continue;
  const slug = file.slug;
  if (!listedSlugs.has(slug)) {
    addWarning(
      "getting-started/index.md",
      `Guide "${slug}" not listed in getting-started/index.md or getting-started/veryfront-code.md`,
    );
  }
}

// 3. Check imports in code examples reference public package modules.
// Use deno.json exports as the source of truth. The import map also contains
// repo-local aliases that are not resolvable as package entrypoints.
const denoConfig = JSON.parse(Deno.readTextFileSync(`${ROOT}/deno.json`)) as {
  exports?: Record<string, unknown>;
};
const isKnownPublicImport = createPublicImportValidator(denoConfig.exports ?? {});

for (const file of guideFiles) {
  const { filepath, shortName } = file;
  const content = Deno.readTextFileSync(filepath);

  for (const mod of collectVeryfrontImports(content)) {
    if (!isKnownPublicImport(mod)) {
      addWarning(shortName, `Code example imports from "${mod}", not a known export path`);
    }
  }
}

// --- Report ---
console.log(`Validated ${guideFiles.length} public guide files.\n`);

if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`  ${w.file}: ${w.message}`);
  }
  console.log();
}

if (issues.length > 0) {
  console.error(`Errors (${issues.length}):`);
  for (const err of issues) {
    console.error(`  ${err.file}: ${err.message}`);
  }
  Deno.exit(1);
} else {
  console.log("All guides passed validation.");
}
