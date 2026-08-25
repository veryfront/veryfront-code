/**
 * `veryfront/chat` black-box backward-compat contract.
 *
 * This list records the supported compatibility surface observed when the
 * composition API was introduced. Removing an entry is a backward-incompatible
 * API break and must fail explicitly; additive exports remain allowed.
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
  "useAttachments",
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
