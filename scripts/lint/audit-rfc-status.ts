#!/usr/bin/env -S deno run --allow-read
/**
 * RFC status doc-truth lint.
 *
 * Sibling of `audit-chat-composability.ts`. That lint keeps Storybook
 * composition trees honest against the real `Object.assign` parts; this one
 * keeps the RFC reference pages honest against the real public surface.
 *
 * The systemic failure it exists to stop: RFC 29's 59 sub-pages each carried an
 * identical page-level banner - "this page documents the _proposed_ API shape,
 * not yet implemented". An RFC that lands piecemeal silently falsifies that
 * banner: PR #3277 shipped the prop-getter surface and made `mergeProps`
 * public, and no banner moved. A blanket claim about a whole page is not
 * checkable, so it rots invisibly.
 *
 * The fix is a status ledger a machine can read. Every RFC reference page
 * carries a status block naming, symbol by symbol, what the runtime exports
 * today and what it does not:
 *
 *   > **Status: RFC 29 - partly landed.** Verified by `deno task lint:rfc-status`.
 *   >
 *   > - **Exported from `veryfront/chat` today:** `ChatInput`, `ChatInput.Field`
 *   > - **Not exported today:** `formatSize`
 *
 * and any individual delta that has since landed is badged `shipped` with the
 * source it landed in:
 *
 *   ### `ChatInput.Field` - `changed` - `shipped` (src/…/use-chat-input.ts:184)
 *
 * Rules, all mechanical:
 *
 *   1. No blanket claims. The un-checkable page-wide phrasings are banned.
 *   2. Exactly one status block per page, in the documented grammar.
 *   3. Every symbol claimed exported must really be on the public surface.
 *   4. Every symbol claimed **absent must really be absent** - this is the rule
 *      the drift needed. A page may not say "not yet implemented" about
 *      something that ships.
 *   5. A `shipped` badge must cite a source anchor (`path:line`) that resolves.
 *   6. The banner's landed-ness word must agree with the page's `shipped`
 *      badges, so the page-level summary can never drift from its deltas again.
 */

import { walk } from "#std/fs";
import { collectCompoundParts } from "./audit-chat-composability.ts";

const RFC_DIR = "docs/rfcs/29-chat-api-shape";
/** The RFC's own body makes the same kind of claim, so it is audited too. */
const RFC_ROOT = "docs/rfcs/29-chat-api-shape.md";
const CHAT_BARREL = "src/chat/index.ts";
const CHAT_SRC_DIRS = [
  "src/react/components/chat",
  "src/react/components/ui",
];

/**
 * Page-wide claims no machine can check. Their whole point was to rot.
 *
 * The third pattern is the wording that slipped past the first two: the RFC's
 * own body said "Nothing else in this document has been implemented" - the same
 * un-checkable document-wide negative, phrased around "nothing else" instead of
 * "not yet". Matching the shape rather than a fixed string is what stops the
 * next paraphrase getting through.
 */
const BLANKET_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  { label: "not yet implemented", pattern: /not yet implemented/i },
  { label: "none of it is implemented yet", pattern: /none of it is implemented yet/i },
  {
    label: "nothing else … implemented / shipped / landed",
    pattern: /nothing else\b[^.]*\b(?:implemented|shipped|landed)\b/i,
  },
];

const EXPORTED_LABEL = "**Exported from `veryfront/chat` today:**";
const ABSENT_LABEL = "**Not exported today:**";
/**
 * Optional third list, for pages whose deltas are props/members rather than
 * exports (`submitMode` on `ChatInput`, `getDropTargetProps` on `useChatInput`).
 * Every token must be absent from the chat source as an identifier.
 */
const UNBUILT_LABEL = "**Not in `src/` today:**";
const LANDED_BANNER = "**Status: RFC 29 - partly landed.**";
const UNLANDED_BANNER = "**Status: RFC 29 - proposed; nothing on this page has landed.**";

export interface StatusViolation {
  path: string;
  line: number;
  message: string;
}

export interface PublicSurface {
  /** Top-level names exported from the `veryfront/chat` barrel. */
  exports: Set<string>;
  /** `Compound -> sub-part names`, from `Object.assign` in the chat source. */
  compounds: Map<string, Set<string>>;
  /**
   * Flat component names declared in the chat/ui source
   * (`ChatSidebarItemMenu`, `AppShellSidebar`, …). Compounds are spelled several
   * ways in the tree — `Object.assign`, a plain object literal, a multi-line
   * type annotation — so the flat declaration is the reliable second opinion on
   * "does this sub-part exist".
   */
  declarations: Set<string>;
  /**
   * Every identifier that appears in the chat/ui source. Props and hook members
   * (`submitMode`, `getDropTargetProps`) are not exports, so absence claims
   * about them are settled here instead.
   */
  identifiers: Set<string>;
}

/** Every identifier token in the source — the domain for prop-level claims. */
export function collectIdentifiers(sources: Array<{ content: string }>): Set<string> {
  const names = new Set<string>();
  for (const f of sources) {
    for (const m of f.content.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]);
  }
  return names;
}

/**
 * Compounds spelled as a plain exported object literal
 * (`export const ChatEmptyState = { Root, Avatar, … }`) rather than
 * `Object.assign`. Only Capitalized keys count, so this cannot mistake an
 * ordinary config object for an anatomy.
 */
export function collectObjectLiteralCompounds(
  sources: Array<{ content: string }>,
): Map<string, Set<string>> {
  const compounds = new Map<string, Set<string>>();
  const re = /export\s+const\s+([A-Z]\w*)\s*=\s*\{([^{}]*)\}/g;
  for (const f of sources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) {
      const keys = new Set<string>();
      for (const raw of m[2].split(",")) {
        const key = /^\s*([A-Z]\w*)\s*(?::|$)/.exec(raw)?.[1];
        if (key) keys.add(key);
      }
      if (keys.size > 0) compounds.set(m[1], keys);
    }
  }
  return compounds;
}

/** `export function Foo` / `const Foo = …` / `class Foo` declarations. */
export function collectDeclarations(sources: Array<{ content: string }>): Set<string> {
  const names = new Set<string>();
  const re = /(?:^|\n)\s*(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_]\w*)/g;
  for (const f of sources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) names.add(m[1]);
  }
  return names;
}

/**
 * Names exported from a barrel: both `export { A, type B }` lists and
 * `export function C` / `export const D` declarations. Types are included -
 * `ChatInputFieldProps` is as much of the public surface as `ChatInputField`.
 */
export function collectBarrelExports(source: string): Set<string> {
  const names = new Set<string>();

  const blockRe = /export\s*\{([\s\S]*?)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(source)) !== null) {
    for (const raw of block[1].split(",")) {
      const spec = raw.trim();
      if (!spec) continue;
      // `type Foo`, `Foo as Bar` -> the name a consumer imports.
      const m = /^(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?$/.exec(spec);
      if (m) names.add(m[2] ?? m[1]);
    }
  }

  const declRe = /export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/g;
  let decl: RegExpExecArray | null;
  while ((decl = declRe.exec(source)) !== null) names.add(decl[1]);

  return names;
}

/**
 * Resolve a documented symbol against the public surface.
 *
 * `ChatInput` resolves as a barrel export; `ChatInput.Field` resolves by
 * walking the compound's `Object.assign` parts (nested: `ChatSidebar.Item.Menu`
 * needs `Item` on `ChatSidebar` and `Menu` on the `Item` compound). A dotted
 * token whose base is not a known compound is unresolvable - which is the
 * honest answer, not a pass.
 */
export function resolvesOnSurface(symbol: string, surface: PublicSurface): boolean {
  const [base, ...rest] = symbol.split(".");
  if (!surface.exports.has(base)) return false;
  if (rest.length === 0) return true;

  // Sub-parts are named by concatenation in the source (`ChatSidebar.Item.Menu`
  // is `ChatSidebarItemMenu`), and a compound may be registered under either the
  // flat name or a `…Compound` alias.
  let flat = base;
  for (const part of rest) {
    const viaCompound = ["", "Compound"].some((suffix) =>
      surface.compounds.get(`${flat}${suffix}`)?.has(part)
    );
    flat = `${flat}${part}`;
    if (!viaCompound && !surface.declarations.has(flat)) return false;
  }
  return true;
}

interface Ledger {
  bannerLine: number;
  /**
   * Every line carrying a status banner. Rule 2 is "exactly one status block
   * per page": with two, the parse keeps only the last, so a second banner
   * saying the opposite would resolve silently and rule 6 would then check the
   * wrong claim.
   */
  bannerLines: number[];
  landed: boolean;
  exported: string[];
  absent: string[];
  unbuilt: string[];
}

/** Inline-code tokens (`` `Foo.Bar` ``) in a ledger line, in order. */
function ledgerSymbols(line: string): string[] {
  if (/\bnone\.?\s*$/i.test(line.replace(/^[^:]*:/, ""))) return [];
  return [...line.matchAll(/`([A-Za-z][\w.]*)`/g)].map((m) => m[1]);
}

export function parseLedger(content: string): Ledger | null {
  const lines = content.split("\n");
  const bannerLines: number[] = [];
  let bannerLine = -1;
  let landed = false;
  let exported: string[] | null = null;
  let absent: string[] | null = null;
  let unbuilt: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(LANDED_BANNER)) {
      bannerLines.push(i + 1);
      bannerLine = i + 1;
      landed = true;
    } else if (line.includes(UNLANDED_BANNER)) {
      bannerLines.push(i + 1);
      bannerLine = i + 1;
      landed = false;
    } else if (line.includes(EXPORTED_LABEL)) {
      exported = ledgerSymbols(line);
    } else if (line.includes(UNBUILT_LABEL)) {
      unbuilt = ledgerSymbols(line);
    } else if (line.includes(ABSENT_LABEL)) {
      absent = ledgerSymbols(line);
    }
  }

  if (bannerLine === -1 || exported === null || absent === null) return null;
  return { bannerLine, bannerLines, landed, exported, absent, unbuilt };
}

export interface ShippedBadge {
  line: number;
  heading: string;
  anchorPath: string;
  anchorLine: number;
}

/**
 * `### \`X\` - \`changed\` - \`shipped\` (src/a/b.ts:12)`
 *
 * `partly shipped` is the same claim for a delta that landed in part - the RFC
 * lands piecemeal, and pretending a half-landed delta is either done or
 * untouched is how the old banner went wrong in the first place.
 */
const SHIPPED_RE =
  /^#{2,4}\s+(.*?)\s+-\s+`(?:partly )?shipped`\s+\((src\/[\w./-]+):(\d+)\)\s*$/;
/** A `shipped` badge that failed to carry a resolvable anchor. */
const SHIPPED_LOOSE_RE = /`(?:partly )?shipped`/;

export function parseShippedBadges(content: string): {
  badges: ShippedBadge[];
  malformed: number[];
} {
  const badges: ShippedBadge[] = [];
  const malformed: number[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#") || !SHIPPED_LOOSE_RE.test(line)) continue;
    const m = SHIPPED_RE.exec(line);
    if (!m) {
      malformed.push(i + 1);
      continue;
    }
    badges.push({
      line: i + 1,
      heading: m[1],
      anchorPath: m[2],
      anchorLine: Number(m[3]),
    });
  }
  return { badges, malformed };
}

export interface AuditInput {
  path: string;
  content: string;
}

export function auditPage(
  page: AuditInput,
  surface: PublicSurface,
  lineCountOf: (path: string) => number | null,
): StatusViolation[] {
  const out: StatusViolation[] = [];
  const lines = page.content.split("\n");

  // Rule 1 - blanket claims are banned outright.
  for (let i = 0; i < lines.length; i++) {
    for (const claim of BLANKET_CLAIMS) {
      if (claim.pattern.test(lines[i])) {
        out.push({
          path: page.path,
          line: i + 1,
          message:
            `blanket status claim "${claim.label}" - no machine can check it, so it rots. ` +
            `State per-symbol status in the page's status ledger instead.`,
        });
      }
    }
  }

  // Rule 2 - exactly one status ledger, in the documented grammar.
  const ledger = parseLedger(page.content);
  if (!ledger) {
    out.push({
      path: page.path,
      line: 1,
      message:
        `missing status ledger. Every RFC reference page needs a status block with ` +
        `"${EXPORTED_LABEL}" and "${ABSENT_LABEL}" lines.`,
    });
    return out;
  }
  for (const extra of ledger.bannerLines.slice(1)) {
    out.push({
      path: page.path,
      line: extra,
      message:
        "a second status block on this page. Exactly one per page: two banners " +
        "can disagree, and only the last one is read - which is how a page-level " +
        "summary drifts from its own deltas.",
    });
  }

  // Rules 3 + 4 - the ledger's two lists must both be true.
  for (const symbol of ledger.exported) {
    if (!resolvesOnSurface(symbol, surface)) {
      out.push({
        path: page.path,
        line: ledger.bannerLine,
        message:
          `"${symbol}" is listed as exported but is not on the \`veryfront/chat\` ` +
          `public surface. Move it to "${ABSENT_LABEL}".`,
      });
    }
  }
  for (const symbol of ledger.absent) {
    if (resolvesOnSurface(symbol, surface)) {
      out.push({
        path: page.path,
        line: ledger.bannerLine,
        message:
          `"${symbol}" is documented as not yet implemented, but it ships from ` +
          `\`veryfront/chat\` today. Move it to "${EXPORTED_LABEL}".`,
      });
    }
  }

  for (const symbol of ledger.unbuilt) {
    if (surface.identifiers.has(symbol)) {
      out.push({
        path: page.path,
        line: ledger.bannerLine,
        message:
          `"${symbol}" is documented as not built yet, but the chat source ` +
          `already uses that name. Say what actually changed instead.`,
      });
    }
  }

  // Rule 5 - `shipped` badges must cite a source anchor that resolves.
  const { badges, malformed } = parseShippedBadges(page.content);
  for (const line of malformed) {
    out.push({
      path: page.path,
      line,
      message:
        "a `shipped` badge must cite the source it landed in, as " +
        "``- `shipped` (src/path/to/file.ts:42)``.",
    });
  }
  for (const badge of badges) {
    const count = lineCountOf(badge.anchorPath);
    if (count === null) {
      out.push({
        path: page.path,
        line: badge.line,
        message: `\`shipped\` evidence "${badge.anchorPath}" does not exist.`,
      });
    } else if (badge.anchorLine < 1 || badge.anchorLine > count) {
      out.push({
        path: page.path,
        line: badge.line,
        message:
          `\`shipped\` evidence "${badge.anchorPath}:${badge.anchorLine}" is past ` +
          `the end of the file (${count} lines).`,
      });
    }
  }

  // Rule 6 - the banner's landed-ness word must agree with the badges.
  if (ledger.landed && badges.length === 0) {
    out.push({
      path: page.path,
      line: ledger.bannerLine,
      message:
        'banner says "partly landed" but no delta on this page is badged `shipped`.',
    });
  }
  if (!ledger.landed && badges.length > 0) {
    out.push({
      path: page.path,
      line: ledger.bannerLine,
      message:
        `banner says nothing has landed but ${badges.length} delta(s) are badged ` +
        "`shipped`. Switch the banner to \"partly landed\".",
    });
  }

  return out;
}

async function readMarkdown(dir: string): Promise<AuditInput[]> {
  const files: AuditInput[] = [];
  for await (const entry of walk(dir, { exts: [".md"] })) {
    if (!entry.isFile) continue;
    files.push({ path: entry.path, content: await Deno.readTextFile(entry.path) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function loadSurface(): Promise<PublicSurface> {
  const exports = collectBarrelExports(await Deno.readTextFile(CHAT_BARREL));
  const sources: Array<{ path: string; content: string }> = [];
  for (const dir of CHAT_SRC_DIRS) {
    for await (const entry of walk(dir, { exts: [".ts", ".tsx"] })) {
      if (!entry.isFile) continue;
      if (/\.(test|stories)\.tsx?$/.test(entry.path)) continue;
      sources.push({ path: entry.path, content: await Deno.readTextFile(entry.path) });
    }
  }
  const compounds = collectCompoundParts(sources);
  for (const [name, parts] of collectObjectLiteralCompounds(sources)) {
    const merged = compounds.get(name) ?? new Set<string>();
    for (const part of parts) merged.add(part);
    compounds.set(name, merged);
  }
  return {
    exports,
    compounds,
    declarations: collectDeclarations(sources),
    identifiers: collectIdentifiers(sources),
  };
}

if (import.meta.main) {
  const surface = await loadSurface();
  const pages = [
    { path: RFC_ROOT, content: await Deno.readTextFile(RFC_ROOT) },
    ...await readMarkdown(RFC_DIR),
  ];
  const lineCache = new Map<string, number | null>();
  const lineCountOf = (path: string): number | null => {
    if (!lineCache.has(path)) {
      try {
        lineCache.set(path, Deno.readTextFileSync(path).split("\n").length);
      } catch {
        lineCache.set(path, null);
      }
    }
    return lineCache.get(path) ?? null;
  };

  const violations = pages.flatMap((page) => auditPage(page, surface, lineCountOf));

  if (violations.length === 0) {
    console.log(
      `rfc status: ${pages.length} pages; every status ledger matches the real ` +
        `\`veryfront/chat\` surface (${surface.exports.size} exports).`,
    );
    Deno.exit(0);
  }

  console.error(`${violations.length} RFC status violation(s):`);
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line}: ${v.message}`);
  }
  Deno.exit(1);
}
