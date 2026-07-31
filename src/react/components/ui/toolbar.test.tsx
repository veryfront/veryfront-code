/**
 * Toolbar behaviour. Pins the observable contract: the root is a
 * `role="toolbar"` with `aria-orientation`, its items share one tab stop via a
 * roving tabindex (the first enabled item is tabbable, the rest are not), and a
 * `ToolbarButton` forwards `onClick`.
 *
 * NOTE: synthetic keyboard/focus events do NOT reach React handlers in this
 * deno+jsdom harness, so we assert the roving *initial state* (which is set by a
 * layout effect) rather than driving arrow-key navigation; clicks go through a
 * real bubbling `MouseEvent`, the same path a user's pointer takes.
 *
 * @module react/components/ui/toolbar.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { Toolbar, ToolbarButton, ToolbarSeparator } from "./toolbar.tsx";

// ---------------------------------------------------------------------------
// jsdom harness — installs a fresh DOM per render and stubs the browser APIs
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

/** Render `element` into a fresh DOM; returns the host node and a teardown. */
function render(element: React.ReactElement): {
  host: HTMLElement;
  unmount: () => void;
} {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  return {
    host: host as unknown as HTMLElement,
    unmount: () => {
      try {
        root.unmount();
      } finally {
        restore();
      }
    },
  };
}

describe("Toolbar behaviour", () => {
  it("renders role=toolbar with aria-orientation and a roving initial tabindex", () => {
    const { host, unmount } = render(
      <Toolbar aria-label="Format">
        <ToolbarButton>B</ToolbarButton>
        <ToolbarButton>I</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton>U</ToolbarButton>
      </Toolbar>,
    );
    try {
      const bar = host.querySelector('[role="toolbar"]') as HTMLElement;
      assert(bar, "root renders role=toolbar");
      assertEquals(bar.getAttribute("aria-orientation"), "horizontal");

      const items = Array.from(bar.querySelectorAll<HTMLElement>("[data-toolbar-item]"));
      assertEquals(items.length, 3, "three ToolbarButtons participate (separator excluded)");
      assertEquals(items[0]!.tabIndex, 0, "first item is the single tab stop");
      assertEquals(items[1]!.tabIndex, -1, "second item is not tabbable");
      assertEquals(items[2]!.tabIndex, -1, "third item is not tabbable");
    } finally {
      unmount();
    }
  });

  it("forwards onClick on a ToolbarButton (real MouseEvent reaches React)", () => {
    let clicks = 0;
    const { host, unmount } = render(
      <Toolbar>
        <ToolbarButton onClick={() => clicks++}>B</ToolbarButton>
        <ToolbarButton>I</ToolbarButton>
      </Toolbar>,
    );
    try {
      const first = host.querySelector<HTMLElement>("[data-toolbar-item]")!;
      flushSync(() => first.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      assertEquals(clicks, 1, "clicking a ToolbarButton fires its onClick");
    } finally {
      unmount();
    }
  });
});
