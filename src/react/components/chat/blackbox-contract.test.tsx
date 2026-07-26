/**
 * `veryfront/chat` black-box backward-compat contract.
 *
 * A scan of every example consumer (agentic-job-submission-processing,
 * customer-operations-agent, veryfront-router-testing) shows the ONLY chat
 * surface imported externally is the list below — the L1 `<Chat>` preset, a
 * handful of shell pieces, and three hooks/helpers. The deep L2/L3 internals
 * (`ChatRoot`, `ChatInput`, `ChatMessageList`, `Message`, `ToolCall`, the
 * pickers, …) are consumed only *inside* `<Chat>`, which we control.
 *
 * The rule (Matt, 2026-07-26): reshape the internals freely toward the RFC 2980
 * shape, but this consumed surface must NEVER disappear — `@deprecate`, never
 * delete. Removing any entry here is a backward-compat break and fails this test.
 * (Adding to the surface is fine; extend the list intentionally.)
 */
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as chat from "veryfront/chat";
import * as uploads from "veryfront/chat/uploads";

/** The externally-imported `veryfront/chat` surface (data-backed). */
const CONSUMED_SURFACE = [
  "Chat",
  "AppShell",
  "ChatSidebar",
  "ChatThemeScope",
  "ConversationsProvider",
  "Tabs",
  "TabsItem",
  "AttachmentsPanel",
  "useChat",
  "useUploadsRegistry",
] as const;

describe("veryfront/chat black-box backward-compat contract", () => {
  for (const name of CONSUMED_SURFACE) {
    it(`still exports ${name} (backward compat — do not delete, only @deprecate)`, () => {
      assert(
        name in chat &&
          (chat as Record<string, unknown>)[name] != null,
        `${name} is imported by real consumers — it must stay exported`,
      );
    });
  }

  it("still exports createChatUploadHandler from veryfront/chat/uploads", () => {
    assert(
      typeof (uploads as Record<string, unknown>).createChatUploadHandler ===
        "function",
      "createChatUploadHandler is consumed by app/api/uploads routes",
    );
  });
});
