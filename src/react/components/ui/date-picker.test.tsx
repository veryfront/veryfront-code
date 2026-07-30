/**
 * DatePicker behaviour. Pins the composition contract: the trigger renders a
 * field-styled button (placeholder when empty), opening the popover portals the
 * shared Calendar's `role="grid"` into the document, and clicking a day commits
 * the value (fires `onChange` with that day) and closes the surface.
 *
 * NOTE: with `defaultOpen`, the Popover's `Floating` surface portals before the
 * anchor ref attaches, so it lands under `document.body` rather than the mount
 * scope — the grid is queried on `document`, not the host. Synthetic key/focus
 * events do NOT reach React in this deno+jsdom harness, so the day is chosen via
 * a real click `MouseEvent` (the pointer path).
 *
 * @module react/components/ui/date-picker.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DatePicker, DatePickerContent, DatePickerTrigger } from "./date-picker.tsx";

// ---------------------------------------------------------------------------
// jsdom harness — installs a fresh DOM per render and stubs the browser APIs
// jsdom lacks (ResizeObserver, rAF, matchMedia) that Popover's Floating needs.
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

/** Render `element` into a fresh DOM; returns the host node, a click helper, and teardown. */
function render(element: React.ReactElement): {
  host: HTMLElement;
  doc: Document;
  click: (el: Element) => void;
  unmount: () => void;
} {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"></div></body></html>`,
    { url: "https://example.com/", pretendToBeVisual: true },
  );
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  return {
    host: host as unknown as HTMLElement,
    doc: dom.window.document,
    click: (el: Element) =>
      flushSync(() => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))),
    unmount: () => {
      try {
        root.unmount();
      } finally {
        restore();
      }
    },
  };
}

describe("DatePicker behaviour", () => {
  it("opens the Calendar; picking a day fires onChange with that day and closes", () => {
    let picked: Date | undefined;
    const { host, doc, click, unmount } = render(
      <DatePicker
        defaultOpen
        defaultMonth={new Date(2026, 0, 1)}
        onChange={(d) => (picked = d)}
      >
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>,
    );
    try {
      // Trigger renders with the placeholder (no value selected).
      const trigger = host.querySelector("button");
      assert(trigger, "trigger button renders in place");
      assert(
        trigger!.textContent?.includes("Pick a date"),
        "trigger shows the placeholder when empty",
      );
      assertEquals(trigger!.getAttribute("data-empty"), "true", "data-empty set when no value");

      // The Calendar grid is portalled (defaultOpen escapes the mount scope) —
      // query the document, per the harness note.
      const grid = doc.querySelector('[role="grid"]');
      assert(grid, "the Calendar grid appears while open");

      // Click day 15 of Jan 2026 (day buttons live inside the grid table).
      const dayButtons = Array.from(grid!.querySelectorAll("button"));
      const fifteenth = dayButtons.find((b) => b.textContent?.trim() === "15");
      assert(fifteenth, "day button 15 renders");
      click(fifteenth!);

      assert(picked, "onChange fired");
      assertEquals(picked!.getFullYear(), 2026, "picked year is 2026");
      assertEquals(picked!.getMonth(), 0, "picked month is January");
      assertEquals(picked!.getDate(), 15, "picked day is the 15th");

      // Popover closed on select, and the trigger now shows the formatted date.
      assertEquals(doc.querySelector('[role="grid"]'), null, "the surface closed after picking");
      const after = host.querySelector("button")!;
      assert(after.getAttribute("data-empty") == null, "trigger is no longer empty");
      assert(!after.textContent?.includes("Pick a date"), "placeholder replaced by the date");
    } finally {
      unmount();
    }
  });
});
