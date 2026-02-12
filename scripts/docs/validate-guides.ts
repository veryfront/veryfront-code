#!/usr/bin/env -S deno run --allow-read
/**
 * Guide Validator
 *
 * Checks that all guide .md files in docs/guides/ have:
 * 1. Valid frontmatter (title, description, order)
 * 2. Valid internal cross-references (relative .md links map to real files)
 * 3. Valid API reference links (relative ../reference/*.md links map to real files)
 * 4. Balanced code blocks (every ``` has a closing ```)
 * 5. Required sections (## Next or ## Related at the end)
 * 6. All guides listed in index.md exist as files
 *
 * Usage: deno run --allow-read scripts/docs/validate-guides.ts
 */

const ROOT = Deno.cwd();
const GUIDES_DIR = `${ROOT}/docs/guides`;
const REF_DIR = `${ROOT}/docs/reference`;

interface Issue {
  file: string;
  message: string;
}

const issues: Issue[] = [];
const warnings: Issue[] = [];

function addIssue(file: string, message: string) {
  issues.push({ file, message });
}

function addWarning(file: string, message: string) {
  warnings.push({ file, message });
}

// Map from slug to expected filename
const GUIDE_SLUG_TO_FILE: Record<string, string> = {};
const REF_SLUG_TO_FILE: Record<string, string> = {};

// Collect all guide .md files
const guideFiles: string[] = [];
for (const entry of Deno.readDirSync(GUIDES_DIR)) {
  if (entry.isFile && entry.name.endsWith(".md")) {
    guideFiles.push(entry.name);
    const slug = entry.name.replace(".md", "");
    GUIDE_SLUG_TO_FILE[slug] = entry.name;
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
  addWarning("reference", "Could not read docs/reference/ directory");
}

// 1. Validate each guide file
for (const filename of guideFiles) {
  const filepath = `${GUIDES_DIR}/${filename}`;
  const content = Deno.readTextFileSync(filepath);
  const shortName = `guides/${filename}`;

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

  const body = content.slice(fmEnd + 5); // after \n---\n

  // --- Code blocks balanced ---
  const codeBlockMatches = body.match(/^```/gm);
  if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
    addIssue(shortName, `Unbalanced code blocks (${codeBlockMatches.length} \`\`\` markers — should be even)`);
  }

  // --- Internal guide links (relative) ---
  const guideLinkRe = /\(\.\/([a-z0-9-]+)\.md\)/g;
  let match: RegExpExecArray | null;
  while ((match = guideLinkRe.exec(content))) {
    const slug = match[1];
    if (!GUIDE_SLUG_TO_FILE[slug]) {
      addIssue(shortName, `Broken guide link: ./${slug}.md (no matching file)`);
    }
  }

  // --- API reference links (relative) ---
  const refLinkRe = /\(\.\.\/reference\/([a-z0-9-]+)\.md\)/g;
  while ((match = refLinkRe.exec(content))) {
    const slug = match[1];
    if (!REF_SLUG_TO_FILE[slug]) {
      addWarning(shortName, `Reference link: ../reference/${slug}.md (no matching file)`);
    }
  }

  // --- Check for stale absolute links ---
  if (/\/code\/(guides|api)\//.test(content)) {
    addIssue(shortName, "Contains stale absolute links (/code/guides/ or /code/api/) — should use relative paths");
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

// 2. Validate index.md lists all guide files
const indexPath = `${GUIDES_DIR}/index.md`;
try {
  const indexContent = Deno.readTextFileSync(indexPath);
  for (const filename of guideFiles) {
    if (filename === "index.md") continue;
    const slug = filename.replace(".md", "");
    if (!indexContent.includes(`./${slug}.md`)) {
      addWarning(`guides/index.md`, `Guide "${slug}" not listed in index`);
    }
  }

  // Check index links point to real files
  const indexLinkRe = /\(\.\/([a-z0-9-]+)\.md\)/g;
  let m: RegExpExecArray | null;
  while ((m = indexLinkRe.exec(indexContent))) {
    const slug = m[1];
    if (!GUIDE_SLUG_TO_FILE[slug]) {
      addIssue("guides/index.md", `Index links to ./${slug}.md but no file exists`);
    }
  }
} catch {
  addIssue("guides/index.md", "Could not read index.md");
}

// 3. Check imports in code examples reference real modules
const validImports = new Set([
  "veryfront",
  "veryfront/agent",
  "veryfront/tool",
  "veryfront/workflow",
  "veryfront/chat",
  "veryfront/provider",
  "veryfront/middleware",
  "veryfront/oauth",
  "veryfront/mcp",
  "veryfront/head",
  "veryfront/router",
  "veryfront/context",
  "veryfront/fonts",
  "veryfront/markdown",
  "veryfront/mdx",
  "veryfront/prompt",
  "veryfront/resource",
  "veryfront/fs",
]);

for (const filename of guideFiles) {
  const filepath = `${GUIDES_DIR}/${filename}`;
  const content = Deno.readTextFileSync(filepath);
  const shortName = `guides/${filename}`;

  const importRe = /from ["'](veryfront(?:\/[a-z-]+)?)["']/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(content))) {
    const mod = im[1];
    if (!validImports.has(mod)) {
      addWarning(shortName, `Code example imports from "${mod}" — not a known export path`);
    }
  }
}

// --- Report ---
console.log(`Validated ${guideFiles.length} guide files.\n`);

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
