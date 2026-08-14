/**
 * NavigationMenu behaviour. Pins the observable contract: the root is a `<nav>`
 * landmark, its item triggers start collapsed (`aria-expanded="false"`), and
 * clicking a trigger opens its item's panel (`aria-expanded="true"`, the
 * panel + its links now present) - only one panel open at a time. The panel is
 * a plain disclosure region, NOT `role="menu"`, so tests match it by data-slot.
 *
 * NOTE: synthetic keyboard/focus events do NOT reach React handlers in this
 * deno+jsdom harness, so panels are opened via a real click `MouseEvent`
 * (`bubbles: true`) - the same path a user's pointer takes.
 *
 * @module react/components/ui/navigation-menu.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu.tsx";

// ---------------------------------------------------------------------------
// jsdom harness - installs a fresh DOM per render and stubs the browser APIs
// jsdom lacks (ResizeObserver, rAF, matchMedia) so effect-driven components mount.
// ---------------------------------------------------------------------------
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function installDom(dom: JSDOM): () => void {
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = [
    "document",
    "window",
    "navigator",
    "HTMLElement",
    "Node",
    "Element",
    "MouseEvent",
    "getComputedStyle",
    "ResizeObserver",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  const prev: Record<string, unknown> = {};
  for (const k of keys) prev[k] = g[k];

  g.document = w.document;
  g.window = w;
  g.navigator = w.navigator;
  g.HTMLElement = w.HTMLElement;
  g.Node = w.Node;
  g.Element = w.Element;
  g.MouseEvent = w.MouseEvent;
  g.getComputedStyle = (w.getComputedStyle as (e: Element) => CSSStyleDeclaration).bind(w);
  g.ResizeObserver = ResizeObserverStub;
  g.matchMedia = () => ({
    matches: false,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  });
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0);
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);

  return () => {
    for (const k of keys) g[k] = prev[k];
    dom.window.close();
  };
}

/** Render `element` into a fresh DOM; returns the host node, a click helper and a teardown. */
function render(element: React.ReactElement): {
  host: HTMLElement;
  click: (el: Element) => void;
  pointerEnter: (el: Element) => Promise<void>;
  pointerLeave: (el: Element) => Promise<void>;
  unmount: () => void;
} {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  const win = dom.window;
  return {
    host: host as unknown as HTMLElement,
    click: (el: Element) =>
      flushSync(() => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }))),
    pointerEnter: async (el: Element) => {
      el.dispatchEvent(new win.MouseEvent("pointerover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    pointerLeave: async (el: Element) => {
      el.dispatchEvent(new win.MouseEvent("pointerout", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
    unmount: () => {
      try {
        root.unmount();
      } finally {
        restore();
      }
    },
  };
}

function Fixture(): React.ReactElement {
  return (
    <NavigationMenu label="Main">
      <NavigationMenuList>
        <NavigationMenuItem value="products">
          <NavigationMenuTrigger>Products</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavigationMenuLink href="/analytics" className="vf-test-analytics">
              Analytics
            </NavigationMenuLink>
            <NavigationMenuLink href="/automation">Automation</NavigationMenuLink>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem value="resources">
          <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
          <NavigationMenuContent>
            <NavigationMenuLink href="/guides" className="vf-test-guides">
              Guides
            </NavigationMenuLink>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem value="docs">
          <NavigationMenuLink href="/docs">Docs</NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function triggers(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("nav ul li button"));
}

describe("NavigationMenu behaviour", () => {
  it("renders a nav landmark with its list, items and collapsed triggers", () => {
    const { host, unmount } = render(<Fixture />);
    try {
      const nav = host.querySelector('nav[aria-label="Main"]') as HTMLElement;
      assert(nav, "root renders a nav landmark");
      assertEquals(host.querySelectorAll("nav ul").length, 1, "renders one list");
      assertEquals(host.querySelectorAll("nav ul > li").length, 3, "renders all three items");

      const [products, resources] = triggers(host);
      assertEquals(products!.textContent?.includes("Products"), true, "first trigger labelled");
      assertEquals(resources!.textContent?.includes("Resources"), true, "second trigger labelled");
      // Triggers start collapsed; no panel is open.
      for (const trigger of triggers(host)) {
        assertEquals(trigger.getAttribute("aria-expanded"), "false", "triggers start collapsed");
      }
      assertEquals(
        host.querySelector('[data-slot="navigation-menu-content"]'),
        null,
        "no panel open initially",
      );
    } finally {
      unmount();
    }
  });

  it("clicking a trigger opens its panel - aria-expanded flips true and its links render", () => {
    const { host, click, unmount } = render(<Fixture />);
    try {
      const products = triggers(host)[0]!;
      assertEquals(products.getAttribute("aria-expanded"), "false");
      click(products);

      assertEquals(products.getAttribute("aria-expanded"), "true", "trigger now expanded");
      const panel = host.querySelector('[data-slot="navigation-menu-content"]') as HTMLElement;
      assert(panel, "clicking the trigger opens its panel");
      assertEquals(
        products.getAttribute("aria-controls"),
        panel.getAttribute("id"),
        "trigger points at the opened panel",
      );
      assert(panel.querySelector(".vf-test-analytics"), "the Products panel's link rendered");
      // Only the Products panel opened, not Resources.
      assertEquals(host.querySelector(".vf-test-guides"), null, "the Resources panel stays closed");
      assertEquals(
        host.querySelectorAll('[data-slot="navigation-menu-content"]').length,
        1,
        "exactly one panel open",
      );
    } finally {
      unmount();
    }
  });

  it("keeps two items with the SAME value independent", () => {
    const Duplicated = (): React.ReactElement => (
      <NavigationMenu label="Main">
        <NavigationMenuList>
          <NavigationMenuItem value="same">
            <NavigationMenuTrigger>First</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink href="/one" className="vf-test-one">One</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="same">
            <NavigationMenuTrigger>Second</NavigationMenuTrigger>
            <NavigationMenuContent>
              <NavigationMenuLink href="/two" className="vf-test-two">Two</NavigationMenuLink>
            </NavigationMenuContent>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    );
    const { host, click, unmount } = render(<Duplicated />);
    try {
      click(triggers(host)[0]!);
      assertEquals(
        host.querySelectorAll('[data-slot="navigation-menu-content"]').length,
        1,
        "a duplicated value must not open both panels at once",
      );
      assert(host.querySelector(".vf-test-one"), "the clicked item's own panel opened");
      assertEquals(host.querySelector(".vf-test-two"), null, "the other panel stayed closed");
      const firstPanelId = triggers(host)[0]!.getAttribute("aria-controls");
      assert(firstPanelId, "the first open trigger references its panel");

      click(triggers(host)[1]!);
      const secondPanelId = triggers(host)[1]!.getAttribute("aria-controls");
      assert(secondPanelId, "the second open trigger references its panel");
      assert(firstPanelId !== secondPanelId, "duplicate values still receive distinct panel ids");
    } finally {
      unmount();
    }
  });

  it("drops aria-controls while the panel is unmounted", () => {
    const { host, click, unmount } = render(<Fixture />);
    try {
      const products = triggers(host)[0]!;
      assertEquals(
        products.getAttribute("aria-controls"),
        null,
        "a closed trigger must not reference a panel that does not exist",
      );
      click(products);
      assert(products.getAttribute("aria-controls"), "an open trigger references its panel");
    } finally {
      unmount();
    }
  });

  it("does not declare application menu roles it has no keyboard model for", () => {
    const { host, click, unmount } = render(<Fixture />);
    try {
      click(triggers(host)[0]!);
      assertEquals(host.querySelector('[role="menu"]'), null, "no role=menu");
      assertEquals(host.querySelector('[role="menuitem"]'), null, "no role=menuitem");
    } finally {
      unmount();
    }
  });

  it("keeps a hover-open panel active while the pointer crosses from trigger to content", async () => {
    const { host, pointerEnter, pointerLeave, unmount } = render(<Fixture />);
    try {
      const products = triggers(host)[0]!;
      await pointerEnter(products);
      const panel = host.querySelector<HTMLElement>('[data-slot="navigation-menu-content"]');
      assert(panel, "pointer enter opens the panel");

      await pointerLeave(products);
      assert(
        host.querySelector('[data-slot="navigation-menu-content"]'),
        "leaving the trigger does not close the panel immediately",
      );
      await pointerEnter(panel);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert(
        host.querySelector('[data-slot="navigation-menu-content"]'),
        "entering the panel cancels the pending close",
      );

      await pointerLeave(panel);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert(
        host.querySelector('[data-slot="navigation-menu-content"]') == null,
        "the panel closes after the pointer leaves the coordinated region",
      );
    } finally {
      unmount();
    }
  });
});
