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
 *   7. The reference index's roll-up table is the complete set of landed
 *      deltas, and must agree exactly with the badges - one row per badge,
 *      paired by the delta's own heading anchor, not merely by page.
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
 *
 * The fourth is that same negative inverted into the positive voice, which is
 * how it survived the first three: "Every other delta is still a proposal",
 * "Everything else in this corpus is still a proposal". Naming what *has*
 * landed and then sweeping the rest into one word is the identical
 * un-checkable claim - it just reads like a summary rather than a status. The
 * quantifier must be a residual one (`every other`, `everything else`), so the
 * pattern cannot reach the per-page banners, which say "proposed" of a single
 * named page and never "everything else … proposal".
 */
const BLANKET_CLAIMS: Array<{ label: string; pattern: RegExp }> = [
  { label: "not yet implemented", pattern: /not yet implemented/i },
  { label: "none of it is implemented yet", pattern: /none of it is implemented yet/i },
  {
    label: "nothing else … implemented / shipped / landed",
    pattern: /nothing else\b[^.]*\b(?:implemented|shipped|landed)\b/i,
  },
  {
    label: "everything else / every other … is still a proposal",
    pattern: /\b(?:everything|anything|every|all)\s+(?:else|other)\b[^.]*\bproposals?\b/i,
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
  /**
   * The same accounting for each symbol list, and for the same reason one level
   * down. Rejecting only duplicate banners left this hole open: each list is
   * overwritten by the last line that matches its label, so a page could put a
   * false `Not exported today:` line first and a clean one below it and audit
   * clean - exactly the drift the ledger exists to catch, hidden inside a
   * single well-formed status block.
   */
  exportedLines: number[];
  absentLines: number[];
  unbuiltLines: number[];
}

/** Inline-code tokens (`` `Foo.Bar` ``) in a ledger line, in order. */
function ledgerSymbols(line: string): string[] {
  if (/\bnone\.?\s*$/i.test(line.replace(/^[^:]*:/, ""))) return [];
  return [...line.matchAll(/`([A-Za-z][\w.]*)`/g)].map((m) => m[1]);
}

export function parseLedger(content: string): Ledger | null {
  const lines = content.split("\n");
  const bannerLines: number[] = [];
  const exportedLines: number[] = [];
  const absentLines: number[] = [];
  const unbuiltLines: number[] = [];
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
      exportedLines.push(i + 1);
      exported = ledgerSymbols(line);
    } else if (line.includes(UNBUILT_LABEL)) {
      unbuiltLines.push(i + 1);
      unbuilt = ledgerSymbols(line);
    } else if (line.includes(ABSENT_LABEL)) {
      absentLines.push(i + 1);
      absent = ledgerSymbols(line);
    }
  }

  if (bannerLine === -1 || exported === null || absent === null) return null;
  return {
    bannerLine,
    bannerLines,
    landed,
    exported,
    absent,
    unbuilt,
    exportedLines,
    absentLines,
    unbuiltLines,
  };
}

export interface ShippedBadge {
  line: number;
  heading: string;
  anchorPath: string;
  anchorLine: number;
  /**
   * The heading's own GitHub anchor. This is the delta's identity: the roll-up
   * names a delta by linking this slug, so the table can be checked one delta
   * at a time instead of one page at a time.
   */
  slug: string;
}

/**
 * GitHub's heading-anchor slug: lowercase, drop everything that is not a word
 * character, space, or hyphen, then spaces to hyphens. Backticks, parentheses,
 * and the `path.ts:12` punctuation in a badge all fall away, which is why
 * `` ### `mergeProps` - `new` - `shipped` (src/a.ts:85) `` anchors as
 * `mergeprops---new---shipped-srcats85`.
 */
export function headingSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");
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
      slug: headingSlug(line.replace(/^#+\s+/, "")),
    });
  }
  return { badges, malformed };
}

export interface AuditInput {
  path: string;
  content: string;
}

/** The reference index, whose table rolls up every delta that has landed. */
const ROLLUP_PAGE = `${RFC_DIR}/README.md`;

/**
 * A roll-up row: `| [text](./page.md#anchor) | ` + "`shipped`" + ` | … |`.
 *
 * Requiring the status-badge cell is what scopes this to the roll-up table
 * instead of any other table that might join the page later.
 *
 * The target is deliberately not pinned to a `./` prefix. A row written
 * `[…](helpers.md)` or `[…](../29-chat-api-shape.md)` links the same document,
 * and dropping it from the parse would have silently excused the row rather
 * than checked it - a completeness rule that stops looking at a row because of
 * how its link is spelled is no completeness rule at all.
 */
const ROLLUP_ROW_RE =
  /^\|[^|]*\]\(([\w./-]+?\.md)(?:#([\w-]*))?\)[^|]*\|[^|]*`(?:partly )?shipped`/;

export interface RollupRow {
  line: number;
  page: string;
  /** The `#…` fragment, naming which delta on that page this row claims. */
  anchor: string;
}

/** Resolve a row's link target against the index's own directory. */
function resolveRowTarget(target: string): string {
  const out: string[] = [];
  for (const segment of `${RFC_DIR}/${target}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

export function parseRollupRows(content: string): RollupRow[] {
  const rows: RollupRow[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = ROLLUP_ROW_RE.exec(lines[i]);
    if (m) rows.push({ line: i + 1, page: resolveRowTarget(m[1]), anchor: m[2] ?? "" });
  }
  return rows;
}

/**
 * Rule 7 - the roll-up is the complete set of landed *deltas*, checked one
 * delta at a time.
 *
 * The index table says "the complete set, as of `main`". That is the same
 * corpus-wide claim the blanket banners made, so it gets the same treatment:
 * the set is machine-readable (one row per landed delta, each linking its
 * delta's own heading), and it must agree exactly with the `shipped` badges
 * that exist. Without this, deleting the blanket sentence would only hide the
 * claim - the table would still assert completeness, unchecked.
 *
 * The pairing is per delta, not per page, because per page is the same
 * overwrite hole rules 2 and 6 already closed one level up. Reducing both sides
 * to a set of page paths accepted any row for a page that badged *something*:
 * `components/chat-input.md` carried one badge and the index carried two rows
 * naming two different deltas on it, and the lint passed - the second delta
 * ("`ChatInput` flat sub-part exports") had no badge anywhere, and the table's
 * completeness claim was decorative. Matching the row's `#anchor` against each
 * badge's own heading slug is what makes the claim bite.
 */
export function auditRollup(rollup: AuditInput, deltaPages: AuditInput[]): StatusViolation[] {
  const out: StatusViolation[] = [];
  const rows = parseRollupRows(rollup.content);
  const anchorLine = rows[0]?.line ?? 1;

  // page -> delta slug -> the badge's line, for every delta that really landed.
  const badgesByPage = new Map<string, Map<string, number>>();
  for (const page of deltaPages) {
    const { badges } = parseShippedBadges(page.content);
    if (badges.length === 0) continue;
    badgesByPage.set(page.path, new Map(badges.map((b) => [b.slug, b.line])));
  }

  /** `page#slug` -> the row that claimed it, so no delta is claimed twice. */
  const claimed = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.page}#${row.anchor}`;
    if (claimed.has(key)) {
      out.push({
        path: rollup.path,
        line: row.line,
        message:
          `a second row for "${key}" in this table. One row per landed delta: ` +
          `two rows can disagree, and a duplicate silently pads a set that ` +
          `claims to be exact.`,
      });
      continue;
    }
    claimed.set(key, row.line);

    const badges = badgesByPage.get(row.page);
    if (!badges) {
      out.push({
        path: rollup.path,
        line: row.line,
        message:
          `this row says a delta on "${row.page}" has landed, but that page badges ` +
          `nothing \`shipped\`. Badge the delta on its own page or drop this row.`,
      });
      continue;
    }
    if (row.anchor === "") {
      out.push({
        path: rollup.path,
        line: row.line,
        message:
          `this row links "${row.page}" without naming a delta. Link the delta's ` +
          `own heading anchor, so the row is checked against that badge rather ` +
          `than against the page having any badge at all.`,
      });
      continue;
    }
    if (!badges.has(row.anchor)) {
      out.push({
        path: rollup.path,
        line: row.line,
        message:
          `this row names no \`shipped\` delta: "${row.page}" has no heading ` +
          `anchoring to "#${row.anchor}". Badge that delta on its page, or fix ` +
          `the anchor to the delta this row really means.`,
      });
    }
  }

  for (const [page, badges] of [...badgesByPage].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [slug, line] of badges) {
      if (claimed.has(`${page}#${slug}`)) continue;
      out.push({
        path: rollup.path,
        line: anchorLine,
        message:
          `"${page}:${line}" badges the delta "#${slug}" \`shipped\` but it has no ` +
          `row in this table, which claims to be the complete set. Add the delta ` +
          `or drop its badge.`,
      });
    }
  }
  return out;
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
  // One banner is not enough: each symbol list must be single too. Only the
  // last line matching a label is read, so a repeated list lets a false claim
  // sit above a clean one and audit clean.
  const symbolLists: Array<{ label: string; lines: number[] }> = [
    { label: EXPORTED_LABEL, lines: ledger.exportedLines },
    { label: ABSENT_LABEL, lines: ledger.absentLines },
    { label: UNBUILT_LABEL, lines: ledger.unbuiltLines },
  ];
  for (const list of symbolLists) {
    for (const extra of list.lines.slice(1)) {
      out.push({
        path: page.path,
        line: extra,
        message:
          `a second "${list.label}" line in this status block. Exactly one of ` +
          `each: only the last is read, so a false line above a clean one would ` +
          `never be checked.`,
      });
    }
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

  const rollup = pages.find((page) => page.path === ROLLUP_PAGE);
  const violations = [
    ...pages.flatMap((page) => auditPage(page, surface, lineCountOf)),
    // The roll-up's own "shipped" heading is a section title, not a delta, and
    // neither is the RFC root's - only the per-piece pages carry real badges.
    ...(rollup
      ? auditRollup(
        rollup,
        pages.filter((page) => page.path !== ROLLUP_PAGE && page.path !== RFC_ROOT),
      )
      : []),
  ];

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
