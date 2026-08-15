import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useMenuContentKeyboard } from "./menu-keyboard.ts";

function installDom(dom: JSDOM): () => void {
  const window = dom.window;
  const replacements: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
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

function reactProps(element: HTMLElement): {
  onKeyDown?: (event: {
    altKey: boolean;
    ctrlKey: boolean;
    currentTarget: HTMLElement;
    defaultPrevented: boolean;
    key: string;
    metaKey: boolean;
    nativeEvent: { isComposing: boolean; keyCode: number };
    preventDefault: () => void;
    shiftKey: boolean;
  }) => void;
} {
  const reactPropsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert(reactPropsKey, "React props are attached to the rendered element");
  const props = (element as unknown as Record<string, ReturnType<typeof reactProps>>)[
    reactPropsKey
  ];
  assert(props, "React props are readable from the rendered element");
  return props;
}

function keydown(target: HTMLElement, key: string, shiftKey = false): void {
  const handler = reactProps(target).onKeyDown;
  assert(handler, "React keydown handler is attached");
  const event = {
    altKey: false,
    ctrlKey: false,
    currentTarget: target,
    defaultPrevented: false,
    key,
    metaKey: false,
    nativeEvent: { isComposing: false, keyCode: 0 },
    preventDefault() {
      this.defaultPrevented = true;
    },
    shiftKey,
  };
  flushSync(() => handler(event));
}

function Harness(): React.ReactElement {
  const [open, setOpen] = React.useState(true);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const handleKeyDown = useMenuContentKeyboard({ setOpen, triggerRef });
  return (
    <div>
      <button id="trigger" ref={triggerRef} type="button">Open</button>
      {open
        ? (
          <div role="menu" onKeyDown={handleKeyDown}>
            <button role="menuitem" aria-disabled="true" type="button">Disabled</button>
            <button id="cut" role="menuitem" type="button">Cut</button>
            <button id="copy" role="menuitem" type="button">Copy</button>
            <button id="paste" role="menuitem" type="button">Paste</button>
          </div>
        )
        : null}
      <button id="after" type="button">After</button>
    </div>
  );
}

describe("menu keyboard behaviour", () => {
  it("moves through enabled items with arrows, Home/End, typeahead, and Tab", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/", pretendToBeVisual: true },
    );
    const restore = installDom(dom);
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Harness />));
      const menu = document.querySelector<HTMLElement>('[role="menu"]');
      const cut = document.getElementById("cut");
      const copy = document.getElementById("copy");
      const paste = document.getElementById("paste");
      const after = document.getElementById("after");
      assert(menu && cut && copy && paste && after);

      cut.focus();
      keydown(menu, "ArrowDown");
      assertEquals(document.activeElement, copy);
      keydown(menu, "Home");
      assertEquals(document.activeElement, cut);
      keydown(menu, "End");
      assertEquals(document.activeElement, paste);
      keydown(menu, "c");
      assertEquals(document.activeElement, cut);
      keydown(menu, "o");
      assertEquals(document.activeElement, copy);
      keydown(menu, "Tab");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(document.querySelector('[role="menu"]'), null);
      assertEquals(document.activeElement, after);
    } finally {
      flushSync(() => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 0));
      restore();
    }
  });
});
