/**
 * Meter - leaf conformance + semantics. Proves the RFC 2980 leaf contract (one
 * root node, `ref` forwarded, `{...props}` / `data-*` spread, `className`
 * merged) and the gauge semantics: `role="meter"` with an `aria-valuenow` that
 * reflects the value clamped into `[min, max]`.
 *
 * @module react/components/ui/meter.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { Meter } from "./meter.tsx";

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

describe("Meter - leaf conformance (one node · ref · {...props} · className)", () => {
  it("renders one root node, forwards ref, spreads data-*, merges className", () => {
    const ref = React.createRef<HTMLDivElement>();
    const { host, unmount } = render(
      <Meter value={40} ref={ref} data-probe="x" className="vf-probe" />,
    );
    try {
      assert(host.children.length === 1, "Meter must render exactly one root node");
      const node = host.children[0] as HTMLElement;
      assertEquals(node.getAttribute("data-probe"), "x", "must spread {...props} (data-probe)");
      assert(node.className.includes("vf-probe"), "must merge consumer className");
      assert(node.className.includes("rounded-full"), "must keep a base class");
      assert(ref.current === node, "must forward ref to its root node");
    } finally {
      unmount();
    }
  });
});

describe("Meter - semantics (role=meter · clamped aria-valuenow)", () => {
  it("exposes role=meter with the value range and label", () => {
    const { host, unmount } = render(
      <Meter value={30} min={0} max={100} label="30 of 100" />,
    );
    try {
      const node = host.querySelector('[role="meter"]') as HTMLElement;
      assert(node, "root carries role=meter");
      assertEquals(node.getAttribute("aria-valuenow"), "30");
      assertEquals(node.getAttribute("aria-valuemin"), "0");
      assertEquals(node.getAttribute("aria-valuemax"), "100");
      assertEquals(node.getAttribute("aria-valuetext"), "30 of 100");
    } finally {
      unmount();
    }
  });

  it("clamps aria-valuenow above max down into [min, max]", () => {
    const { host, unmount } = render(<Meter value={140} min={0} max={100} />);
    try {
      const node = host.querySelector('[role="meter"]') as HTMLElement;
      assertEquals(node.getAttribute("aria-valuenow"), "100", "over-max value clamps to max");
    } finally {
      unmount();
    }
  });

  it("clamps aria-valuenow below min up into [min, max]", () => {
    const { host, unmount } = render(<Meter value={-20} min={0} max={100} />);
    try {
      const node = host.querySelector('[role="meter"]') as HTMLElement;
      assertEquals(node.getAttribute("aria-valuenow"), "0", "under-min value clamps to min");
    } finally {
      unmount();
    }
  });
});
