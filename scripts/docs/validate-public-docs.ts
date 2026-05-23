#!/usr/bin/env -S deno run --allow-read
/**
 * Public docs quality validator.
 *
 * Checks published docs and the public README for style and boundary issues
 * that are easy to regress during generation or sync.
 */

const ROOT = Deno.cwd();

interface PublicDocIssue {
  path: string;
  line: number;
  message: string;
  text: string;
}

interface Rule {
  pattern: RegExp;
  message: string;
}

const PUBLIC_DOC_ROOTS = [
  "README.md",
  "docs/getting-started",
  "docs/guides",
  "docs/concepts",
  "docs/api-reference",
];

const MOVED_GETTING_STARTED_PAGES = [
  "quickstart",
  "installation",
  "create-project",
  "create-agent",
  "create-api",
  "create-frontend",
  "deploy-project",
  "veryfront-code",
];

const staleGettingStartedPath = new RegExp(
  String.raw`(?:https://veryfront\.com)?/docs/code/guides/(?:${
    MOVED_GETTING_STARTED_PAGES.join("|")
  })\b`,
);

const RULES: Rule[] = [
  {
    pattern: /\u2013|\u2014/,
    message:
      "Use ASCII punctuation in public docs. Replace en dash or em dash with '-' or punctuation.",
  },
  {
    pattern: /#veryfront\//,
    message: "Do not expose internal #veryfront imports in public docs.",
  },
  {
    pattern: /_test-setup/,
    message: "Do not expose test-only setup modules in public docs.",
  },
  {
    pattern: /\bInternal utilities\b/,
    message: "Do not describe public API pages as internal utilities.",
  },
  {
    pattern: /\bdeep-import-only\b/,
    message:
      "Do not expose implementation-only import taxonomy in public docs.",
  },
  {
    pattern: /\bmini tutorial\b/i,
    message:
      "Do not describe how-to guides as mini tutorials. Keep Diataxis tutorial and guide modes distinct.",
  },
  {
    pattern: /\bUse this module\b/,
    message:
      "Describe API reference modules neutrally. Do not use instructional 'Use this module' phrasing.",
  },
  {
    pattern: /\btask and concept guides\b/i,
    message:
      "Keep guides task-oriented. Use 'task guides and decision guides' instead of concept guide wording.",
  },
  {
    pattern: staleGettingStartedPath,
    message: "Use /docs/code/getting-started/ for moved Getting Started pages.",
  },
];

async function* walkMarkdownFiles(path: string): AsyncGenerator<string> {
  const absolute = `${ROOT}/${path}`;
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(absolute);
  } catch {
    return;
  }

  if (stat.isFile) {
    if (path.endsWith(".md") || path.endsWith(".mdx")) {
      yield path;
    }
    return;
  }

  if (!stat.isDirectory) return;

  for await (const entry of Deno.readDir(absolute)) {
    if (entry.name.startsWith(".")) continue;
    yield* walkMarkdownFiles(`${path}/${entry.name}`);
  }
}

function collectIssues(path: string, content: string): PublicDocIssue[] {
  const issues: PublicDocIssue[] = [];
  const lines = content.split("\n");
  for (const [index, text] of lines.entries()) {
    for (const rule of RULES) {
      if (!rule.pattern.test(text)) continue;
      issues.push({
        path,
        line: index + 1,
        message: rule.message,
        text,
      });
    }
  }
  return issues;
}

async function main(): Promise<void> {
  const files = new Set<string>();
  for (const root of PUBLIC_DOC_ROOTS) {
    for await (const file of walkMarkdownFiles(root)) {
      files.add(file);
    }
  }

  const issues: PublicDocIssue[] = [];
  for (const file of [...files].sort()) {
    const content = await Deno.readTextFile(`${ROOT}/${file}`);
    issues.push(...collectIssues(file, content));
  }

  if (issues.length === 0) {
    console.log(`Validated public docs quality across ${files.size} file(s).`);
    return;
  }

  console.error(`${issues.length} public docs quality issue(s) found:\n`);
  for (const issue of issues.slice(0, 60)) {
    console.error(`${issue.path}:${issue.line}: ${issue.message}`);
    console.error(`  ${issue.text}`);
  }
  if (issues.length > 60) {
    console.error(`... ${issues.length - 60} more issue(s) omitted.`);
  }
  Deno.exit(1);
}

await main();
