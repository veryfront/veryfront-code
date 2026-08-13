/**
 * Menubar behaviour. Pins the observable contract: the root is a horizontal
 * `role="menubar"`, each trigger is a `role="menuitem"` with
 * `aria-haspopup="menu"`, clicking a trigger opens its dropdown into the
 * `[data-vf-ui]` token scope, opening a second menu closes the first, and
 * selecting an item closes the menu.
 *
 * NOTE: synthetic keyboard/focus events do NOT reach React handlers in this
 * deno+jsdom harness, so menus are opened via a real click `MouseEvent`
 * (`bubbles: true`) - the same path a user's pointer takes.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "./menubar.tsx";

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

function mount(element: React.ReactElement): {
  scope: HTMLElement;
  root: Root;
  click: (el: Element) => void;
  cleanup: () => void;
} {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div></body></html>`,
    { url: "https://example.com/", pretendToBeVisual: true },
  );
  const restore = installDomGlobals(dom);
  const scope = document.createElement("div");
  scope.setAttribute("data-vf-ui", "");
  document.getElementById("root")!.appendChild(scope);
  const root = createRoot(scope);
  flushSync(() => root.render(element));
  const win = dom.window;
  return {
    scope,
    root,
    click: (el: Element) =>
      flushSync(() => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }))),
    cleanup: () => {
      root.unmount();
      restore();
    },
  };
}

function Fixture(): React.ReactElement {
  return (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent className="vf-test-file">
          <MenubarItem className="vf-test-new">New</MenubarItem>
          <MenubarSeparator />
          <MenubarItem>Open</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent className="vf-test-edit">
          <MenubarItem>Undo</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

function triggers(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-vf-menubar-trigger]"));
}

function triggerAt(scope: HTMLElement, i: number): HTMLElement {
  const trigger = triggers(scope)[i];
  if (!trigger) throw new Error(`no menubar trigger at index ${i}`);
  return trigger;
}

describe("Menubar behaviour", () => {
  it("renders a horizontal role=menubar whose triggers are menuitems with aria-haspopup=menu", () => {
    const { scope, cleanup } = mount(<Fixture />);
    try {
      const bar = scope.querySelector('[role="menubar"]') as HTMLElement;
      assert(bar, "root renders role=menubar");
      assertEquals(bar.getAttribute("aria-orientation"), "horizontal");
      const file = triggerAt(scope, 0);
      const edit = triggerAt(scope, 1);
      assertEquals(file.getAttribute("role"), "menuitem");
      assertEquals(file.getAttribute("aria-haspopup"), "menu");
      assertEquals(file.textContent, "File");
      assertEquals(edit.textContent, "Edit");
    } finally {
      cleanup();
    }
  });

  it("clicking a trigger opens its menu into the token scope; items render as menuitems", () => {
    const { scope, click, cleanup } = mount(<Fixture />);
    try {
      assertEquals(scope.querySelector('[role="menu"]'), null, "closed initially");
      const file = triggerAt(scope, 0);
      assertEquals(file.getAttribute("data-state"), "closed");
      click(file);

      const surface = scope.querySelector('[role="menu"]') as HTMLElement;
      assert(surface, "clicking File opens its menu");
      assert(surface.className.includes("vf-test-file"), "the File menu opened (not Edit)");
      // MANDATORY: the portalled surface stays inside the [data-vf-ui] scope.
      assertEquals(
        surface.closest("[data-vf-ui],[data-vf-chat]"),
        scope,
        "menu surface stays within the token scope, not document.body",
      );
      const items = surface.querySelectorAll('[role="menuitem"]');
      assertEquals(items.length, 2, "both menu items render");
      assert(surface.querySelector(".vf-test-new"), "the New item rendered into the surface");
      assertEquals(triggerAt(scope, 0).getAttribute("data-state"), "open");
    } finally {
      cleanup();
    }
  });

  it("opening a second menu closes the first (one menu open at a time)", () => {
    const { scope, click, cleanup } = mount(<Fixture />);
    try {
      const file = triggerAt(scope, 0);
      const edit = triggerAt(scope, 1);
      click(file);
      assert(scope.querySelector(".vf-test-file"), "File menu open");
      click(edit);
      const open = scope.querySelectorAll('[role="menu"]');
      assertEquals(open.length, 1, "exactly one menu open");
      assert(scope.querySelector(".vf-test-edit"), "Edit menu is the open one");
      assertEquals(scope.querySelector(".vf-test-file"), null, "File menu closed");
    } finally {
      cleanup();
    }
  });

  it("selecting an item fires onSelect and closes the menu", () => {
    let selected = 0;
    const { scope, click, cleanup } = mount(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => selected++}>New</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    try {
      click(triggerAt(scope, 0));
      const item = scope.querySelector('[role="menu"] [role="menuitem"]') as HTMLElement;
      assert(item, "item renders while open");
      click(item);
      assertEquals(selected, 1, "onSelect fired");
      assertEquals(scope.querySelector('[role="menu"]'), null, "menu closed on select");
    } finally {
      cleanup();
    }
  });
});
