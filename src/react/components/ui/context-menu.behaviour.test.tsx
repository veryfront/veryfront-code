/**
 * ContextMenu behaviour — characterizes the right-click open path and the
 * shared dismiss machinery.
 *
 * Harness mirrors `adapter/popover.conformance.test.tsx`: JSDOM + `createRoot` +
 * `flushSync`, mounting inside a `[data-vf-ui]` token scope. Synthetic DOM
 * keyboard/focus events do NOT reach React's synthetic handlers in this
 * deno+jsdom harness, but `MouseEvent` does — so the menu is opened by
 * dispatching a native `contextmenu` MouseEvent on the trigger. `Escape` and
 * outside-click dismissal are driven through the NATIVE `document` listeners
 * `Floating` registers (not React's synthetic system), so those reach it.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu.tsx";

function installDomGlobals(dom: JSDOM): () => void {
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "MouseEvent",
    "KeyboardEvent",
    "getComputedStyle",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const k of keys) previous[k] = (globalThis as Record<string, unknown>)[k];

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
  });

  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

/** Mount `element` inside a `[data-vf-ui]` token scope; return the scope + helpers. */
function mountInScope(element: React.ReactElement): {
  scope: HTMLElement;
  root: Root;
  win: Window & typeof globalThis;
  rightClickTrigger: (x?: number, y?: number) => void;
  cleanup: () => void;
} {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div></body></html>`,
    { url: "https://example.com/", pretendToBeVisual: true },
  );
  const restore = installDomGlobals(dom);
  const host = document.getElementById("root")!;
  const scope = document.createElement("div");
  scope.setAttribute("data-vf-ui", "");
  host.appendChild(scope);
  const root = createRoot(scope);
  flushSync(() => root.render(element));

  const rightClickTrigger = (x = 24, y = 24) => {
    const trigger = scope.querySelector<HTMLElement>('[data-testid="trigger"]');
    if (!trigger) throw new Error("no trigger found to right-click");
    flushSync(() => {
      trigger.dispatchEvent(
        new dom.window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }),
      );
    });
  };

  return {
    scope,
    root,
    win: dom.window as unknown as Window & typeof globalThis,
    rightClickTrigger,
    cleanup: () => {
      root.unmount();
      restore();
    },
  };
}

function Menu(
  { onSelect }: { onSelect?: () => void } = {},
): React.ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger data-testid="trigger">Right-click here</ContextMenuTrigger>
      <ContextMenuContent data-testid="content">
        <ContextMenuGroup>
          <ContextMenuLabel>Actions</ContextMenuLabel>
          <ContextMenuItem data-testid="cut" onSelect={onSelect}>Cut</ContextMenuItem>
          <ContextMenuItem>Copy</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem disabled data-testid="paste">Paste</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe("ContextMenu behaviour (builtin)", () => {
  it("is closed until a right-click; contextmenu opens it, portalled into the token scope", () => {
    const { scope, rightClickTrigger, cleanup } = mountInScope(<Menu />);
    try {
      assertEquals(scope.querySelector('[role="menu"]'), null, "closed initially");
      rightClickTrigger();
      const content = scope.querySelector('[role="menu"]');
      assert(content, "content with role=menu renders after right-click");
      assertEquals(
        content!.closest("[data-vf-ui],[data-vf-chat]"),
        scope,
        "portalled surface stays within the token scope, not document.body",
      );
    } finally {
      cleanup();
    }
  });

  it("renders items as role=menuitem with their labels", () => {
    const { scope, rightClickTrigger, cleanup } = mountInScope(<Menu />);
    try {
      rightClickTrigger();
      const items = [...scope.querySelectorAll('[role="menuitem"]')];
      assertEquals(items.length, 3, "all three items render");
      assertEquals(items[0]?.textContent, "Cut");
      const paste = scope.querySelector('[data-testid="paste"]') as HTMLElement;
      assertEquals(paste.getAttribute("aria-disabled"), "true", "disabled item marked");
    } finally {
      cleanup();
    }
  });

  it("suppresses the native menu (preventDefault) on the contextmenu event", () => {
    const { scope, cleanup } = mountInScope(<Menu />);
    try {
      const trigger = scope.querySelector<HTMLElement>('[data-testid="trigger"]')!;
      const evt = new globalThis.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      });
      flushSync(() => trigger.dispatchEvent(evt));
      assert(evt.defaultPrevented, "native context menu is prevented");
    } finally {
      cleanup();
    }
  });

  it("selecting an item fires onSelect and closes the menu", () => {
    let selected = 0;
    const { scope, rightClickTrigger, cleanup } = mountInScope(
      <Menu onSelect={() => selected++} />,
    );
    try {
      rightClickTrigger();
      const item = scope.querySelector<HTMLElement>('[data-testid="cut"]')!;
      flushSync(() => {
        item.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true }));
      });
      assertEquals(selected, 1, "onSelect fired once");
      assertEquals(scope.querySelector('[role="menu"]'), null, "menu closed on select");
    } finally {
      cleanup();
    }
  });

  it("closes on Escape (native document keydown listener)", () => {
    const { scope, rightClickTrigger, cleanup } = mountInScope(<Menu />);
    try {
      rightClickTrigger();
      assert(scope.querySelector('[role="menu"]'), "open after right-click");
      flushSync(() => {
        document.dispatchEvent(
          new globalThis.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      assertEquals(scope.querySelector('[role="menu"]'), null, "Escape dismissed the menu");
    } finally {
      cleanup();
    }
  });

  it("closes on outside mousedown (native document pointer listener)", () => {
    const { scope, rightClickTrigger, cleanup } = mountInScope(<Menu />);
    try {
      rightClickTrigger();
      assert(scope.querySelector('[role="menu"]'), "open after right-click");
      flushSync(() => {
        document.body.dispatchEvent(
          new globalThis.MouseEvent("mousedown", { bubbles: true }),
        );
      });
      assertEquals(scope.querySelector('[role="menu"]'), null, "outside click dismissed the menu");
    } finally {
      cleanup();
    }
  });
});
