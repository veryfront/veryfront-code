import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getPolymorphicButtonType, Slot } from "./slot.tsx";

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
    KeyboardEvent: window.KeyboardEvent,
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

  it("defaults button type only when the slotted child is a native button", () => {
    const OpaqueAnchor = React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement>
    >((props, ref) => <a {...props} ref={ref} />);
    const OpaqueButton = React.forwardRef<
      HTMLButtonElement,
      React.ButtonHTMLAttributes<HTMLButtonElement>
    >((props, ref) => <button {...props} ref={ref} />);

    const nativeButtonChild = React.createElement("button", null, "Native button");
    const opaqueAnchorChild = <OpaqueAnchor href="#opaque">Opaque anchor</OpaqueAnchor>;
    const opaqueButtonChild = <OpaqueButton>Opaque button</OpaqueButton>;
    const ownedOpaqueButtonChild = <OpaqueButton type="button">Owned button</OpaqueButton>;

    const nativeButton = renderToString(
      <Slot type={getPolymorphicButtonType(true, nativeButtonChild)}>
        {nativeButtonChild}
      </Slot>,
    );
    const opaqueAnchor = renderToString(
      <Slot type={getPolymorphicButtonType(true, opaqueAnchorChild, "button")}>
        {opaqueAnchorChild}
      </Slot>,
    );
    const opaqueButton = renderToString(
      <Slot type={getPolymorphicButtonType(true, opaqueButtonChild)}>
        {opaqueButtonChild}
      </Slot>,
    );
    const ownedOpaqueButton = renderToString(
      <Slot type={getPolymorphicButtonType(true, ownedOpaqueButtonChild)}>
        {ownedOpaqueButtonChild}
      </Slot>,
    );

    assertStringIncludes(nativeButton, 'type="button"');
    assert(!/<a\b[^>]*\btype=/.test(opaqueAnchor));
    assert(!/<button\b[^>]*\btype=/.test(opaqueButton));
    assertStringIncludes(ownedOpaqueButton, 'type="button"');
  });

  it("preserves React 19 callback-ref cleanup for both composed refs", async () => {
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
      await unmountReactRoot(root);
      assertEquals(cleaned, ["child", "outer"]);
      restore();
    }
  });

  it("does not run slot behavior after a child handler cancels the event", async () => {
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
      await unmountReactRoot(root);
      restore();
    }
  });

  it("applies native disabled to slottable elements and strips it elsewhere", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/start" },
    );
    const restore = installDom(dom);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);

    try {
      flushSync(() => {
        root.render(
          <>
            <Slot disabled>
              <button type="button">Native</button>
            </Slot>
            <Slot disabled>
              <input readOnly />
            </Slot>
            <Slot disabled>
              <a href="/target">Link</a>
            </Slot>
          </>,
        );
      });

      const button = document.querySelector("button");
      const input = document.querySelector("input");
      const link = document.querySelector("a");
      assert(button);
      assert(input);
      assert(link);
      assertEquals(
        button.disabled,
        true,
        "a slotted native button gets the real disabled attribute",
      );
      assertEquals(button.getAttribute("aria-disabled"), "true");
      assertEquals(input.disabled, true, "every natively disableable element is disabled");
      assertEquals(
        link.hasAttribute("disabled"),
        false,
        "a non-native child never receives the disabled attribute",
      );
      assertEquals(link.getAttribute("aria-disabled"), "true");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("blocks disabled activation, handlers, and propagation", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { pretendToBeVisual: true, url: "https://example.com/start" },
    );
    const restore = installDom(dom);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);
    const calls: string[] = [];

    try {
      flushSync(() => {
        root.render(
          <div
            onClick={() => calls.push("ancestor-click")}
            onAuxClick={() => calls.push("ancestor-aux")}
            onKeyUp={() => calls.push("ancestor-keyup")}
          >
            <Slot
              disabled
              onClickCapture={() => calls.push("slot-capture")}
              onClick={() => calls.push("slot")}
              onAuxClickCapture={() => calls.push("slot-aux-capture")}
              onAuxClick={() => calls.push("slot-aux")}
              onKeyUpCapture={() => calls.push("slot-keyup-capture")}
              onKeyUp={() => calls.push("slot-keyup")}
            >
              <a
                href="/target"
                tabIndex={0}
                onClickCapture={() => calls.push("child-capture")}
                onClick={() => calls.push("child")}
                onAuxClickCapture={() => calls.push("child-aux-capture")}
                onAuxClick={() => calls.push("child-aux")}
                onKeyUpCapture={() => calls.push("child-keyup-capture")}
                onKeyUp={() => calls.push("child-keyup")}
              >
                Disabled link
              </a>
            </Slot>
          </div>,
        );
      });
      const link = document.querySelector("a");
      assert(link);
      assertEquals(link.getAttribute("aria-disabled"), "true");
      assertEquals(link.tabIndex, -1);

      const click = new dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(click);
      assertEquals(click.defaultPrevented, true);
      assertEquals(calls, []);
      assertEquals(dom.window.location.pathname, "/start");

      const auxClick = new dom.window.MouseEvent("auxclick", {
        bubbles: true,
        button: 1,
        cancelable: true,
      });
      link.dispatchEvent(auxClick);
      assertEquals(auxClick.defaultPrevented, true);
      assertEquals(calls, []);
      assertEquals(link.getAttribute("href"), null);

      const enter = new dom.window.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      });
      link.dispatchEvent(enter);
      assertEquals(enter.defaultPrevented, true);
      assertEquals(calls, []);

      for (const key of ["Enter", " "]) {
        const keyUp = new dom.window.KeyboardEvent("keyup", {
          bubbles: true,
          cancelable: true,
          key,
        });
        link.dispatchEvent(keyUp);
        assertEquals(keyUp.defaultPrevented, true);
        assertEquals(calls, []);
      }
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });
});
