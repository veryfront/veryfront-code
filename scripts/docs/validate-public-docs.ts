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

/**
 * Mintlify renders these pages as MDX, so a raw anchor is a working link on
 * the site and has to clear the same boundary. Both a quoted attribute and a
 * JSX expression wrapping a string literal name a destination the reader can
 * click; a genuinely dynamic `href={href}` has no literal to check.
 */
const HTML_HREF_SOURCE =
  /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"((?:\\[\s\S]|[^"\\])*)"\s*\}|\{\s*'((?:\\[\s\S]|[^'\\])*)'\s*\}|\{\s*`((?:\\[\s\S]|\$(?!\{)|[^`\\$])*)`\s*\})/;
const URI_AUTOLINK_SOURCE = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g;
/** Any origin works: only the resolved path is read back out. */
const RESOLUTION_ORIGIN = "https://docs.invalid";
const VERYFRONT_DOCS_ORIGIN = "https://veryfront.com";
const VERYFRONT_CODE_DOCS_PREFIX = "/docs/code/";
const MARKDOWN_URL_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  colon: ":",
  period: ".",
  sol: "/",
  bsol: "\\",
  num: "#",
  quest: "?",
  equals: "=",
  percnt: "%",
  plus: "+",
  commat: "@",
};
const JAVASCRIPT_SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

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
  const path = target.replace(/\/$/, "");
  return [
    path,
    `${path}.md`,
    `${path}.mdx`,
    `${path}/index.md`,
    `${path}/index.mdx`,
  ];
}

function publishedTargetExists(target: string): boolean {
  for (const candidate of publishedTargetCandidates(target)) {
    try {
      const entry = Deno.statSync(`${ROOT}/${candidate}`);
      if (entry.isFile || entry.isDirectory) return true;
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
      if (named !== undefined) return MARKDOWN_URL_ENTITIES[named] ?? reference;
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

function decodeJavaScriptStringLiteral(value: string): string | undefined {
  let decoded = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escaped = value[++index];
    if (escaped === undefined) return undefined;
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (value[index + 1] === "\n") index++;
      continue;
    }
    if (escaped === "x") {
      const hexadecimal = value.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hexadecimal)) return undefined;
      decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 2;
      continue;
    }
    if (escaped === "u") {
      if (value[index + 1] === "{") {
        const end = value.indexOf("}", index + 2);
        const hexadecimal = end === -1 ? "" : value.slice(index + 2, end);
        if (!/^[0-9a-fA-F]{1,6}$/.test(hexadecimal)) return undefined;
        const codePoint = Number.parseInt(hexadecimal, 16);
        if (codePoint > 0x10ffff) return undefined;
        decoded += String.fromCodePoint(codePoint);
        index = end;
        continue;
      }
      const hexadecimal = value.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) return undefined;
      decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      index += 4;
      continue;
    }
    if (escaped === "0") {
      if (/^[0-9]$/.test(value[index + 1] ?? "")) return undefined;
      decoded += "\0";
      continue;
    }
    if (/^[1-9]$/.test(escaped)) return undefined;
    decoded += JAVASCRIPT_SIMPLE_ESCAPES[escaped] ?? escaped;
  }
  return decoded;
}

function normalizeRepositoryPath(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname
      .replace(/%2e/gi, ".")
      .replace(/%2f/gi, "/")
      .replace(/%5c/gi, "\\");
  }
  const segments: string[] = [];
  for (const segment of decoded.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
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
  fromDir: string,
  rawHref: string,
): string | undefined {
  const href = decodeMarkdownCharacterReferences(rawHref);
  if (/^(?:#|["'])/.test(href)) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(href, `${RESOLUTION_ORIGIN}/${fromDir}/`);
  } catch {
    return undefined;
  }
  let pathname: string;
  if (resolved.origin === VERYFRONT_DOCS_ORIGIN) {
    if (!resolved.pathname.startsWith(VERYFRONT_CODE_DOCS_PREFIX)) {
      return undefined;
    }
    pathname = `/docs/${
      resolved.pathname.slice(VERYFRONT_CODE_DOCS_PREFIX.length)
    }`;
  } else if (
    resolved.origin === RESOLUTION_ORIGIN &&
    href.startsWith(VERYFRONT_CODE_DOCS_PREFIX)
  ) {
    pathname = `/docs/${
      resolved.pathname.slice(VERYFRONT_CODE_DOCS_PREFIX.length)
    }`;
  } else {
    if (resolved.origin !== RESOLUTION_ORIGIN || /^[\/\\]/.test(href)) {
      return undefined;
    }
    pathname = resolved.pathname;
  }
  return normalizeRepositoryPath(pathname);
}

function afterMarkdownLabel(text: string, start: number): number | undefined {
  if (text[start] !== "[") return undefined;

  let cursor = start + 1;
  let depth = 1;
  while (cursor < text.length && depth > 0) {
    if (text[cursor] === "\\" && cursor + 1 < text.length) {
      cursor += 2;
      continue;
    }
    if (text[cursor] === "[") depth++;
    if (text[cursor] === "]") depth--;
    cursor++;
  }
  return depth === 0 ? cursor : undefined;
}

function blockContentStart(text: string, lineStart: number): number {
  let cursor = lineStart;
  while (true) {
    let indentation = 0;
    while (
      indentation < 3 &&
      (text[cursor] === " " || text[cursor] === "\t")
    ) {
      cursor++;
      indentation++;
    }
    if (text[cursor] === ">") {
      cursor++;
      if (text[cursor] === " " || text[cursor] === "\t") cursor++;
      continue;
    }
    if (
      (text[cursor] === "-" || text[cursor] === "+" || text[cursor] === "*") &&
      (text[cursor + 1] === " " || text[cursor + 1] === "\t")
    ) {
      cursor += 2;
      continue;
    }
    const ordered = text.slice(cursor).match(/^\d{1,9}[.)][ \t]/);
    if (ordered) {
      cursor += ordered[0].length;
      continue;
    }
    return cursor;
  }
}

interface Range {
  start: number;
  end: number;
}

function markdownCodeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence:
    | { marker: "`" | "~"; length: number; start: number }
    | undefined;

  for (const line of lines) {
    const lineEnd = offset + line.length;
    const fenceMatch = line.match(/^( {0,3})(`{3,}|~{3,})/);
    if (fence) {
      const closing = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
      if (
        closing && closing[2]![0] === fence.marker &&
        closing[2]!.length >= fence.length
      ) {
        ranges.push({ start: fence.start, end: lineEnd });
        fence = undefined;
      }
    } else if (fenceMatch) {
      const marker = fenceMatch[2]![0];
      if (marker !== "`" && marker !== "~") {
        offset = lineEnd + 1;
        continue;
      }
      fence = {
        marker,
        length: fenceMatch[2]!.length,
        start: offset,
      };
    } else if (/^(?: {4}|\t)/.test(line)) {
      ranges.push({ start: offset, end: lineEnd });
    } else {
      for (let cursor = offset; cursor < lineEnd;) {
        if (text[cursor] !== "`") {
          cursor++;
          continue;
        }
        let length = 1;
        while (text[cursor + length] === "`") length++;
        const closing = text.indexOf("`".repeat(length), cursor + length);
        if (closing === -1 || closing > lineEnd) {
          cursor += length;
          continue;
        }
        ranges.push({ start: cursor, end: closing + length });
        cursor = closing + length;
      }
    }
    offset = lineEnd + 1;
  }
  if (fence) ranges.push({ start: fence.start, end: text.length });
  return ranges;
}

function isInsideRange(ranges: readonly Range[], offset: number): boolean {
  return ranges.some((range) => range.start <= offset && offset < range.end);
}

/**
 * A reference definition starting at `lineStart`. CommonMark lets the
 * destination sit on the line after the label, so the run of whitespace after
 * the colon may cross one newline but not a blank line, which ends the
 * definition.
 */
function referenceDestinationAt(
  text: string,
  lineStart: number,
): Destination | undefined {
  const labelStart = blockContentStart(text, lineStart);
  const afterLabel = afterMarkdownLabel(text, labelStart);
  if (afterLabel === undefined || text[afterLabel] !== ":") return undefined;

  let cursor = afterLabel + 1;
  let newlines = 0;
  while (/\s/.test(text[cursor] ?? "")) {
    if (text[cursor] !== "\n") {
      cursor++;
      continue;
    }
    if (++newlines > 1) return undefined;
    cursor = blockContentStart(text, cursor + 1);
  }
  const wrapped = text[cursor] === "<";
  if (wrapped) cursor++;
  const destinationStart = cursor;
  while (
    cursor < text.length &&
    (wrapped ? text[cursor] !== ">" : !/\s/.test(text[cursor]!))
  ) {
    cursor++;
  }
  return cursor > destinationStart
    ? { href: text.slice(destinationStart, cursor), offset: destinationStart }
    : undefined;
}

/** A link destination and where it starts, so an issue can name its line. */
export interface Destination {
  href: string;
  offset: number;
}

/**
 * Every destination in `text`, with its offset.
 *
 * Scanned over the whole document rather than line by line: Markdown lets link
 * text wrap across lines, and lets a reference definition put its destination
 * on the following line. Neither line holds enough syntax on its own, while
 * Mintlify still renders both as links.
 */
export function scanDestinations(text: string): Destination[] {
  // A scanner is required here because valid Markdown labels can contain
  // balanced brackets or escaped closing brackets.
  const found: Destination[] = [];
  const codeRanges = markdownCodeRanges(text);
  const markdownAngleDestinationRanges: Range[] = [];
  for (let start = 0; start < text.length; start++) {
    if (isInsideRange(codeRanges, start)) continue;
    const afterLabel = afterMarkdownLabel(text, start);
    if (afterLabel === undefined || text[afterLabel] !== "(") continue;

    let cursor = afterLabel + 1;
    while (/\s/.test(text[cursor] ?? "")) cursor++;
    if (cursor >= text.length) continue;

    if (text[cursor] === "<") {
      const rangeStart = cursor;
      const destinationStart = ++cursor;
      while (cursor < text.length) {
        if (text[cursor] === "\\" && cursor + 1 < text.length) {
          cursor += 2;
          continue;
        }
        if (text[cursor] === ">") break;
        cursor++;
      }
      if (text[cursor] === ">" && cursor > destinationStart) {
        markdownAngleDestinationRanges.push({
          start: rangeStart,
          end: cursor + 1,
        });
        found.push({
          href: text.slice(destinationStart, cursor),
          offset: destinationStart,
        });
      }
      start = cursor;
      continue;
    }

    const destinationStart = cursor;
    let destinationDepth = 0;
    while (cursor < text.length) {
      if (text[cursor] === "\\" && cursor + 1 < text.length) {
        cursor += 2;
        continue;
      }
      if (text[cursor] === "(") {
        destinationDepth++;
      } else if (text[cursor] === ")") {
        if (destinationDepth === 0) break;
        destinationDepth--;
      } else if (/\s/.test(text[cursor]!) && destinationDepth === 0) {
        break;
      }
      cursor++;
    }
    if (cursor > destinationStart) {
      found.push({
        href: text.slice(destinationStart, cursor),
        offset: destinationStart,
      });
    }
    start = cursor;
  }

  const htmlHref = new RegExp(HTML_HREF_SOURCE, "gi");
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlHref.exec(text))) {
    if (isInsideRange(codeRanges, htmlMatch.index)) continue;
    const rawHref = htmlMatch[1] ?? htmlMatch[2] ?? htmlMatch[3] ??
      htmlMatch[4] ?? htmlMatch[5];
    if (rawHref === undefined) continue;
    const href = htmlMatch[3] !== undefined || htmlMatch[4] !== undefined ||
        htmlMatch[5] !== undefined
      ? decodeJavaScriptStringLiteral(rawHref)
      : rawHref;
    if (href === undefined) continue;
    found.push({
      href,
      offset: htmlMatch.index + htmlMatch[0].lastIndexOf(rawHref),
    });
  }

  let autolinkMatch: RegExpExecArray | null;
  while ((autolinkMatch = URI_AUTOLINK_SOURCE.exec(text))) {
    if (isInsideRange(codeRanges, autolinkMatch.index)) continue;
    if (
      isInsideRange(markdownAngleDestinationRanges, autolinkMatch.index)
    ) continue;
    found.push({
      href: autolinkMatch[1]!,
      offset: autolinkMatch.index + 1,
    });
  }

  // A reference definition is only a definition at the start of a line.
  for (let lineStart = 0; lineStart <= text.length;) {
    if (isInsideRange(codeRanges, lineStart)) {
      const next = text.indexOf("\n", lineStart);
      if (next === -1) break;
      lineStart = next + 1;
      continue;
    }
    const reference = referenceDestinationAt(text, lineStart);
    if (reference) found.push(reference);
    const next = text.indexOf("\n", lineStart);
    if (next === -1) break;
    lineStart = next + 1;
  }

  return found;
}

export function destinations(text: string): string[] {
  return scanDestinations(text).map((destination) => destination.href);
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

export function collectUnpublishedLinkIssues(
  path: string,
  content: string,
): PublicDocIssue[] {
  if (!isPublishedPage(path)) return [];

  const fromDir = path.slice(0, path.lastIndexOf("/"));
  const lines = content.split("\n");
  const lineStarts: number[] = [0];
  for (const line of lines.slice(0, -1)) {
    lineStarts.push(lineStarts[lineStarts.length - 1]! + line.length + 1);
  }

  const issues: PublicDocIssue[] = [];
  for (const { href, offset } of scanDestinations(content)) {
    const target = resolveDocumentationTarget(fromDir, href);
    if (target === undefined || publishedTargetExists(target)) continue;
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
    // Host names are case-insensitive, so a GitHub.com spelling reaches the
    // same private repository.
    pattern: /github\.com\/veryfront\/veryfront-examples/i,
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

export function collectIssues(path: string, content: string): PublicDocIssue[] {
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

if (import.meta.main) await main();
