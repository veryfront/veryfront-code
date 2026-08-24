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
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { ScrollArea } from "./scroll-area.tsx";

// ---------------------------------------------------------------------------
// jsdom harness - installs a fresh DOM per render and stubs the browser APIs
// jsdom lacks (ResizeObserver, rAF, matchMedia) so effect-driven components mount.
// ---------------------------------------------------------------------------
function installDom(dom: JSDOM): () => void {
  return installComponentDom(dom, { matchMedia: true });
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

describe("ScrollArea - leaf conformance (one node · ref · {...props} · className)", () => {
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
      assert(
        node.classList.contains("overflow-y-auto"),
        "must keep the default vertical scroll class",
      );
      assertEquals(ref.current, node, "must forward ref to its node");
      assert(node.textContent?.includes("scrollable content"), "renders its children");
    } finally {
      unmount();
    }
  });
});

/** The overflow classes that actually implement each scroll axis. */
const AXIS_CLASSES = {
  vertical: ["overflow-y-auto", "overflow-x-hidden"],
  horizontal: ["overflow-x-auto", "overflow-y-hidden"],
  both: ["overflow-auto"],
} as const;

/** Classes that would scroll the wrong axis for each orientation. */
const FORBIDDEN_AXIS_CLASSES = {
  vertical: ["overflow-x-auto", "overflow-y-hidden"],
  horizontal: ["overflow-y-auto", "overflow-x-hidden"],
  both: ["overflow-x-hidden", "overflow-y-hidden"],
} as const;

describe("ScrollArea - data-orientation reflects the orientation prop", () => {
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
        for (const cls of AXIS_CLASSES[orientation]) {
          assert(
            node.classList.contains(cls),
            `orientation="${orientation}" must apply ${cls}`,
          );
        }
        for (const cls of FORBIDDEN_AXIS_CLASSES[orientation]) {
          assertEquals(
            node.classList.contains(cls),
            false,
            `orientation="${orientation}" must not apply ${cls}`,
          );
        }
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
