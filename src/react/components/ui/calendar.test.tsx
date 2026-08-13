/**
 * Calendar behaviour. Pins the observable contract with EXPLICIT dates only
 * (never `today`): the caption shows the displayed "Month YYYY", there are seven
 * weekday headers, the selected day's gridcell carries `aria-selected="true"`
 * while its button carries `aria-pressed="true"`, and clicking
 * a day button fires `onChange` with that day's Date.
 *
 * NOTE: synthetic keyboard/input events do NOT reach React handlers in this
 * deno+jsdom harness, so the day is chosen via a real click `MouseEvent`
 * (`bubbles: true`) - the same path a user's pointer takes.
 *
 * @module react/components/ui/calendar.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { Calendar } from "./calendar.tsx";

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
  unmount: () => void;
} {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  return {
    host: host as unknown as HTMLElement,
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

/** Find the day `<button>` whose visible text is exactly `label`. */
function dayButton(host: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no day button labelled "${label}"`);
  return btn as HTMLButtonElement;
}

describe("Calendar behaviour", () => {
  it("shows the displayed month caption and exactly seven weekday headers", () => {
    const { host, unmount } = render(
      <Calendar value={new Date(2026, 0, 15)} defaultMonth={new Date(2026, 0, 1)} />,
    );
    try {
      assert(
        host.textContent?.includes("January 2026"),
        "caption shows the month name and year",
      );
      const heads = host.querySelectorAll('th[scope="col"]');
      assertEquals(heads.length, 7, "seven weekday headers render");
    } finally {
      unmount();
    }
  });

  it("marks the selected day on the gridcell, and presses its button", () => {
    const { host, unmount } = render(
      <Calendar value={new Date(2026, 0, 15)} defaultMonth={new Date(2026, 0, 1)} />,
    );
    try {
      const fifteenth = dayButton(host, "15");
      // aria-selected is only valid on the gridcell; the button reports aria-pressed.
      assertEquals(fifteenth.getAttribute("aria-pressed"), "true", "the 15th reads as pressed");
      assertEquals(
        fifteenth.getAttribute("aria-selected"),
        null,
        "aria-selected is not set on role=button",
      );
      const cell = fifteenth.closest("td");
      assertEquals(cell?.getAttribute("aria-selected"), "true", "its gridcell is selected");
      assertEquals(cell?.getAttribute("data-selected"), "true", "its cell is marked selected");
    } finally {
      unmount();
    }
  });

  it("clicking a day fires onChange with that day's Date", () => {
    let picked: Date | undefined;
    const { host, click, unmount } = render(
      <Calendar
        value={new Date(2026, 0, 15)}
        defaultMonth={new Date(2026, 0, 1)}
        onChange={(d) => {
          picked = d;
        }}
      />,
    );
    try {
      click(dayButton(host, "20"));
      assert(picked, "onChange fired");
      assertEquals(picked!.getDate(), 20, "day is the 20th");
      assertEquals(picked!.getMonth(), 0, "month is January (0)");
      assertEquals(picked!.getFullYear(), 2026, "year is 2026");
    } finally {
      unmount();
    }
  });
});
