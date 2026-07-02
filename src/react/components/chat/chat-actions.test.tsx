/**
 * ChatActions — render-or-compose contract.
 *
 * `ChatActions` is a self-contained `+` menu whose surface (`Content` / `Item`)
 * portals through `Floating` (`createPortal` + `document`), which is unavailable
 * under `renderToString`. So SSR renders only the always-present trigger button;
 * the portalled rows are exercised for wiring + className merge but their DOM
 * lands in the (absent) portal, so we assert on what SSR can see (the trigger)
 * and prove the sub-parts + hook contract structurally.
 */
import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatActions, useChatActions } from "./chat-actions.tsx";

describe("ChatActions — render-or-compose", () => {
  it("preset (no children) renders the default `+` trigger button", () => {
    const html = renderToString(
      <ChatActions
        onAttachFiles={() => {}}
        actions={[{ label: "Add from URL", onSelect: () => {} }]}
      />,
    );
    // Default trigger button is present with its aria-label.
    assertStringIncludes(html, "Add attachments and settings");
  });

  it("recompose: a custom Trigger renders in place of the default", () => {
    const html = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger>
          <button type="button">custom-trigger</button>
        </ChatActions.Trigger>
        <ChatActions.Content>
          <ChatActions.Item onSelect={() => {}}>Row</ChatActions.Item>
        </ChatActions.Content>
      </ChatActions.Root>,
    );
    // The composed trigger renders; the default `+` button does not.
    assertStringIncludes(html, "custom-trigger");
    assert(
      !html.includes("Add attachments and settings"),
      "custom Trigger must replace the default `+` button",
    );
  });

  it("Trigger className merges onto the default `+` button", () => {
    const html = renderToString(
      <ChatActions.Root>
        <ChatActions.Trigger className="vf-trigger-x" />
        <ChatActions.Content />
      </ChatActions.Root>,
    );
    // `shrink-0` (default) and the merged class both survive.
    assertStringIncludes(html, "vf-trigger-x");
    assertStringIncludes(html, "shrink-0");
  });

  it("exposes every documented sub-part off the compound namespace", () => {
    for (const part of ["Root", "Trigger", "Content", "Item", "Preset"]) {
      assert(
        typeof (ChatActions as unknown as Record<string, unknown>)[part] ===
          "function",
        `ChatActions.${part} is missing`,
      );
    }
  });

  it("useChatActions throws outside a ChatActions provider", () => {
    function Orphan() {
      useChatActions();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "useChatActions must throw outside a ChatActions");
  });
});
