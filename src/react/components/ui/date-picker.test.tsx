/**
 * DatePicker behaviour. Pins the composition contract: the trigger renders a
 * field-styled button (placeholder when empty), opening the popover portals the
 * shared Calendar's `role="grid"` into the document, and clicking a day commits
 * the value (fires `onChange` with that day) and closes the surface.
 *
 * NOTE: with `defaultOpen`, the Popover's `Floating` surface portals before the
 * anchor ref attaches, so it lands under `document.body` rather than the mount
 * scope - the grid is queried on `document`, not the host. Synthetic key/focus
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
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { DatePicker, DatePickerContent, DatePickerTrigger } from "./date-picker.tsx";

// ---------------------------------------------------------------------------
// jsdom harness - installs a fresh DOM per render and stubs the browser APIs
// jsdom lacks (ResizeObserver, rAF, matchMedia) that Popover's Floating needs.
// ---------------------------------------------------------------------------
function installDom(dom: JSDOM): () => void {
  return installComponentDom(dom, { matchMedia: true });
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
  it("returns focus to the trigger after selecting a day", () => {
    const { host, doc, click, unmount } = render(
      <DatePicker defaultOpen defaultMonth={new Date(2026, 0, 1)}>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>,
    );
    try {
      const trigger = host.querySelector("button") as HTMLButtonElement;
      const grid = doc.querySelector('[role="grid"]');
      assert(grid, "the Calendar grid appears while open");
      const dayButtons = Array.from(grid!.querySelectorAll("button"));
      const fifteenth = dayButtons.find((b) => b.textContent?.trim() === "15");
      assert(fifteenth, "day button 15 renders");
      (fifteenth as HTMLButtonElement).focus();
      assertEquals(doc.activeElement, fifteenth, "the selected day has focus before closing");

      click(fifteenth!);

      assertEquals(doc.querySelector('[role="grid"]'), null, "the surface closed after picking");
      assertEquals(doc.activeElement, trigger, "selecting a day restores focus to the trigger");
    } finally {
      unmount();
    }
  });

  it("opens the Calendar; picking a day fires onChange with that day and closes", () => {
    let picked: Date | undefined;
    const { host, doc, click, unmount } = render(
      <DatePicker
        defaultOpen
        defaultMonth={new Date(2026, 0, 1)}
        onChange={(d) => (picked = d)}
        format={(d) => `Y${d.getFullYear()}-D${d.getDate()}`}
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

      // The Calendar grid is portalled (defaultOpen escapes the mount scope) -
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
      assert(
        after.textContent?.includes("Y2026-D15"),
        "the trigger label is produced by the format prop",
      );
    } finally {
      unmount();
    }
  });

  it("honours a controlled value: the parent owns the label, the picker only reports", () => {
    const picks: Date[] = [];
    const controlled = new Date(2026, 0, 20);
    const { host, doc, click, unmount } = render(
      <DatePicker
        value={controlled}
        defaultOpen
        defaultMonth={new Date(2026, 0, 1)}
        onChange={(date) => picks.push(date)}
      >
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>,
    );
    try {
      const trigger = host.querySelector("button")!;
      assertEquals(
        trigger.getAttribute("data-empty"),
        null,
        "a controlled value leaves the trigger non-empty",
      );
      // No `format` prop here, so this also pins the documented default.
      assertEquals(
        trigger.querySelector("span")!.textContent,
        controlled.toLocaleDateString(),
        "the controlled value drives the label through the default toLocaleDateString format",
      );

      const grid = doc.querySelector('[role="grid"]');
      assert(grid, "the Calendar grid appears while open");
      const fifteenth = Array.from(grid!.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "15",
      );
      assert(fifteenth, "day button 15 renders");
      click(fifteenth!);

      assertEquals(picks.length, 1, "picking a day reports exactly once through onChange");
      assertEquals(picks[0]!.getDate(), 15, "onChange carries the day that was clicked");
      assertEquals(
        host.querySelector("button")!.querySelector("span")!.textContent,
        controlled.toLocaleDateString(),
        "a controlled DatePicker must not move its own value - the parent still owns it",
      );
    } finally {
      unmount();
    }
  });
});
