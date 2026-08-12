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
 */
const WRAPPED_RULES: Rule[] = [
  {
    pattern:
      /printed MCP (?:endpoint|URL|address)|prints the MCP (?:endpoint|URL|address)/i,
    message:
      "`veryfront dev` does not print the MCP endpoint by default. State the address instead: `--port` + 2 (default 3002), path `/mcp`.",
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
  {
    path: "docs/getting-started/quickstart.md",
    requirements: [
      {
        label: "state that the deployed environment is protected by default",
        pattern: /protected by default/i,
      },
    ],
  },
];

/**
 * `veryfront dev` prints `http://veryfront.me:<port>` and no other URL. Pages
 * that run the dev server and then tell the reader to open the app must name
 * that host, or the reader hits a banner that matches nothing in the doc.
 */
const PRINTED_DEV_SERVER_URL = "http://veryfront.me:3000";
const DEV_SERVER_PAGES = [
  "docs/getting-started/quickstart.md",
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
