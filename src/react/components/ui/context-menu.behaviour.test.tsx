/**
 * ContextMenu behaviour - characterizes the right-click open path and the
 * shared dismiss machinery.
 *
 * Harness mirrors `adapter/popover.conformance.test.tsx`: JSDOM + `createRoot` +
 * `flushSync`, mounting inside a `[data-vf-ui]` token scope. Synthetic DOM
 * keyboard/focus events do NOT reach React's synthetic handlers in this
 * deno+jsdom harness, but `MouseEvent` does - so the menu is opened by
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

  it("makes the default trigger focusable and opens from Shift+F10", () => {
    const { scope, cleanup } = mountInScope(<Menu />);
    try {
      const trigger = scope.querySelector<HTMLElement>('[data-testid="trigger"]')!;
      assertEquals(trigger.getAttribute("role"), "button");
      assertEquals(trigger.tabIndex, 0);
      trigger.focus();
      assertEquals(document.activeElement, trigger, "default trigger is reachable by focus");
      flushSync(() => {
        trigger.dispatchEvent(
          new globalThis.KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "F10",
            shiftKey: true,
          }),
        );
      });
      assert(scope.querySelector('[role="menu"]'), "Shift+F10 opens the menu");
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
      assertEquals((paste as HTMLButtonElement).disabled, true, "native item is disabled");
      flushSync(() => {
        paste.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true }));
      });
      assert(
        scope.querySelector('[role="menu"]'),
        "disabled native activation keeps the menu open",
      );
    } finally {
      cleanup();
    }
  });

  it("suppresses disabled asChild activation at the composed-control boundary", () => {
    let childClicks = 0;
    let selections = 0;
    const { scope, rightClickTrigger, cleanup } = mountInScope(
      <ContextMenu>
        <ContextMenuTrigger data-testid="trigger">Right-click here</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled asChild onSelect={() => selections++}>
            <a href="/danger" onClick={() => childClicks++}>Danger</a>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    try {
      rightClickTrigger();
      const item = scope.querySelector<HTMLAnchorElement>('[role="menuitem"]');
      assert(item);
      assertEquals(item.getAttribute("href"), null, "disabled Slot removes navigation");
      assertEquals(item.tabIndex, -1, "disabled Slot leaves the item out of focus order");
      const event = new globalThis.MouseEvent("click", { bubbles: true, cancelable: true });
      flushSync(() => item.dispatchEvent(event));
      assert(event.defaultPrevented, "disabled Slot prevents default activation");
      assertEquals(childClicks, 0, "the child click handler does not run");
      assertEquals(selections, 0, "the item selection handler does not run");
      assert(scope.querySelector('[role="menu"]'), "the menu stays open");
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

  it("keyboard selection closes the menu and restores focus to the trigger", async () => {
    let selected = 0;
    const { scope, rightClickTrigger, cleanup } = mountInScope(
      <Menu onSelect={() => selected++} />,
    );
    try {
      const trigger = scope.querySelector<HTMLElement>('[data-testid="trigger"]')!;
      rightClickTrigger();
      const item = scope.querySelector<HTMLElement>('[data-testid="cut"]')!;
      item.focus();
      assertEquals(document.activeElement, item, "the menu item starts focused");

      flushSync(() => {
        item.dispatchEvent(
          new globalThis.KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          }),
        );
      });
      await Promise.resolve();

      assertEquals(selected, 1, "keyboard activation selects the item once");
      assertEquals(scope.querySelector('[role="menu"]'), null, "menu closed on keyboard select");
      assertEquals(document.activeElement, trigger, "focus returns to the context menu trigger");
    } finally {
      cleanup();
    }
  });

  it("honors a consumer-cancelled click before selecting or closing", () => {
    let clicks = 0;
    let selections = 0;
    const { scope, rightClickTrigger, cleanup } = mountInScope(
      <ContextMenu>
        <ContextMenuTrigger data-testid="trigger">Right-click here</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            data-testid="cancelled"
            onClick={(event) => {
              clicks++;
              event.preventDefault();
            }}
            onSelect={() => selections++}
          >
            Cancelled
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    try {
      rightClickTrigger();
      const item = scope.querySelector<HTMLElement>('[data-testid="cancelled"]')!;
      const event = new globalThis.MouseEvent("click", { bubbles: true, cancelable: true });
      flushSync(() => item.dispatchEvent(event));
      assert(event.defaultPrevented, "consumer cancels the click");
      assertEquals(clicks, 1, "consumer onClick fires once");
      assertEquals(selections, 0, "onSelect does not run after cancellation");
      assert(scope.querySelector('[role="menu"]'), "cancelled click keeps the menu open");
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
