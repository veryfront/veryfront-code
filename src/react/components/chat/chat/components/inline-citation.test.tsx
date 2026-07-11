import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { InlineCitation } from "./inline-citation.tsx";

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    MouseEvent: globalThis.MouseEvent,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  });

  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

describe("InlineCitation", () => {
  it("exposes the trigger and hover card as compound parts", async () => {
    assert(typeof InlineCitation.Trigger === "function");
    assert(typeof InlineCitation.Card === "function");

    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const root = createRoot(rootElement);

      flushSync(() => {
        root.render(
          <InlineCitation
            index={0}
            source={{ title: "Veryfront runs", url: "/runs" }}
          >
            <InlineCitation.Trigger className="vf-citation-trigger" />
            <InlineCitation.Card className="vf-citation-card">
              Custom citation card
            </InlineCitation.Card>
          </InlineCitation>,
        );
      });

      const trigger = document.querySelector("button");
      assert(trigger, "Expected citation trigger to render");
      assert(trigger.className.includes("vf-citation-trigger"));

      trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 170));
      flushSync(() => {
        // Flush the hover timer's state update before inspecting the DOM.
      });

      const card = document.querySelector(".vf-citation-card");
      assert(card, "Expected citation card to render after hover");
      assertEquals(card.textContent, "Custom citation card");

      root.unmount();
    } finally {
      restore();
    }
  });
});
