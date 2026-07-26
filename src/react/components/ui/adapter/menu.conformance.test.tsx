/**
 * DropdownMenu adapter conformance + characterization. Pins the pre-adapter
 * behaviour of `dropdown-menu.tsx` now that its mechanics resolve through
 * `useAdapter()` (defaulting to `builtinMenu`): trigger toggles a `role="menu"`
 * surface inside the token scope, `aria-haspopup="menu"`, and selecting an item
 * fires `onSelect` and closes the menu. Re-run through `UIAdapterProvider`.
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu.tsx";
import { UIAdapterProvider } from "./context.tsx";
import { builtinMenu } from "./builtin/menu.tsx";

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

function runMenuConformance(
  label: string,
  Wrap: React.FC<{ children: React.ReactNode }>,
): void {
  describe(`DropdownMenu adapter conformance — ${label}`, () => {
    it("trigger toggles a role=menu surface inside the token scope, aria-haspopup=menu", () => {
      const { scope, click, cleanup } = mount(
        <Wrap>
          <DropdownMenu>
            <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
            <DropdownMenuContent className="vf-test-menu">
              <DropdownMenuItem>One</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Wrap>,
      );
      try {
        const trigger = scope.querySelector("button")!;
        assertEquals(trigger.getAttribute("aria-haspopup"), "menu");
        assertEquals(scope.querySelector('[role="menu"]'), null, "closed initially");
        click(trigger);
        const surface = scope.querySelector('[role="menu"]') as HTMLElement;
        assert(surface, "trigger opens the menu");
        assertEquals(
          surface.closest("[data-vf-ui],[data-vf-chat]"),
          scope,
          "menu surface stays within the token scope",
        );
        assert(surface.className.includes("vf-test-menu"), "consumer class merged");
      } finally {
        cleanup();
      }
    });

    it("selecting an item fires onSelect and closes the menu", () => {
      let selected = 0;
      const { scope, click, cleanup } = mount(
        <Wrap>
          <DropdownMenu>
            <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => selected++}>One</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Wrap>,
      );
      try {
        click(scope.querySelector("button")!);
        const item = scope.querySelector('[role="menuitem"]') as HTMLElement;
        assert(item, "item renders while open");
        click(item);
        assertEquals(selected, 1, "onSelect fired");
        assertEquals(scope.querySelector('[role="menu"]'), null, "menu closed on select");
      } finally {
        cleanup();
      }
    });

    it("asChild item merges menuitem role onto the consumer element", () => {
      const { scope, click, cleanup } = mount(
        <Wrap>
          <DropdownMenu>
            <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild>
                <a href="#go" data-testid="link">Go</a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Wrap>,
      );
      try {
        click(scope.querySelector("button")!);
        const link = scope.querySelector('[data-testid="link"]') as HTMLElement;
        assert(link, "asChild renders the consumer element");
        assertEquals(link.tagName.toLowerCase(), "a");
        assertEquals(link.getAttribute("role"), "menuitem");
      } finally {
        cleanup();
      }
    });
  });
}

function BuiltinWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
function ProviderWrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <UIAdapterProvider adapter={{ menu: builtinMenu }}>{children}</UIAdapterProvider>;
}

runMenuConformance("builtin", BuiltinWrap);
runMenuConformance("builtin via UIAdapterProvider (swap path)", ProviderWrap);
