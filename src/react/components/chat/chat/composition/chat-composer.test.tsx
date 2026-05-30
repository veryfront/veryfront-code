import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ChatComposer } from "./chat-composer.tsx";

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
  });

  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

describe("react/components/chat/chat/composition/chat-composer", () => {
  it("opens upload and select document actions from the attachment button", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let selectCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatComposer
            input=""
            onChange={() => {}}
            onAttach={() => {}}
            onSelectAttachment={() => {
              selectCalls += 1;
            }}
          />,
        );
      });

      const attachButton = document.querySelector(
        'button[aria-label="Attach file"]',
      );
      assert(attachButton, "Expected attachment button to exist");

      flushSync(() => {
        attachButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const uploadAction = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Upload document",
      );
      const selectAction = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Select document",
      );
      const menu = document.querySelector('[role="menu"]');
      assert(uploadAction, "Expected upload action to render");
      assert(selectAction, "Expected select action to render");
      assert(menu, "Expected attachment menu to render");
      assertEquals(
        (menu as HTMLElement).style.bottom,
        "calc(100% + 0.5rem)",
      );

      flushSync(() => {
        selectAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      assertEquals(selectCalls, 1);
      root.unmount();
    } finally {
      restore();
    }
  });
});
