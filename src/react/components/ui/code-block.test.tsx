import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CodeBlock, useClipboard } from "./code-block.tsx";

function installDom(
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>'),
): { restore: () => void; window: JSDOM["window"] } {
  const window = dom.window;
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    self: globalThis.self,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event,
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
    Event: window.Event,
    MouseEvent: window.MouseEvent,
  });

  return {
    window,
    restore: () => {
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

describe("CodeBlock clipboard integration", () => {
  it("passes a real click event to a custom-header onCopy interceptor", async () => {
    const dom = installDom();
    const writes: string[] = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
      },
    });
    let interceptedEvent: React.MouseEvent | undefined;

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <CodeBlock
            code="const value = 1;"
            language="ts"
            renderHeader={({ copy }) => (
              <button type="button" onClick={copy}>Copy custom header</button>
            )}
            onCopy={(event, next) => {
              interceptedEvent = event;
              event.preventDefault();
              queueMicrotask(next);
            }}
          />,
        );
      });

      const button = rootElement.querySelector("button");
      assert(button, "custom copy control renders");
      const nativeEvent = new dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(nativeEvent);
      await settle();

      assert(interceptedEvent, "onCopy receives an event");
      assertStrictEquals(interceptedEvent.nativeEvent, nativeEvent);
      assert(interceptedEvent.isDefaultPrevented(), "the React event remains usable");
      assertEquals(writes, ["const value = 1;"]);

      flushSync(() => root.unmount());
    } finally {
      dom.restore();
    }
  });

  it("fails closed when a custom header drops the event required by onCopy", async () => {
    const dom = installDom();
    let writes = 0;
    let interceptions = 0;
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          writes += 1;
          return Promise.resolve();
        },
      },
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <CodeBlock
            code="sensitive"
            renderHeader={({ copy }) => (
              <button type="button" onClick={() => copy()}>Copy without event</button>
            )}
            onCopy={(_event, next) => {
              interceptions += 1;
              next();
            }}
          />,
        );
      });

      const button = rootElement.querySelector("button");
      assert(button, "custom copy control renders");
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle();

      assertEquals(interceptions, 0);
      assertEquals(writes, 0);
      flushSync(() => root.unmount());
    } finally {
      dom.restore();
    }
  });

  it("keeps flat and collapsible eventless copies in the rendered document", async () => {
    const globalDom = new JSDOM("<!doctype html><html><body></body></html>");
    const targetDom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    const { restore } = installDom(globalDom);
    const globalWrites: string[] = [];
    const targetWrites: string[] = [];
    Object.defineProperty(globalDom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          globalWrites.push(text);
          return Promise.resolve();
        },
      },
    });
    Object.defineProperty(targetDom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          targetWrites.push(text);
          return Promise.resolve();
        },
      },
    });

    try {
      const rootElement = targetDom.window.document.getElementById("root");
      assert(rootElement, "target root fixture exists");
      const root = createRoot(rootElement);
      for (const collapsible of [false, true]) {
        const code = collapsible ? "collapsible target" : "flat target";
        flushSync(() => {
          root.render(
            <CodeBlock
              code={code}
              collapsible={collapsible}
              renderHeader={({ copy }) => (
                <button type="button" onClick={() => copy()}>Copy without event</button>
              )}
            />,
          );
        });

        const button = rootElement.querySelector("button");
        assert(button, "custom copy control renders");
        button.dispatchEvent(new targetDom.window.MouseEvent("click", { bubbles: true }));
        await settle();
      }

      assertEquals(targetWrites, ["flat target", "collapsible target"]);
      assertEquals(globalWrites, []);
      flushSync(() => root.unmount());
    } finally {
      restore();
      targetDom.window.close();
    }
  });

  it("reports failure only when both clipboard mechanisms fail", async () => {
    const dom = installDom();
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });

    function Harness(): React.ReactElement {
      const clipboard = useClipboard("not copied");
      return (
        <button
          type="button"
          data-copied={String(clipboard.copied)}
          data-failed={String(clipboard.failed)}
          onClick={(event) => clipboard.copy(event.currentTarget.ownerDocument)}
        >
          Copy
        </button>
      );
    }

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<Harness />));
      const button = rootElement.querySelector("button");
      assert(button, "copy control renders");

      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle();

      assertEquals(button.dataset.copied, "false");
      assertEquals(button.dataset.failed, "true");
      assertEquals(document.querySelectorAll("textarea").length, 0);

      flushSync(() => root.unmount());
    } finally {
      dom.restore();
    }
  });

  it("exposes failed copy feedback to assistive technology", async () => {
    const dom = installDom();
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => root.render(<CodeBlock code="not copied" />));
      const button = rootElement.querySelector<HTMLButtonElement>("button");
      assert(button, "copy control renders");

      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle();

      assertEquals(button.getAttribute("aria-label"), "Unable to copy code");
      assertEquals(
        rootElement.querySelector('[role="status"]')?.textContent,
        "Unable to copy code",
      );
      flushSync(() => root.unmount());
    } finally {
      dom.restore();
    }
  });
});
