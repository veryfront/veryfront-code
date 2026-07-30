import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Slot } from "./slot.tsx";

function installDom(dom: JSDOM): () => void {
  const window = dom.window;
  const replacements: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    MouseEvent: window.MouseEvent,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const key of Object.keys(replacements)) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

describe("Slot", () => {
  it("fails closed when its child is not exactly one React element", () => {
    assertThrows(
      () => renderToString(<Slot>text is not an element</Slot>),
      TypeError,
      "exactly one valid React element",
    );
    assertThrows(
      () =>
        renderToString(
          <Slot>
            <button type="button">One</button>
            <button type="button">Two</button>
          </Slot>,
        ),
      TypeError,
      "exactly one valid React element",
    );
  });

  it("preserves React 19 callback-ref cleanup for both composed refs", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);
    const attached: string[] = [];
    const cleaned: string[] = [];
    const outerRef: React.RefCallback<HTMLElement> = (element) => {
      if (!element) return;
      attached.push("outer");
      return () => {
        cleaned.push("outer");
      };
    };
    const childRef: React.RefCallback<HTMLButtonElement> = (element) => {
      if (!element) return;
      attached.push("child");
      return () => {
        cleaned.push("child");
      };
    };

    try {
      flushSync(() => {
        root.render(
          <Slot ref={outerRef}>
            <button ref={childRef} type="button">Trigger</button>
          </Slot>,
        );
      });
      assertEquals(attached, ["outer", "child"]);
      assertEquals(cleaned, []);
    } finally {
      flushSync(() => root.unmount());
      assertEquals(cleaned, ["child", "outer"]);
      restore();
    }
  });

  it("does not run slot behavior after a child handler cancels the event", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/" },
    );
    const restore = installDom(dom);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);
    let slotCalls = 0;

    try {
      flushSync(() => {
        root.render(
          <Slot onClick={() => slotCalls += 1}>
            <button
              type="button"
              onClick={(event) => event.preventDefault()}
            >
              Cancel
            </button>
          </Slot>,
        );
      });
      const button = document.querySelector("button");
      assert(button);
      button.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assertEquals(slotCalls, 0);
    } finally {
      flushSync(() => root.unmount());
      restore();
    }
  });
});
