import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";

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
    FocusEvent: window.FocusEvent,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
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

function createDom(): JSDOM {
  return new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { pretendToBeVisual: true, url: "https://example.com/" },
  );
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function keydown(
  window: JSDOM["window"],
  target: EventTarget,
  key: string,
  shiftKey = false,
): KeyboardEvent {
  const event = new window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    shiftKey,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * Unmount and drain the scheduler task React leaves behind.
 *
 * React's scheduler holds a `setImmediate` until it next runs. It completes on
 * its own, but the test has to yield once more or Deno's leak sanitizer sees
 * the timer still pending.
 */
async function unmount(root: Root): Promise<void> {
  flushSync(() => root.unmount());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("modal surfaces", () => {
  it("wires ARIA, traps focus, restores focus, and balances scroll locking", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);

    try {
      flushSync(() => {
        root.render(
          <div data-vf-ui="">
            <Dialog defaultOpen>
              <DialogTrigger
                id="dialog-trigger"
                aria-controls="consumer-must-not-break-wiring"
                aria-expanded={false}
              >
                Open
              </DialogTrigger>
              <DialogContent
                id="dialog-content"
                role="alert"
                aria-modal={false}
                tabIndex={0}
              >
                <DialogTitle id="dialog-title">Confirm action</DialogTitle>
                <DialogDescription id="dialog-description">
                  This cannot be undone.
                </DialogDescription>
                <button id="first-action" type="button">First</button>
                <DialogClose id="last-action">Close</DialogClose>
              </DialogContent>
            </Dialog>
            <button id="outside" type="button">Outside</button>
          </div>,
        );
      });
      await waitFor(
        () => document.querySelector('[role="dialog"]') !== null,
        "dialog did not portal",
      );
      const trigger = document.getElementById("dialog-trigger");
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const first = document.getElementById("first-action");
      const last = document.getElementById("last-action");
      const outside = document.getElementById("outside");
      assert(trigger && dialog && first && last && outside);

      assertEquals(trigger.getAttribute("aria-controls"), dialog.id);
      assertEquals(trigger.getAttribute("aria-expanded"), "true");
      assertEquals(dialog.getAttribute("aria-modal"), "true");
      assertEquals(dialog.tabIndex, -1);
      const titleId = dialog.getAttribute("aria-labelledby");
      const descriptionId = dialog.getAttribute("aria-describedby");
      assert(titleId && descriptionId);
      assertEquals(document.getElementById(titleId)?.textContent, "Confirm action");
      assertEquals(
        document.getElementById(descriptionId)?.textContent,
        "This cannot be undone.",
      );
      await waitFor(
        () => document.activeElement === first,
        "dialog did not focus its first action",
      );
      assertEquals(document.body.style.overflow, "hidden");

      last.focus();
      const forwardTab = keydown(dom.window, last, "Tab");
      assertEquals(forwardTab.defaultPrevented, true);
      assertEquals(document.activeElement, first);
      const backwardTab = keydown(dom.window, first, "Tab", true);
      assertEquals(backwardTab.defaultPrevented, true);
      assertEquals(document.activeElement, last);

      outside.focus();
      assertEquals(document.activeElement, first);

      keydown(dom.window, first, "Escape");
      await waitFor(
        () => document.querySelector('[role="dialog"]') === null,
        "dialog did not close on Escape",
      );
      assertEquals(document.activeElement, trigger);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(document.body.style.overflow, "");
    } finally {
      await unmount(root);
      restore();
    }
  });

  it("honors a consumer-cancelled trigger click", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);

    try {
      flushSync(() => {
        root.render(
          <Dialog>
            <DialogTrigger onClick={(event) => event.preventDefault()}>
              Do not open
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Hidden</DialogTitle>
            </DialogContent>
          </Dialog>,
        );
      });
      const trigger = document.querySelector("button");
      assert(trigger);
      flushSync(() => trigger.click());
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(document.querySelector('[role="dialog"]'), null);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
    } finally {
      await unmount(root);
      restore();
    }
  });
});

describe("dropdown menu keyboard contract", () => {
  it("focuses enabled items and supports navigation, typeahead, Escape, and Tab", async () => {
    const dom = createDom();
    const restore = installDom(dom);
    const rootElement = document.getElementById("root");
    assert(rootElement);
    const root = createRoot(rootElement);

    try {
      flushSync(() => {
        root.render(
          <div data-vf-ui="">
            <button id="before" type="button">Before</button>
            <DropdownMenu defaultOpen>
              <DropdownMenuTrigger
                id="menu-trigger"
                aria-controls="consumer-must-not-break-wiring"
                aria-expanded={false}
              >
                Open menu
              </DropdownMenuTrigger>
              <DropdownMenuContent role="listbox" aria-orientation="horizontal">
                <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
                <DropdownMenuItem id="apple">Apple</DropdownMenuItem>
                <DropdownMenuItem id="banana">Banana</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button id="after" type="button">After</button>
          </div>,
        );
      });
      await waitFor(
        () => document.querySelector('[role="menu"]') !== null,
        "menu did not portal",
      );
      const menu = document.querySelector<HTMLElement>('[role="menu"]');
      const trigger = document.getElementById("menu-trigger");
      const apple = document.getElementById("apple");
      const banana = document.getElementById("banana");
      const after = document.getElementById("after");
      assert(menu && trigger && apple && banana && after);
      assertEquals(trigger.getAttribute("aria-controls"), menu.id);
      assertEquals(trigger.getAttribute("aria-expanded"), "true");
      assertEquals(menu.getAttribute("aria-labelledby"), trigger.id);
      assertEquals(menu.getAttribute("aria-orientation"), "vertical");
      await waitFor(
        () => document.activeElement === apple,
        "menu did not focus its first enabled item",
      );

      keydown(dom.window, apple, "ArrowDown");
      assertEquals(document.activeElement, banana);
      keydown(dom.window, banana, "Home");
      assertEquals(document.activeElement, apple);
      keydown(dom.window, apple, "b");
      assertEquals(document.activeElement, banana);

      keydown(dom.window, banana, "Escape");
      await waitFor(
        () => document.querySelector('[role="menu"]') === null,
        "menu did not close on Escape",
      );
      assertEquals(document.activeElement, trigger);

      flushSync(() => trigger.click());
      await waitFor(
        () => document.querySelector('[role="menu"]') !== null,
        "menu did not reopen",
      );
      const reopenedApple = document.getElementById("apple");
      assert(reopenedApple);
      await waitFor(
        () => document.activeElement === reopenedApple,
        "reopened menu did not focus its first item",
      );
      keydown(dom.window, reopenedApple, "Tab");
      await waitFor(
        () => document.querySelector('[role="menu"]') === null,
        "menu did not close on Tab",
      );
      assertEquals(document.activeElement, after);
    } finally {
      await unmount(root);
      restore();
    }
  });
});

describe("Collapsible ARIA contract", () => {
  it("uses hydration-stable control wiring and keeps closed content represented", () => {
    const html = renderToString(
      <Collapsible>
        <CollapsibleTrigger>Details</CollapsibleTrigger>
        <CollapsibleContent>Hidden details</CollapsibleContent>
      </Collapsible>,
    );
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    try {
      const trigger = dom.window.document.querySelector("button");
      const content = dom.window.document.querySelector("div[hidden]");
      assert(trigger && content);
      assertEquals(trigger.getAttribute("aria-controls"), content.id);
      assertEquals(trigger.getAttribute("aria-expanded"), "false");
      assertEquals(content.getAttribute("data-state"), "closed");
    } finally {
      dom.window.close();
    }
  });

  it("fails closed when an interactive menu item has no menu root", () => {
    assertThrows(
      () => renderToString(<DropdownMenuItem>Orphan</DropdownMenuItem>),
      Error,
      "must be used within <DropdownMenu>",
    );
  });
});
