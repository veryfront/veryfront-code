import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  auditPage,
  collectBarrelExports,
  collectDeclarations,
  collectIdentifiers,
  collectObjectLiteralCompounds,
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
