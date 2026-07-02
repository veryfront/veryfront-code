import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
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
    KeyboardEvent: globalThis.KeyboardEvent,
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
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
  });

  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

describe("react/components/chat/chat/composition/chat-composer", () => {
  it("labels the multiline message input for assistive technology", () => {
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
          <ChatComposer
            input=""
            onChange={() => {}}
            placeholder="Ask Veryfront"
          />,
        );
      });

      const textarea = document.querySelector("textarea");
      assert(textarea, "Expected multiline composer input to render");
      assertEquals(textarea.getAttribute("aria-label"), "Ask Veryfront");
      root.unmount();
    } finally {
      restore();
    }
  });

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
        'button[aria-label="Add document"]',
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
      // The menu is now the portalled DropdownMenu primitive (escapes the
      // composer overflow) — it renders under <body>, not inline.
      assert(menu, "Expected attachment menu to render");
      assertEquals(menu.parentElement, document.body);

      flushSync(() => {
        selectAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      assertEquals(selectCalls, 1);
      root.unmount();
    } finally {
      restore();
    }
  });

  it("submits multiline input on Enter and keeps Shift+Enter for newlines", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const restore = installDomGlobals(dom);
    let submitCalls = 0;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");

      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <ChatComposer
            input="Review Article 30"
            onChange={() => {}}
            onSubmit={() => {
              submitCalls += 1;
            }}
          />,
        );
      });

      const textarea = document.querySelector("textarea");
      assert(textarea, "Expected multiline composer input to render");
      const reactPropsKey = Object.keys(textarea).find((key) => key.startsWith("__reactProps$"));
      assert(reactPropsKey, "Expected React props to be attached");
      const reactProps = (textarea as unknown as Record<string, unknown>)[
        reactPropsKey
      ] as {
        onKeyDown?: (
          event: {
            key: string;
            shiftKey?: boolean;
            preventDefault: () => void;
          },
        ) => void;
      };
      assert(reactProps.onKeyDown, "Expected input keydown handler to exist");
      let preventDefaultCalls = 0;

      reactProps.onKeyDown({
        key: "Enter",
        shiftKey: true,
        preventDefault: () => {
          preventDefaultCalls += 1;
        },
      });
      assertEquals(submitCalls, 0);
      assertEquals(preventDefaultCalls, 0);

      reactProps.onKeyDown({
        key: "Enter",
        preventDefault: () => {
          preventDefaultCalls += 1;
        },
      });

      assertEquals(submitCalls, 1);
      assertEquals(preventDefaultCalls, 1);
      root.unmount();
    } finally {
      restore();
    }
  });

  it("uses the copied Studio prompt shell and non-scaling primary submit button", () => {
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
          <ChatComposer
            input="Hej"
            onChange={() => {}}
            onSubmit={() => {}}
          />,
        );
      });

      const composer = document.querySelector("form > div");
      // The submit control is now the shared `Button` primitive (icon-primary),
      // labelled "Send" — no more bespoke `data-submit-button` element.
      const submitButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Send"]',
      );
      assert(composer, "Expected composer shell to render");
      assert(submitButton, "Expected submit button to render");

      assert(
        (composer as HTMLElement).className.includes(
          "rounded-[var(--radius-lg)]",
        ),
      );
      assert(
        (composer as HTMLElement).className.includes("bg-[var(--secondary)]"),
      );
      assertEquals(
        (composer as HTMLElement).className.includes("focus-within:border"),
        false,
      );
      // Studio's submit button does not scale on press.
      assertEquals(submitButton.className.includes("active:scale"), false);
      root.unmount();
    } finally {
      restore();
    }
  });
});
