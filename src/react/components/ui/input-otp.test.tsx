/**
 * InputOTP behaviour. Pins the observable contract: the root is a
 * `role="group"`; it renders exactly `maxLength` presentational slots mirroring
 * the controlled `value`; and it renders ONE visually-hidden real `<input>`
 * (`inputMode="numeric"`, `maxLength`) that captures typing/paste.
 *
 * NOTE: synthetic key/input events do NOT reach React handlers in this
 * deno+jsdom harness, so behaviour is proven by rendering a controlled `value`
 * and asserting the structure it produces (not by simulating typing).
 *
 * @module react/components/ui/input-otp.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { InputOTP } from "./input-otp.tsx";

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

describe("InputOTP behaviour", () => {
  it("renders a role=group with maxLength slots, a numeric hidden input, and mirrors the value", () => {
    const { host, unmount } = render(
      <InputOTP value="123" maxLength={6} onChange={() => {}} />,
    );
    try {
      const group = host.querySelector('[role="group"]') as HTMLElement;
      assert(group, "root renders role=group");

      const slots = host.querySelectorAll("[data-slot]");
      assertEquals(slots.length, 6, "renders exactly maxLength (6) slots");

      const input = host.querySelector("input") as HTMLInputElement;
      assert(input, "renders one hidden real input");
      assertEquals(host.querySelectorAll("input").length, 1, "exactly one input");
      assertEquals(input.getAttribute("maxLength"), "6", "input maxLength reflects maxLength prop");
      assertEquals(input.getAttribute("inputMode"), "numeric", "input is numeric");

      assertEquals(slots[0]?.textContent, "1", "first slot shows '1'");
      assertEquals(slots[1]?.textContent, "2", "second slot shows '2'");
      assertEquals(slots[2]?.textContent, "3", "third slot shows '3'");
      assertEquals(slots[3]?.textContent, "", "fourth slot is empty");

      // The active slot is the caret position (index === value.length === 3).
      assert(slots[3]?.hasAttribute("data-active"), "slot at value.length is active");
    } finally {
      unmount();
    }
  });

  it("clamps a longer, non-digit value for both the input and the slots", () => {
    const { host, unmount } = render(<InputOTP value="12a34567" maxLength={6} />);
    try {
      const input = host.querySelector("input")!;
      assertEquals(input.value, "123456", "the input holds only maxLength digits");
      const slots = host.querySelectorAll("[data-slot]");
      assertEquals(slots.length, 6, "exactly maxLength slots render");
      assertEquals(
        host.querySelectorAll("[data-active]").length,
        0,
        "a full code leaves no active slot rather than indexing past the last one",
      );
    } finally {
      unmount();
    }
  });

  it("gives the focusable input its own accessible name", () => {
    const { host, unmount } = render(<InputOTP value="12" />);
    try {
      const input = host.querySelector("input")!;
      assert(
        (input.getAttribute("aria-label") ?? "").length > 0,
        "the input that receives focus must carry a name, not just the group",
      );
    } finally {
      unmount();
    }
  });
});
