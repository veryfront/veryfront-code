#!/usr/bin/env -S deno run --allow-read
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import {
  analyzeContent,
  type ContentDestination,
  type ContentSyntax,
  type ContentSyntaxDiagnostic,
} from "@veryfront/ext-content-mdx/analysis";

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

const PUBLIC_DOC_ROOTS = ["README.md", ...SYNCED_DOC_DIRS];

/**
 * The sync deletes the `README.md` at the root of each synced directory, so
 * those files never reach the published site and may keep pointing readers of
 * this repository at private notes.
 */
const UNSYNCED_README_PATHS = SYNCED_DOC_DIRS.map((dir) => `${dir}/README.md`);

type DestinationSyntax = ContentDestination["syntax"];
type DocumentSyntax = ContentSyntax;
/** Any origin works: only the resolved path is read back out. */
const RESOLUTION_ORIGIN = "https://docs.invalid";
const VERYFRONT_DOCS_HOSTNAME = "veryfront.com";
const VERYFRONT_CODE_DOCS_PREFIX = "/docs/code/";
const VERYFRONT_SITE_CODE_PREFIX = "/code/";

function isPublishedPage(target: string): boolean {
  // The sync deletes the section README before publishing, so a link to one
  // 404s exactly like a link out of the tree.
  if (
    UNSYNCED_README_PATHS.includes(target) ||
    UNSYNCED_README_PATHS.some((path) => target === path.slice(0, -3))
  ) return false;
  return SYNCED_DOC_DIRS.some((dir) =>
    target === dir || target.startsWith(`${dir}/`)
  );
}

export function publishedTargetCandidates(target: string): string[] {
  if (!isPublishedPage(target)) return [];
  const directoryRoute = target.endsWith("/");
  const path = target.replace(/\/$/, "");
  return [
    ...(directoryRoute ? [] : [path, `${path}.md`, `${path}.mdx`]),
    `${path}/index.md`,
    `${path}/index.mdx`,
  ];
}

export function publishedTargetExists(
  target: string,
  stat: (path: string) => { readonly isFile: boolean } = Deno.statSync,
): boolean {
  for (const candidate of publishedTargetCandidates(target)) {
    try {
      const entry = stat(`${ROOT}/${candidate}`);
      if (entry.isFile) return true;
    } catch {
      // Try the next published-route spelling.
    }
  }
  return false;
}

function decodeMarkdownCharacterReferences(href: string): string {
  return href.replace(
    /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]+));/g,
    (reference, decimal: string, hexadecimal: string, named: string) => {
      if (named !== undefined) {
        const decoded = decodeNamedCharacterReference(named);
        return decoded === false ? reference : decoded;
      }
      const codePoint = Number.parseInt(
        decimal ?? hexadecimal,
        decimal ? 10 : 16,
      );
      if (
        !Number.isInteger(codePoint) || codePoint <= 0 ||
        codePoint > 0x10ffff ||
        codePoint >= 0xd800 && codePoint <= 0xdfff
      ) return "\uFFFD";
      return String.fromCodePoint(codePoint);
    },
  );
}

function decodeMarkdownBackslashEscapes(href: string): string {
  return href.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    "$1",
  );
}

function decodeUrlComponentTolerantly(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (encoded) => {
    let decoded = "";
    for (let start = 0; start < encoded.length;) {
      // A UTF-8 code point occupies at most four bytes, so no successful
      // decoding boundary requires retrying the full remaining suffix.
      let end = Math.min(encoded.length, start + 4 * 3);
      let consumed = false;
      for (; end > start; end -= 3) {
        try {
          decoded += decodeURIComponent(encoded.slice(start, end));
          start = end;
          consumed = true;
          break;
        } catch {
          // Try a shorter complete UTF-8 sequence.
        }
      }
      if (!consumed) {
        decoded += encoded.slice(start, start + 3);
        start += 3;
      }
    }
    return decoded;
  });
}

function decodeUrlPathForRepositoryMatch(value: string): string {
  return value.replace(/(?:%[0-9a-fA-F]{2})+/g, (encoded) => {
    const decoded = decodeUrlComponentTolerantly(encoded);
    return /^[A-Za-z0-9._~-]+$/.test(decoded) ? decoded : encoded;
  });
}

function normalizeRepositoryPath(pathname: string): string {
  const decoded = decodeUrlComponentTolerantly(pathname);
  const slashPath = decoded.replaceAll("\\", "/");
  const segments: string[] = [];
  for (const segment of slashPath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return slashPath.endsWith("/") && normalized !== ""
    ? `${normalized}/`
    : normalized;
}

/**
 * Resolve a destination the way a browser does, then read back the path.
 *
 * Hand-rolling this over `/` segments misses every spelling of a traversal a
 * reader's browser still follows: `..\architecture\` (a special scheme treats
 * a backslash as a separator), `.%2e/` (a percent-encoded dot segment is still
 * a dot segment), and a trailing `?query` that leaves the path unchanged.
 * Returns undefined when the destination is not a resolvable path.
 */
function resolveDocumentationTarget(
  fromPath: string,
  rawHref: string,
  syntax: DestinationSyntax,
): string | undefined {
  const withCharacterReferences = syntax === "markdown" ||
      syntax === "html-attribute"
    ? decodeMarkdownCharacterReferences(rawHref)
    : rawHref;
  const href = syntax === "markdown"
    ? decodeMarkdownBackslashEscapes(withCharacterReferences)
    : withCharacterReferences;
  if (href.startsWith("#")) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(href, `${RESOLUTION_ORIGIN}/${fromPath}`);
  } catch {
    return undefined;
  }
  const normalizedPathname = `/${normalizeRepositoryPath(resolved.pathname)}`;
  let pathname: string;
  if (
    (resolved.protocol === "http:" || resolved.protocol === "https:") &&
    resolved.hostname === VERYFRONT_DOCS_HOSTNAME && resolved.port === ""
  ) {
    const prefix = normalizedPathname.startsWith(VERYFRONT_CODE_DOCS_PREFIX)
      ? VERYFRONT_CODE_DOCS_PREFIX
      : normalizedPathname.startsWith(VERYFRONT_SITE_CODE_PREFIX)
      ? VERYFRONT_SITE_CODE_PREFIX
      : undefined;
    if (prefix === undefined) {
      return undefined;
    }
    pathname = `/docs/${normalizedPathname.slice(prefix.length)}`;
  } else if (
    resolved.origin === RESOLUTION_ORIGIN &&
    /^[\/\\]/.test(href) &&
    normalizedPathname.startsWith(VERYFRONT_CODE_DOCS_PREFIX)
  ) {
    pathname = `/docs/${
      normalizedPathname.slice(VERYFRONT_CODE_DOCS_PREFIX.length)
    }`;
  } else if (
    resolved.origin === RESOLUTION_ORIGIN &&
    /^[\/\\]/.test(href) &&
    normalizedPathname.startsWith(VERYFRONT_SITE_CODE_PREFIX)
  ) {
    pathname = `/docs/${
      normalizedPathname.slice(VERYFRONT_SITE_CODE_PREFIX.length)
    }`;
  } else {
    if (resolved.origin !== RESOLUTION_ORIGIN || /^[\/\\]/.test(href)) {
      return undefined;
    }
    pathname = normalizedPathname;
  }
  return normalizeRepositoryPath(pathname);
}

/** A link destination and where it starts, so an issue can name its line. */
export interface Destination {
  href: string;
  offset: number;
  syntax: DestinationSyntax;
}

type DestinationAnalysis =
  | { readonly kind: "document"; readonly destinations: readonly Destination[] }
  | {
    readonly kind: "syntax-error";
    readonly diagnostic: ContentSyntaxDiagnostic;
  };

type PublicDocAnalysis =
  | { readonly kind: "document"; readonly destinations: readonly Destination[] }
  | { readonly kind: "syntax-error"; readonly issue: PublicDocIssue };

export class PublicDocSyntaxError extends Error {
  readonly diagnostic: ContentSyntaxDiagnostic;

  constructor(syntax: DocumentSyntax, diagnostic: ContentSyntaxDiagnostic) {
    const label = syntax === "mdx" ? "MDX" : "Markdown";
    super(
      `Invalid ${label} syntax at ${diagnostic.range.start.line}:${diagnostic.range.start.column}: ${diagnostic.message}`,
    );
    this.name = "PublicDocSyntaxError";
    this.diagnostic = diagnostic;
  }
}

function destinationHref(destination: ContentDestination): string {
  if (
    destination.syntax === "javascript-string" ||
    destination.syntax === "javascript-template"
  ) {
    return destination.cookedValue;
  }
  return destination.rawValue;
}

function destinationOrder(
  destination: ContentDestination,
  text: string,
): number {
  if (
    destination.kind === "markdown-link" ||
    destination.kind === "markdown-image"
  ) return 0;
  if (
    destination.kind === "html-attribute" ||
    destination.kind === "mdx-jsx-attribute"
  ) return 1;
  if (destination.kind === "markdown-definition") return 2;
  return text[destination.range.start.offset - 1] === "<" ? 3 : 4;
}

async function analyzeDestinations(
  text: string,
  syntax: DocumentSyntax,
  hasFrontmatter: boolean,
): Promise<DestinationAnalysis> {
  const result = await analyzeContent({
    value: text,
    syntax,
    frontmatter: hasFrontmatter,
    filePath: syntax === "mdx" ? "content.mdx" : "content.md",
  });
  if (result.kind === "syntax-error") return result;
  const ordered = result.destinations.map((destination, index) => ({
    destination,
    index,
    order: destinationOrder(destination, text),
  })).sort((left, right) =>
    left.order - right.order ||
    (left.order === 0
      ? left.index - right.index
      : left.destination.range.start.offset -
        right.destination.range.start.offset)
  ).map(({ destination }) => destination);
  return {
    kind: "document",
    destinations: ordered.map((destination) => ({
      href: destinationHref(destination),
      offset: destination.range.start.offset,
      syntax: destination.syntax,
    })),
  };
}

export async function scanDestinations(
  text: string,
  syntax: DocumentSyntax = "mdx",
  hasFrontmatter = false,
): Promise<Destination[]> {
  const result = await analyzeDestinations(text, syntax, hasFrontmatter);
  if (result.kind === "syntax-error") {
    throw new PublicDocSyntaxError(syntax, result.diagnostic);
  }
  return [...result.destinations];
}

export async function destinations(
  text: string,
  syntax: DocumentSyntax = "markdown",
): Promise<string[]> {
  return (await scanDestinations(text, syntax)).map((destination) =>
    destination.href
  );
}

function syntaxIssue(
  path: string,
  content: string,
  syntax: DocumentSyntax,
  diagnostic: ContentSyntaxDiagnostic,
): PublicDocIssue {
  const label = syntax === "mdx" ? "MDX" : "Markdown";
  const line = diagnostic.range.start.line;
  const message = diagnostic.message.replace(/[.\s]+$/, "");
  return {
    path,
    line,
    message: `Fix invalid ${label} syntax: ${message}.`,
    text: content.split("\n")[line - 1]?.trim() ?? "",
  };
}

async function analyzePublicDoc(
  path: string,
  content: string,
): Promise<PublicDocAnalysis> {
  const syntax: DocumentSyntax = path.endsWith(".mdx") ? "mdx" : "markdown";
  const result = await analyzeDestinations(
    content,
    syntax,
    path !== "README.md",
  );
  return result.kind === "syntax-error"
    ? {
      kind: "syntax-error",
      issue: syntaxIssue(path, content, syntax, result.diagnostic),
    }
    : result;
}

/** 1-indexed line holding `offset`. */
function lineAt(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function lineStartOffsets(lines: readonly string[]): number[] {
  const starts: number[] = [0];
  for (const line of lines.slice(0, -1)) {
    starts.push(starts[starts.length - 1]! + line.length + 1);
  }
  return starts;
}

export async function collectUnpublishedLinkIssues(
  path: string,
  content: string,
  stat: (path: string) => { readonly isFile: boolean } = Deno.statSync,
  analyzed?: PublicDocAnalysis,
): Promise<PublicDocIssue[]> {
  if (path !== "README.md" && !isPublishedPage(path)) return [];

  const lines = content.split("\n");
  const lineStarts = lineStartOffsets(lines);
  const analysis = analyzed ?? await analyzePublicDoc(path, content);
  if (analysis.kind === "syntax-error") return [analysis.issue];

  const issues: PublicDocIssue[] = [];
  for (const { href, offset, syntax } of analysis.destinations) {
    const target = resolveDocumentationTarget(path, href, syntax);
    if (path === "README.md" && !target?.startsWith("docs/")) continue;
    if (target === undefined || publishedTargetExists(target, stat)) continue;
    const line = lineAt(lineStarts, offset);
    issues.push({
      path,
      line,
      message:
        `Do not link published docs to ${target}. veryfront-docs publishes only ${
          SYNCED_DOC_DIRS.join(", ")
        }, and drops each section README, so this link 404s on the site.`,
      text: lines[line - 1]!.trim(),
    });
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

const DEFAULT_BLOCKED_REPOSITORY = "veryfront/veryfront-examples";

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RepositoryRule extends Rule {
  matches(text: string): boolean;
}

function blockedRepositoryRule(repository: string): RepositoryRule {
  const escapedRepository = escapeRegularExpression(repository);
  const repositoryUrl = String
    .raw`(?:(?:https?:\/\/)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)${escapedRepository}(?:\.git)?`;
  const trailingBoundary = String
    .raw`(?:$|[/#?\s)>\],;:'"!]|[.](?=\s|$))`;
  const pattern = new RegExp(
    String.raw`(?:^|[\s("'=<])${repositoryUrl}(?=${trailingBoundary})`,
    "i",
  );
  const emphasizedPattern = new RegExp(
    String
      .raw`(?:^|[\s("'=<])(\*+|_+|~{1,2})${repositoryUrl}\1(?=${trailingBoundary})`,
    "i",
  );
  return {
    pattern,
    matches: (text) => pattern.test(text) || emphasizedPattern.test(text),
    message:
      `${repository} is a private repository. A reader following this link gets a 404, so link a public example or inline the code instead.`,
  };
}

function canonicalizeHttpUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"'`]+/gi, (rawUrl) => {
    const suffix = rawUrl.match(/[),.;:!?]+$/)?.[0] ?? "";
    const candidate = rawUrl.slice(0, rawUrl.length - suffix.length);
    try {
      const url = new URL(candidate);
      const pathname = decodeUrlPathForRepositoryMatch(url.pathname);
      return `${url.protocol}//${url.host}${pathname}${url.search}${url.hash}${suffix}`;
    } catch {
      return rawUrl;
    }
  });
}

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
        label: "state that an unauthenticated request is redirected to sign-in",
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

export async function collectIssues(
  path: string,
  content: string,
  blockedRepository = DEFAULT_BLOCKED_REPOSITORY,
  analyzed?: PublicDocAnalysis,
): Promise<PublicDocIssue[]> {
  const issues: PublicDocIssue[] = [];
  const repositoryRule = blockedRepositoryRule(blockedRepository);
  const lines = content.split("\n");
  const lineStarts = lineStartOffsets(lines);
  const analysis = analyzed ?? await analyzePublicDoc(path, content);
  if (analysis.kind === "syntax-error") return [analysis.issue];
  const blockedDestinationLines = new Set<number>();
  for (const destination of analysis.destinations) {
    if (
      repositoryRule.matches(destination.href) ||
      repositoryRule.matches(canonicalizeHttpUrls(destination.href))
    ) {
      blockedDestinationLines.add(lineAt(lineStarts, destination.offset));
    }
  }
  for (const [index, text] of lines.entries()) {
    const renderedText = decodeMarkdownBackslashEscapes(
      decodeMarkdownCharacterReferences(text),
    );
    for (const rule of RULES) {
      if (!rule.pattern.test(renderedText)) continue;
      issues.push({
        path,
        line: index + 1,
        message: rule.message,
        text,
      });
    }
    const canonicalText = canonicalizeHttpUrls(renderedText);
    if (
      repositoryRule.matches(renderedText) ||
      repositoryRule.matches(canonicalText) ||
      blockedDestinationLines.has(index + 1)
    ) {
      issues.push({
        path,
        line: index + 1,
        message: repositoryRule.message,
        text,
      });
    }
  }

  for (const rule of WRAPPED_RULES) {
    const hit = lines.findIndex((line, index) =>
      rule.pattern.test(
        `${line} ${lines[index + 1] ?? ""}`.replace(/\s+/g, " "),
      )
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
    const analysis = await analyzePublicDoc(file, content);
    issues.push(...await collectIssues(file, content, undefined, analysis));
    if (analysis.kind === "document") {
      issues.push(
        ...await collectUnpublishedLinkIssues(
          file,
          content,
          undefined,
          analysis,
        ),
      );
    }
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

if (import.meta.main) await main();
