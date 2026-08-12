/**
 * ScrollArea behaviour. Pins the leaf conformance contract (RFC 2980): the
 * component renders exactly one root DOM node, forwards `ref` to it, spreads
 * arbitrary `{...props}` (`data-*`) through, and merges `className` (consumer
 * class wins, base classes kept). Also asserts `data-orientation` reflects the
 * `orientation` prop for each of its three values.
 *
 * @module react/components/ui/scroll-area.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ScrollArea } from "./scroll-area.tsx";

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

describe("ScrollArea — leaf conformance (one node · ref · {...props} · className)", () => {
  it("renders one root node, forwards ref, spreads data-*, merges className", () => {
    const ref = React.createRef<HTMLDivElement>();
    const { host, unmount } = render(
      <ScrollArea ref={ref} data-probe="x" className="vf-probe">
        <p>scrollable content</p>
      </ScrollArea>,
    );
    try {
      assertEquals(host.children.length, 1, "ScrollArea must render exactly one root node");
      const node = host.children[0] as HTMLElement;
      assertEquals(node.getAttribute("data-probe"), "x", "must spread {...props} (data-probe)");
      assert(node.className.includes("vf-probe"), "must merge consumer className");
      assert(node.className.includes("overflow"), "must keep a base overflow class");
      assertEquals(ref.current, node, "must forward ref to its node");
      assert(node.textContent?.includes("scrollable content"), "renders its children");
    } finally {
      unmount();
    }
  });
});

describe("ScrollArea — data-orientation reflects the orientation prop", () => {
  for (const orientation of ["vertical", "horizontal", "both"] as const) {
    it(`orientation="${orientation}" sets data-orientation="${orientation}"`, () => {
      const { host, unmount } = render(
        <ScrollArea orientation={orientation}>
          <div>content</div>
        </ScrollArea>,
      );
      try {
        const node = host.children[0] as HTMLElement;
        assertEquals(
          node.getAttribute("data-orientation"),
          orientation,
          `data-orientation must reflect "${orientation}"`,
        );
      } finally {
        unmount();
      }
    });
  }

  it("defaults to vertical when orientation is omitted", () => {
    const { host, unmount } = render(<ScrollArea>content</ScrollArea>);
    try {
      const node = host.children[0] as HTMLElement;
      assertEquals(node.getAttribute("data-orientation"), "vertical", "default is vertical");
    } finally {
      unmount();
    }
  });
});
