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

/**
 * The directories veryfront-docs copies into its published `docs/code/` tree.
 * Its sync workflow copies exactly these four and nothing else, so a relative
 * link out of one of them resolves inside this repository but 404s on the
 * published site. `docs/architecture/` is private implementation notes, which
 * makes that particular leak a boundary violation as well as a broken link.
 */
const SYNCED_DOC_DIRS = [
  "docs/getting-started",
  "docs/guides",
  "docs/concepts",
  "docs/api-reference",
];

/**
 * The sync deletes the `README.md` at the root of each synced directory, so
 * those files never reach the published site and may keep pointing readers of
 * this repository at private notes.
 */
const UNSYNCED_README_PATHS = SYNCED_DOC_DIRS.map((dir) => `${dir}/README.md`);

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)/g;

function isPublishedTarget(target: string): boolean {
  return SYNCED_DOC_DIRS.some((dir) =>
    target === dir || target.startsWith(`${dir}/`)
  );
}

/**
 * Resolve a POSIX path without touching the filesystem. The link may point at a
 * file that exists here and still be unpublished, so existence is not the
 * question this check asks.
 */
function resolveRelative(fromDir: string, href: string): string {
  const segments = `${fromDir}/${href}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

function collectUnpublishedLinkIssues(
  path: string,
  content: string,
): PublicDocIssue[] {
  if (!isPublishedTarget(path)) return [];
  if (UNSYNCED_README_PATHS.includes(path)) return [];

  const fromDir = path.slice(0, path.lastIndexOf("/"));
  const issues: PublicDocIssue[] = [];
  for (const [index, text] of content.split("\n").entries()) {
    MARKDOWN_LINK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_LINK.exec(text))) {
      const href = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|["'])/i.test(href)) continue;
      const target = resolveRelative(fromDir, href.split("#")[0]);
      if (isPublishedTarget(target)) continue;
      issues.push({
        path,
        line: index + 1,
        message:
          `Do not link published docs to ${target}. veryfront-docs publishes only ${
            SYNCED_DOC_DIRS.join(", ")
          }, so this link 404s on the site.`,
        text: text.trim(),
      });
    }
  }
  return issues;
}

const MOVED_GETTING_STARTED_PAGES = [
  "quickstart",
  "cloud-quickstart",
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
    pattern: /github\.com\/veryfront\/veryfront-examples/,
    message:
      "veryfront/veryfront-examples is a private repository. A reader following this link gets a 404, so link a public example or inline the code instead.",
  },
  {
    pattern: /\{@[A-Za-z]/,
    message:
      "Do not publish raw inline JSDoc tags. Regenerate the API reference after changing source JSDoc or the generator.",
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
  {
    pattern: /Ready on\s+`?\[?https?:\/\//i,
    message:
      "veryfront dev prints a '✓ Ready in <duration>' line followed by the URL on its own line. Do not document a 'Ready on <url>' line the CLI never prints.",
  },
];

/**
 * Rules that must survive prose wrapping, so they run against a line joined
 * with the one after it.
 *
 * The pattern below is deliberately byte-identical to the wrapped rule in
 * veryfront-docs' `scripts/check-code-docs-quality.mjs`. This validator exists
 * to predict that one, so narrowing the pattern here alone would let a page
 * pass in this repo and still fail the sync downstream, which is the exact
 * silent breakage this check was added to prevent. It is broad enough to reject
 * an accurate sentence about `--verbose` output; phrase such a sentence around
 * what the flag lists rather than what the server "prints", or change both
 * repositories in the same change.
 */
const WRAPPED_RULES: Rule[] = [
  {
    pattern:
      /printed MCP (?:endpoint|URL|address)|prints the MCP (?:endpoint|URL|address)/i,
    message:
      "`veryfront dev` does not print the MCP endpoint by default. State the address instead: two ports above the port the dev server bound (3002 for the default 3000), path `/mcp`.",
  },
];

interface CoverageRequirement {
  label: string;
  pattern: RegExp;
}

interface CoveragePage {
  path: string;
  requirements: CoverageRequirement[];
}

/**
 * Veryfront Cloud seeds production, staging, and preview as protected
 * environments, so an anonymous request to a fresh deployment is redirected to
 * the Veryfront sign-in page instead of the app. Every page that tells a reader
 * to deploy has to say so, or the reader ships a URL nobody else can open.
 *
 * These mirror the deploy-access coverage checks veryfront-docs runs against
 * the synced `docs/code/**` tree. Keeping them here as well means a PR that
 * drops the coverage fails in this repo, instead of silently breaking the docs
 * sync in a downstream repository nobody is watching.
 */
const DEPLOY_ACCESS_COVERAGE: CoveragePage[] = [
  {
    path: "docs/getting-started/cloud-quickstart.md",
    requirements: [
      {
        label:
          "state that Veryfront Cloud environments are protected by default",
        pattern: /protected by default/i,
      },
    ],
  },
  {
    path: "docs/getting-started/deploy-project.md",
    requirements: [
      {
        label:
          "state that Veryfront Cloud environments are protected by default",
        pattern: /protected by default/i,
      },
      {
        label:
          "state that an unauthenticated request is redirected to sign-in",
        pattern: /sign-in/i,
      },
      {
        label:
          "state that VERYFRONT_API_TOKEN does not open a protected environment",
        pattern: /VERYFRONT_API_TOKEN[^.]{0,120}does not open/i,
      },
      {
        label: "name the Studio switch that makes an environment public",
        pattern: /Public Environment/,
      },
    ],
  },
  {
    path: "docs/guides/deploying.md",
    requirements: [
      {
        label:
          "state that Veryfront Cloud environments are protected by default",
        pattern: /protected by default/i,
      },
      {
        label: "name the Studio switch that makes an environment public",
        pattern: /Public Environment/,
      },
    ],
  },
];

/**
 * `veryfront dev` prints `http://localhost:<port>` and no other URL. Pages
 * that run the dev server and then tell the reader to open the app must name
 * that host, or the reader hits a banner that matches nothing in the doc.
 */
const PRINTED_DEV_SERVER_URL = "http://localhost:3000";
const DEV_SERVER_PAGES = [
  "docs/getting-started/quickstart.md",
  "docs/getting-started/cloud-quickstart.md",
  "docs/getting-started/create-project.md",
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

  for (const rule of WRAPPED_RULES) {
    const hit = lines.findIndex((line, index) =>
      rule.pattern.test(`${line} ${lines[index + 1] ?? ""}`.replace(/\s+/g, " "))
    );
    if (hit === -1) continue;
    issues.push({
      path,
      line: hit + 1,
      message: rule.message,
      text: lines[hit].trim(),
    });
  }

  return issues;
}

async function collectCoverageIssues(): Promise<PublicDocIssue[]> {
  const issues: PublicDocIssue[] = [];

  for (const page of DEPLOY_ACCESS_COVERAGE) {
    const content = await Deno.readTextFile(`${ROOT}/${page.path}`);
    const flattened = content.replace(/\s+/g, " ");
    for (const requirement of page.requirements) {
      if (requirement.pattern.test(flattened)) continue;
      issues.push({
        path: page.path,
        line: 1,
        message: `Deploy pages must ${requirement.label}.`,
        text: String(requirement.pattern),
      });
    }
  }

  for (const page of DEV_SERVER_PAGES) {
    const content = await Deno.readTextFile(`${ROOT}/${page}`);
    if (content.includes(PRINTED_DEV_SERVER_URL)) continue;
    issues.push({
      path: page,
      line: 1,
      message:
        `\`veryfront dev\` prints ${PRINTED_DEV_SERVER_URL}. Show that URL before sending the reader to the app.`,
      text: "Missing the dev server URL the CLI prints.",
    });
  }

  return issues;
}

// Code-unit order, not locale order: the file list is reported verbatim.
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function main(): Promise<void> {
  const files = new Set<string>();
  for (const root of PUBLIC_DOC_ROOTS) {
    for await (const file of walkMarkdownFiles(root)) {
      files.add(file);
    }
  }

  const issues: PublicDocIssue[] = [];
  const sortedFiles = [...files].sort(compareCodeUnits);
  for (const file of sortedFiles) {
    const content = await Deno.readTextFile(`${ROOT}/${file}`);
    issues.push(...collectIssues(file, content));
    issues.push(...collectUnpublishedLinkIssues(file, content));
  }
  issues.push(...await collectCoverageIssues());

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
