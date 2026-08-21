/**
 * Calendar behaviour. Pins the observable contract with EXPLICIT dates only
 * (never `today`): the caption shows the displayed "Month YYYY", there are seven
 * weekday headers, the selected day's gridcell carries `aria-selected="true"`
 * while its button carries `aria-pressed="true"`, and clicking
 * a day button fires `onChange` with that day's Date.
 *
 * Keyboard and pointer behavior use real bubbling DOM events through the
 * rendered controls.
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

import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
// ---------------------------------------------------------------------------
// jsdom harness - installs a fresh DOM per render and stubs the browser APIs
// jsdom lacks (ResizeObserver, rAF, matchMedia) so effect-driven components mount.
// ---------------------------------------------------------------------------
function installDom(dom: JSDOM): () => void {
  return installComponentDom(dom, { matchMedia: true, windowGlobals: ["KeyboardEvent"] });
}

/** Render `element` into a fresh DOM; returns the host node, a click helper and a teardown. */
function render(element: React.ReactElement): {
  host: HTMLElement;
  click: (el: Element) => void;
  keyDown: (el: Element, key: string) => void;
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
    keyDown: (el: Element, key: string) =>
      flushSync(() =>
        el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }))
      ),
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

  it("keeps one day in the tab order and prefers the selected day", () => {
    const { host, unmount } = render(
      <Calendar value={new Date(2026, 0, 15)} defaultMonth={new Date(2026, 0, 1)} />,
    );
    try {
      const days = Array.from(
        host.querySelectorAll<HTMLButtonElement>('td[role="gridcell"] button'),
      );
      const tabbable = days.filter((button) => button.tabIndex === 0);

      assertEquals(tabbable.length, 1, "the grid exposes one tab stop");
      assertEquals(tabbable[0]?.textContent, "15", "the selected day is initially tabbable");
      assertEquals(
        days.every((button) => button === tabbable[0] || button.tabIndex === -1),
        true,
        "all other days leave the sequential tab order",
      );
    } finally {
      unmount();
    }
  });

  it("moves day focus with the arrow keys", () => {
    const { host, keyDown, unmount } = render(
      <Calendar value={new Date(2026, 0, 15)} defaultMonth={new Date(2026, 0, 1)} />,
    );
    try {
      const fifteenth = dayButton(host, "15");
      fifteenth.focus();

      keyDown(fifteenth, "ArrowRight");
      assertEquals(host.ownerDocument.activeElement?.textContent, "16", "Right moves one day");
      keyDown(dayButton(host, "16"), "ArrowDown");
      assertEquals(host.ownerDocument.activeElement?.textContent, "23", "Down moves one week");
      keyDown(dayButton(host, "23"), "ArrowLeft");
      assertEquals(host.ownerDocument.activeElement?.textContent, "22", "Left moves one day");
      keyDown(dayButton(host, "22"), "ArrowUp");
      assertEquals(host.ownerDocument.activeElement?.textContent, "15", "Up moves one week");
      assertEquals(dayButton(host, "15").tabIndex, 0, "the focused day owns the tab stop");
    } finally {
      unmount();
    }
  });

  it("moves focus to the configured week boundaries with Home and End", () => {
    const { host, keyDown, unmount } = render(
      <Calendar
        value={new Date(2026, 0, 15)}
        defaultMonth={new Date(2026, 0, 1)}
        weekStartsOn={1}
      />,
    );
    try {
      const fifteenth = dayButton(host, "15");
      fifteenth.focus();

      keyDown(fifteenth, "Home");
      assertEquals(host.ownerDocument.activeElement?.textContent, "12", "Home moves to Monday");
      keyDown(dayButton(host, "12"), "End");
      assertEquals(host.ownerDocument.activeElement?.textContent, "18", "End moves to Sunday");
    } finally {
      unmount();
    }
  });

  it("moves focus across months with Page Down and Page Up", () => {
    const { host, keyDown, unmount } = render(
      <Calendar value={new Date(2026, 0, 15)} defaultMonth={new Date(2026, 0, 1)} />,
    );
    try {
      const fifteenth = dayButton(host, "15");
      fifteenth.focus();

      keyDown(fifteenth, "PageDown");
      assert(host.textContent?.includes("February 2026"), "Page Down shows the next month");
      assertEquals(host.ownerDocument.activeElement?.textContent, "15", "Page Down preserves day");

      keyDown(dayButton(host, "15"), "PageUp");
      assert(host.textContent?.includes("January 2026"), "Page Up shows the previous month");
      assertEquals(host.ownerDocument.activeElement?.textContent, "15", "Page Up preserves day");
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
