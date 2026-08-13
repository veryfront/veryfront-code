import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  auditPage,
  auditRollup,
  collectBarrelExports,
  collectDeclarations,
  collectIdentifiers,
  collectObjectLiteralCompounds,
  headingSlug,
  parseRollupRows,
  parseShippedBadges,
  type PublicSurface,
  resolvesOnSurface,
} from "./audit-rfc-status.ts";
import { collectCompoundParts } from "./audit-chat-composability.ts";

const SOURCE = [{
  path: "chat-input.tsx",
  content: `
    export function ChatInputField(props: ChatInputFieldProps) {}
    export const ChatInput = Object.assign(ChatInputBase, {
      Root: ChatInputRoot,
      Field: ChatInputField,
    });
    export const ChatEmptyState = {
      Root,
      Avatar: EmptyStateAvatar,
    };
    const ChatSidebarItemCompound = Object.assign(ChatSidebarItem, {
      Menu: ChatSidebarItemMenu,
    });
    export const ChatSidebar = Object.assign(ChatSidebarBase, {
      Item: ChatSidebarItemCompound,
    });
  `,
}];

function surfaceOf(barrel: string): PublicSurface {
  const compounds = collectCompoundParts(SOURCE);
  for (const [name, parts] of collectObjectLiteralCompounds(SOURCE)) {
    const merged = compounds.get(name) ?? new Set<string>();
    for (const part of parts) merged.add(part);
    compounds.set(name, merged);
  }
  return {
    exports: collectBarrelExports(barrel),
    compounds,
    declarations: collectDeclarations(SOURCE),
    identifiers: collectIdentifiers(SOURCE),
  };
}

const BARREL = `
  export { ChatInput, type ChatInputFieldProps, mergeProps } from "./chat.tsx";
  export { ChatEmptyState, ChatSidebar } from "./chat.tsx";
  export function formatSize(bytes: number): string {}
`;

const SURFACE = surfaceOf(BARREL);
const anyFile = (path: string) => path === "src/real.ts" ? 200 : null;

function page(body: string) {
  return { path: "docs/rfcs/29-chat-api-shape/components/chat-input.md", content: body };
}

function rollupPage(body: string) {
  return { path: "docs/rfcs/29-chat-api-shape/README.md", content: body };
}

/**
 * A roll-up table with two rows, plus prose and a link that is not a row.
 *
 * Each row's anchor is the slug of the delta heading it claims, so the table is
 * checkable one delta at a time rather than one page at a time.
 */
const ROLLUP = [
  "# Reference index",
  "",
  "See [the helpers page](./helpers.md) for the full list.",
  "",
  "| Delta | Status | Landed in |",
  "| --- | --- | --- |",
  "| [`mergeProps` made public](./helpers.md#mergeprops---new---shipped-srcrealts85) | `shipped` | `src/real.ts:85` |",
  "| [`useChatScroll`](./hooks/use-chat-scroll.md#usechatscroll---new---partly-shipped-srcrealts177) | `partly shipped` | `src/real.ts:177` |",
].join("\n");

const BADGED_HELPERS = {
  path: "docs/rfcs/29-chat-api-shape/helpers.md",
  content: "### `mergeProps` - `new` - `shipped` (src/real.ts:85)",
};
const BADGED_SCROLL = {
  path: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
  content: "### `useChatScroll` - `new` - `partly shipped` (src/real.ts:177)",
};
/** The same page carrying a *second* landed delta the roll-up does not name. */
const TWO_BADGE_SCROLL = {
  path: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
  content: [
    "### `useChatScroll` - `new` - `partly shipped` (src/real.ts:177)",
    "",
    "### `useChatScroll` stick-to-bottom primitive - `new` - `shipped` (src/real.ts:180)",
  ].join("\n"),
};

/**
 * Two deltas whose headings differ only by a comma - punctuation the anchor
 * rule strips, so both slugify to the same base and GitHub suffixes the second
 * `-1`.
 */
const COLLIDING_SCROLL = {
  path: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
  content: [
    "### `useChatScroll`, stick-to-bottom - `new` - `shipped` (src/real.ts:10)",
    "",
    "### `useChatScroll` stick-to-bottom - `new` - `shipped` (src/real.ts:10)",
  ].join("\n"),
};

const LEDGER = [
  "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
  ">",
  "> - **Exported from `veryfront/chat` today:** `ChatInput`, `ChatInput.Field`",
  "> - **Not exported today:** `ChatInput.Preview`",
].join("\n");

describe("audit-rfc-status", () => {
  it("resolves a bare export and a compound sub-part", () => {
    assertEquals(resolvesOnSurface("ChatInput", SURFACE), true);
    assertEquals(resolvesOnSurface("ChatInput.Field", SURFACE), true);
    assertEquals(resolvesOnSurface("ChatInput.Preview", SURFACE), false);
  });

  it("resolves a compound spelled as a plain object literal", () => {
    assertEquals(resolvesOnSurface("ChatEmptyState.Avatar", SURFACE), true);
    assertEquals(resolvesOnSurface("ChatEmptyState.Heading", SURFACE), false);
  });

  it("resolves a nested sub-part through a `…Compound` alias", () => {
    assertEquals(resolvesOnSurface("ChatSidebar.Item.Menu", SURFACE), true);
    assertEquals(resolvesOnSurface("ChatSidebar.Item.Title", SURFACE), false);
  });

  it("does not resolve a sub-part whose base is not exported", () => {
    assertEquals(resolvesOnSurface("Unknown.Part", SURFACE), false);
  });

  it("accepts a page whose ledger matches the surface", () => {
    assertEquals(auditPage(page(`# ChatInput\n\n${LEDGER}\n`), SURFACE, anyFile), []);
  });

  it("rejects a blanket 'not yet implemented' claim", () => {
    const violations = auditPage(
      page(`# ChatInput\n\n> This page documents the proposed API - not yet implemented.\n\n${LEDGER}\n`),
      SURFACE,
      anyFile,
    );
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("blanket status claim"), true);
  });

  // The wording that slipped past the first two patterns: a document-wide
  // negative phrased around "nothing else" instead of "not yet".
  it("rejects a blanket 'nothing else … has been implemented' claim", () => {
    const violations = auditPage(
      page(
        `# ChatInput\n\nNothing else in this document has been implemented.\n\n${LEDGER}\n`,
      ),
      SURFACE,
      anyFile,
    );
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("blanket status claim"), true);
  });

  // Rule 2. Only the last banner is parsed, so a second one resolves silently
  // and rule 6 then checks the wrong claim.
  it("rejects a page carrying a second status block", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
      "",
      "> **Status: RFC 29 - partly landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
      "",
      "### `ChatInput.Field` - `changed` - `shipped` (src/real.ts:1)",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    // A duplicated block duplicates its lists too, so all three are reported:
    // the banner on line 8 and the two repeated list lines below it.
    assertEquals(violations.map((v) => v.line), [8, 10, 11]);
    assertEquals(violations[0].message.includes("a second status block"), true);
    assertEquals(violations[1].message.includes('a second "**Exported from'), true);
    assertEquals(violations[2].message.includes('a second "**Not exported today:**"'), true);
  });

  // Rule 2, one level down. Rejecting only duplicate *banners* left the same
  // hole open on the symbol lists: each list is overwritten by the last match,
  // so a false line hides behind a clean one further down and the page audits
  // clean. The banner is single here - only the lists repeat.
  it("rejects a duplicated `Not exported today` line hiding a false claim", () => {
    const body = [
      "# Helpers",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** none",
      "> - **Not exported today:** `mergeProps`",
      "> - **Not exported today:** none",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes('a second "**Not exported today:**"'), true);
    assertEquals(violations[0].line, 7);
  });

  it("rejects a duplicated `Exported from` line hiding a false claim", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput.Preview`",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes('a second "**Exported from'), true);
    assertEquals(violations[0].line, 6);
  });

  it("rejects a duplicated `Not in `src/` today` line", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** none",
      "> - **Not exported today:** none",
      "> - **Not in `src/` today:** `ChatInputRoot`",
      "> - **Not in `src/` today:** `neverAppearsAnywhere`",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes('a second "**Not in'), true);
    assertEquals(violations[0].line, 8);
  });

  it("rejects a page with no status ledger at all", () => {
    const violations = auditPage(page("# ChatInput\n\nJust prose.\n"), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("missing status ledger"), true);
  });

  // The regression this lint exists for: RFC 29 marked `mergeProps` as new and
  // unimplemented while it shipped from `veryfront/chat`.
  it("rejects a symbol claimed absent that actually ships", () => {
    const body = [
      "# Helpers",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** none",
      "> - **Not exported today:** `mergeProps`",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("it ships from"), true);
  });

  it("rejects a symbol claimed exported that does not resolve", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput.Preview`",
      "> - **Not exported today:** none",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("is not on the"), true);
  });

  it("rejects a prop claimed unbuilt that the source already uses", () => {
    const body = [
      `# ChatInput`,
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** none",
      "> - **Not exported today:** none",
      "> - **Not in `src/` today:** `ChatInputRoot`",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("already uses that name"), true);
  });

  it("accepts a `shipped` badge whose source anchor resolves", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - partly landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
      "",
      "### `ChatInput.Field` - `changed` - `partly shipped` (src/real.ts:42)",
    ].join("\n");
    assertEquals(auditPage(page(body), SURFACE, anyFile), []);
  });

  it("rejects a `shipped` badge with no source anchor", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - partly landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
      "",
      "### `ChatInput.Field` - `changed` - `shipped`",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 2); // malformed badge + banner disagreement
    assertEquals(violations[0].message.includes("must cite the source"), true);
  });

  it("rejects a `shipped` anchor pointing past the end of the file", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - partly landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
      "",
      "### `ChatInput.Field` - `changed` - `shipped` (src/real.ts:9999)",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("past"), true);
  });

  it("rejects a `shipped` anchor whose file does not exist", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - partly landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
      "",
      "### `ChatInput.Field` - `changed` - `shipped` (src/gone.ts:1)",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("does not exist"), true);
  });

  // The page-level summary can no longer drift from the deltas below it.
  it("rejects a 'partly landed' banner with no shipped delta", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - partly landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("no delta on this page"), true);
  });

  it("rejects a 'nothing has landed' banner above a shipped delta", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** `ChatInput`",
      "> - **Not exported today:** none",
      "",
      "### `ChatInput.Field` - `changed` - `shipped` (src/real.ts:1)",
    ].join("\n");
    const violations = auditPage(page(body), SURFACE, anyFile);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("Switch the banner"), true);
  });

  // Rule 7. The index table calls itself "the complete set", which is the same
  // corpus-wide claim the blanket banners made - so it is checked, not trusted.
  it("reads the roll-up table's rows, ignoring the prose around them", () => {
    assertEquals(parseRollupRows(ROLLUP), [
      {
        line: 7,
        page: "docs/rfcs/29-chat-api-shape/helpers.md",
        anchor: "mergeprops---new---shipped-srcrealts85",
      },
      {
        line: 8,
        page: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
        anchor: "usechatscroll---new---partly-shipped-srcrealts177",
      },
    ]);
  });

  // A row that links its page without a `./` prefix, or reaches the RFC root
  // with `../`, links the same document. Dropping it from the parse would
  // excuse the row instead of checking it.
  it("reads roll-up rows whose links are bare or `../`-relative", () => {
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [`mergeProps`](helpers.md#mergeprops---new---shipped-srcrealts85) | `shipped` | `src/real.ts:85` |",
      "| [root](../29-chat-api-shape.md#already-landed) | `shipped` | `src/real.ts:1` |",
    ].join("\n");
    assertEquals(parseRollupRows(rollup), [
      {
        line: 3,
        page: "docs/rfcs/29-chat-api-shape/helpers.md",
        anchor: "mergeprops---new---shipped-srcrealts85",
      },
      { line: 4, page: "docs/rfcs/29-chat-api-shape.md", anchor: "already-landed" },
    ]);
  });

  it("derives a delta's identity from its heading anchor", () => {
    assertEquals(
      headingSlug("`mergeProps` - `new` - `shipped` (src/real.ts:85)"),
      "mergeprops---new---shipped-srcrealts85",
    );
  });

  it("rejects a roll-up row that links a page without naming a delta", () => {
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [`mergeProps` made public](./helpers.md) | `shipped` | `src/real.ts:85` |",
    ].join("\n");
    const violations = auditRollup(rollupPage(rollup), [BADGED_HELPERS]);
    // The row names no delta, and the badge it meant is left unclaimed.
    assertEquals(violations.length, 2);
    assertEquals(violations[0].message.includes("without naming a delta"), true);
    assertEquals(violations[1].message.includes("has no ") && violations[1].message.includes("row in this table"), true);
  });

  it("accepts a roll-up matching the pages that badge a delta", () => {
    assertEquals(auditRollup(rollupPage(ROLLUP), [BADGED_HELPERS, BADGED_SCROLL]), []);
  });

  it("rejects a badged page the roll-up never lists", () => {
    const extra = {
      path: "docs/rfcs/29-chat-api-shape/hooks/use-chat.md",
      content: "### `useChat` - `new` - `shipped` (src/real.ts:12)",
    };
    const violations = auditRollup(rollupPage(ROLLUP), [BADGED_HELPERS, BADGED_SCROLL, extra]);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("has no row in this table"), true);
    assertEquals(violations[0].message.includes("hooks/use-chat.md"), true);
  });

  it("rejects a roll-up row for a page that badges nothing", () => {
    const unbadged = {
      path: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
      content: "### `useChatScroll` - `new`\n\nStill proposed.",
    };
    const violations = auditRollup(rollupPage(ROLLUP), [BADGED_HELPERS, unbadged]);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("has landed, but that page badges"), true);
    assertEquals(violations[0].line, 8);
  });

  // Rule 7, per delta. Collapsing both sides to a set of page paths accepts any
  // row for a page that badges *something*, so a page with two landed deltas is
  // covered by one row, and a row may name a delta that does not exist.
  it("rejects a page whose second badged delta has no row of its own", () => {
    const violations = auditRollup(rollupPage(ROLLUP), [BADGED_HELPERS, TWO_BADGE_SCROLL]);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("has no row in this table"), true);
    assertEquals(violations[0].message.includes("stick-to-bottom"), true);
  });

  it("rejects a roll-up row whose anchor names no badge on the target page", () => {
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [`mergeProps` made public](./helpers.md#mergeprops---new---shipped-srcrealts85) | `shipped` | `src/real.ts:85` |",
      "| [`mergeProps` renamed](./helpers.md#mergeprops---renamed---shipped-srcrealts99) | `shipped` | `src/real.ts:99` |",
    ].join("\n");
    const violations = auditRollup(rollupPage(rollup), [BADGED_HELPERS]);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("names no `shipped` delta"), true);
    assertEquals(violations[0].line, 4);
  });

  // Rule 7, one level further down. Two headings on a page can slugify to the
  // same anchor - punctuation is stripped, so a comma is the whole difference.
  // GitHub resolves that by suffixing the second occurrence `-1`, and the roll-up
  // row has to link the anchor GitHub really renders.
  it("gives colliding headings the `-1` suffix GitHub renders", () => {
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [first](./hooks/use-chat-scroll.md#usechatscroll-stick-to-bottom---new---shipped-srcrealts10) | `shipped` | `src/real.ts:10` |",
      "| [second](./hooks/use-chat-scroll.md#usechatscroll-stick-to-bottom---new---shipped-srcrealts10-1) | `shipped` | `src/real.ts:10` |",
    ].join("\n");
    assertEquals(auditRollup(rollupPage(rollup), [COLLIDING_SCROLL]), []);
  });

  // The defect a collision hides: reducing the page's badges to a slug-keyed map
  // drops all but the last, so the earlier delta leaves the checkable set and its
  // missing row is never reported - the completeness rule silently shrinks.
  it("still reports a colliding badge that has no row of its own", () => {
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [first](./hooks/use-chat-scroll.md#usechatscroll-stick-to-bottom---new---shipped-srcrealts10) | `shipped` | `src/real.ts:10` |",
    ].join("\n");
    const violations = auditRollup(rollupPage(rollup), [COLLIDING_SCROLL]);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("has no row in this table"), true);
    assertEquals(violations[0].message.includes("-1"), true);
  });

  // A suffixed slug can collide with a heading whose own text ends `-1`.
  // Counting occurrences of the base alone would hand `-1` out twice, giving two
  // deltas one identity - the exact collapse this rule exists to prevent.
  it("does not reissue a suffix a literal heading already took", () => {
    const page = {
      path: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
      content: [
        "### `useChatScroll` - `new` - `shipped` (src/real.ts:10)",
        "",
        // Not a badge, but still a heading GitHub numbers - and its own text
        // slugifies to exactly the first heading's slug + "-1".
        "### `useChatScroll` - `new` - `shipped` (src/real.ts:10) 1",
        "",
        "### `useChatScroll` - `new` - `shipped` (src/real.ts:10)",
      ].join("\n"),
    };
    const base = "usechatscroll---new---shipped-srcrealts10";
    // The third heading skips the taken `-1` and lands on `-2`, as GitHub does.
    assertEquals(
      parseShippedBadges(page.content).badges.map((b) => b.slug),
      [base, `${base}-2`],
    );
  });

  // A `#` line inside a code fence is not a heading. Counting it would take a
  // number GitHub never issued and shift the suffix of every heading below it.
  it("ignores headings inside code fences when numbering anchors", () => {
    const page = {
      path: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
      content: [
        "### `useChatScroll`, stick-to-bottom - `new` - `shipped` (src/real.ts:10)",
        "",
        "~~~md",
        "### `useChatScroll` stick-to-bottom - `new` - `shipped` (src/real.ts:10)",
        "```",
        "~~~",
        "",
        "### `useChatScroll` stick-to-bottom - `new` - `shipped` (src/real.ts:10)",
      ].join("\n"),
      // The nested ``` must not close the ~~~ fence early - if it did, the
      // sample heading would take `-1` and the real one below would slide to
      // `-2`, and no row could name it.
    };
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [first](./hooks/use-chat-scroll.md#usechatscroll-stick-to-bottom---new---shipped-srcrealts10) | `shipped` | `src/real.ts:10` |",
      "| [second](./hooks/use-chat-scroll.md#usechatscroll-stick-to-bottom---new---shipped-srcrealts10-1) | `shipped` | `src/real.ts:10` |",
    ].join("\n");
    assertEquals(auditRollup(rollupPage(rollup), [page]), []);
  });

  // GitHub keeps Unicode letters in an anchor; stripping them mints a slug no
  // heading on the page has, so a correctly-linked row reads as a broken one.
  it("preserves Unicode heading characters, as GitHub does", () => {
    assertEquals(
      headingSlug("`Café` scroll - `new` - `shipped` (src/real.ts:10)"),
      "café-scroll---new---shipped-srcrealts10",
    );
    assertEquals(
      headingSlug("`日本語` heading - `new` - `shipped` (src/real.ts:10)"),
      "日本語-heading---new---shipped-srcrealts10",
    );
    // Punctuation and symbols still fall away - an em dash is not a letter.
    assertEquals(headingSlug("`naïve` réglage — dash"), "naïve-réglage--dash");
  });

  it("accepts a roll-up row whose anchor carries Unicode", () => {
    const page = {
      path: "docs/rfcs/29-chat-api-shape/hooks/use-chat-scroll.md",
      content: "### `Café` scroll - `new` - `shipped` (src/real.ts:10)",
    };
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [café](./hooks/use-chat-scroll.md#café-scroll---new---shipped-srcrealts10) | `shipped` | `src/real.ts:10` |",
    ].join("\n");
    assertEquals(auditRollup(rollupPage(rollup), [page]), []);
  });

  it("rejects two roll-up rows pointing at the same badge", () => {
    const rollup = [
      "| Delta | Status | Landed in |",
      "| --- | --- | --- |",
      "| [`mergeProps` made public](./helpers.md#mergeprops---new---shipped-srcrealts85) | `shipped` | `src/real.ts:85` |",
      "| [`mergeProps` again](./helpers.md#mergeprops---new---shipped-srcrealts85) | `shipped` | `src/real.ts:85` |",
    ].join("\n");
    const violations = auditRollup(rollupPage(rollup), [BADGED_HELPERS]);
    assertEquals(violations.length, 1);
    assertEquals(violations[0].message.includes("a second row for"), true);
    assertEquals(violations[0].line, 4);
  });

  it("reads `none` as an empty list, not a symbol named none", () => {
    const body = [
      "# ChatInput",
      "",
      "> **Status: RFC 29 - proposed; nothing on this page has landed.** ok:",
      ">",
      "> - **Exported from `veryfront/chat` today:** none",
      "> - **Not exported today:** none",
    ].join("\n");
    assertEquals(auditPage(page(body), SURFACE, anyFile), []);
  });
});
