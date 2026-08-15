/**
 * AlertDialog behaviour test. Renders an OPEN alert dialog (`defaultOpen`) with a
 * title, description, Action and Cancel, then proves: an element with
 * `role="alertdialog"` exists; it is labelled by the title and described by the
 * description (the `aria-labelledby` / `aria-describedby` ids resolve to those
 * nodes); and clicking Cancel closes it (the alertdialog leaves the DOM).
 *
 * Uses the `installDom` / `render` jsdom harness copied from
 * `conformance.test.tsx` (stubs matchMedia / rAF / ResizeObserver the modal
 * surface may touch). MouseEvent clicks reach React handlers in jsdom.
 *
 * @module react/components/ui/alert-dialog.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog.tsx";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog.tsx";

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
    "HTMLButtonElement",
    "Node",
    "Element",
    "FocusEvent",
    "KeyboardEvent",
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
  g.HTMLButtonElement = w.HTMLButtonElement;
  g.Node = w.Node;
  g.Element = w.Element;
  g.FocusEvent = w.FocusEvent;
  g.KeyboardEvent = w.KeyboardEvent;
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

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Render `element` into a fresh DOM; returns the document, host node, and a teardown. */
function render(element: React.ReactElement): {
  doc: Document;
  host: HTMLElement;
  click: (el: Element) => void;
  unmount: () => Promise<void>;
} {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`);
  const restore = installDom(dom);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  flushSync(() => root.render(element));
  flushSync(() => {});
  return {
    doc: dom.window.document,
    host: host as unknown as HTMLElement,
    click: (el: Element) =>
      flushSync(() => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))),
    unmount: async () => {
      try {
        await unmountReactRoot(root);
      } finally {
        restore();
      }
    },
  };
}

const OPEN_CONFIRM = (
  <AlertDialog defaultOpen>
    <AlertDialogTrigger>Delete account</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogTitle>Delete account?</AlertDialogTitle>
      <AlertDialogDescription>This permanently removes your account.</AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

describe("AlertDialog", () => {
  it("wires trigger aria-controls to the actual alert panel", async () => {
    const { doc, click, unmount } = render(
      <AlertDialog>
        <AlertDialogTrigger id="confirm-trigger">Open confirmation</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm action</AlertDialogTitle>
          <AlertDialogDescription>This action needs confirmation.</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>,
    );
    try {
      const trigger = doc.getElementById("confirm-trigger") as HTMLButtonElement;
      click(trigger);
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') !== null,
        "alert dialog did not open",
      );
      const panel = doc.querySelector<HTMLElement>('[role="alertdialog"]')!;
      assertEquals(
        trigger.getAttribute("aria-controls"),
        panel.id,
        "trigger aria-controls must resolve to the mounted alert panel",
      );
      assertEquals(doc.getElementById(panel.id), panel, "panel id must be present in the DOM");
    } finally {
      await unmount();
    }
  });

  it("preserves consumer title and description ids in panel wiring", async () => {
    const { doc, click, unmount } = render(
      <AlertDialog>
        <AlertDialogTrigger id="confirm-trigger">Open confirmation</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle id="custom-title">Confirm action</AlertDialogTitle>
          <AlertDialogDescription id="custom-description">
            This action needs confirmation.
          </AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>,
    );
    try {
      click(doc.getElementById("confirm-trigger")!);
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') !== null,
        "alert dialog did not open",
      );
      const panel = doc.querySelector<HTMLElement>('[role="alertdialog"]')!;
      await waitFor(
        () => panel.getAttribute("aria-labelledby") === "custom-title",
        "alert dialog did not adopt the custom title id",
      );
      assertEquals(panel.getAttribute("aria-labelledby"), "custom-title");
      assertEquals(panel.getAttribute("aria-describedby"), "custom-description");
      assertEquals(doc.getElementById("custom-title")?.textContent, "Confirm action");
      assertEquals(
        doc.getElementById("custom-description")?.textContent?.trim(),
        "This action needs confirmation.",
      );
    } finally {
      await unmount();
    }
  });

  it("traps focus and restores it to the trigger after closing", async () => {
    const { doc, click, unmount } = render(
      <div data-vf-ui="">
        <AlertDialog>
          <AlertDialogTrigger id="confirm-trigger">Open confirmation</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Confirm action</AlertDialogTitle>
            <AlertDialogDescription>This action needs confirmation.</AlertDialogDescription>
            <AlertDialogCancel id="first-action">Cancel</AlertDialogCancel>
            <AlertDialogAction id="last-action">Continue</AlertDialogAction>
          </AlertDialogContent>
        </AlertDialog>
        <button id="outside" type="button">Outside</button>
      </div>,
    );
    try {
      const trigger = doc.getElementById("confirm-trigger") as HTMLButtonElement;
      const outside = doc.getElementById("outside") as HTMLButtonElement;
      trigger.focus();
      click(trigger);
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') !== null,
        "alert dialog did not open",
      );
      const panel = doc.querySelector<HTMLElement>('[role="alertdialog"]')!;
      const first = doc.getElementById("first-action") as HTMLButtonElement;
      const last = doc.getElementById("last-action") as HTMLButtonElement;
      await waitFor(() => doc.activeElement === first, "first action did not receive focus");

      last.focus();
      const tab = new doc.defaultView!.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
      });
      last.dispatchEvent(tab);
      assert(tab.defaultPrevented, "forward Tab is contained at the final action");
      assertEquals(doc.activeElement, first, "focus wraps to the first action");

      outside.focus();
      assertEquals(doc.activeElement, first, "programmatic focus is contained in the modal");

      click(first);
      await waitFor(() => !panel.isConnected, "alert dialog did not close");
      assertEquals(doc.activeElement, trigger, "closing restores focus to the trigger");
    } finally {
      await unmount();
    }
  });

  it("portals outside clipping ancestors while retaining the token scope", async () => {
    const { doc, click, unmount } = render(
      <div data-vf-ui="" data-testid="scope">
        <div data-testid="clipped" style={{ overflow: "hidden", transform: "translateZ(0)" }}>
          <AlertDialog>
            <AlertDialogTrigger>Open confirmation</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Confirm action</AlertDialogTitle>
              <AlertDialogDescription>This action needs confirmation.</AlertDialogDescription>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>,
    );
    try {
      const trigger = doc.querySelector("button");
      assert(trigger);
      click(trigger);
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') !== null,
        "alert dialog did not open",
      );
      const panel = doc.querySelector<HTMLElement>('[role="alertdialog"]')!;
      assert(
        panel.closest('[data-testid="clipped"]') === null,
        "the fixed surface escapes transformed and clipping ancestors",
      );
      assert(
        panel.closest("[data-vf-ui]") === doc.querySelector('[data-testid="scope"]'),
        "the portalled surface retains the Veryfront token scope",
      );
    } finally {
      await unmount();
    }
  });

  it("renders a role='alertdialog' surface when open", async () => {
    const { doc, unmount } = render(OPEN_CONFIRM);
    try {
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') !== null,
        "alert dialog did not portal",
      );
      const panel = doc.querySelector('[role="alertdialog"]');
      assert(panel, "an element with role='alertdialog' must exist while open");
    } finally {
      await unmount();
    }
  });

  it("blocks Escape from dismissing an underlying dialog", async () => {
    const { doc, click, unmount } = render(
      <div data-vf-ui="" data-testid="scope">
        <Dialog>
          <DialogTrigger>Open outer dialog</DialogTrigger>
          <DialogContent>
            <DialogTitle>Outer dialog</DialogTitle>
            <AlertDialog defaultOpen>
              <AlertDialogContent>
                <AlertDialogTitle>Confirm action</AlertDialogTitle>
                <AlertDialogDescription>This action needs confirmation.</AlertDialogDescription>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
              </AlertDialogContent>
            </AlertDialog>
          </DialogContent>
        </Dialog>
      </div>,
    );
    try {
      const trigger = Array.from(doc.querySelectorAll("button")).find((button) =>
        button.textContent === "Open outer dialog"
      );
      assert(trigger, "outer trigger renders");
      click(trigger);
      await waitFor(
        () =>
          doc.querySelector('[role="dialog"]') !== null &&
          doc.querySelector('[role="alertdialog"]') !== null,
        "nested modal surfaces did not portal",
      );
      assert(doc.querySelector('[role="dialog"]'), "underlying dialog renders");
      const alert = doc.querySelector<HTMLElement>('[role="alertdialog"]');
      assert(alert, "alert dialog renders above it");
      assert(
        alert.closest('[role="dialog"]') === null,
        "the alert portal escapes the transformed outer dialog panel",
      );
      assert(
        alert.closest("[data-vf-ui]") === doc.querySelector('[data-testid="scope"]'),
        "the nested alert portal retains the outer token scope",
      );
      flushSync(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert(
        alert.contains(doc.activeElement),
        "the alert dialog becomes the active modal before Escape",
      );
      const event = new doc.defaultView!.KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      flushSync(() => doc.dispatchEvent(event));
      assert(event.defaultPrevented, "the top alert dialog consumes Escape");
      assert(doc.querySelector('[role="dialog"]'), "underlying dialog stays open");
      assert(doc.querySelector('[role="alertdialog"]'), "alert dialog stays open");
    } finally {
      await unmount();
    }
  });

  it("is labelled by the title and described by the description (ids resolve)", async () => {
    const { doc, unmount } = render(OPEN_CONFIRM);
    try {
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') !== null,
        "alert dialog did not portal",
      );
      const panel = doc.querySelector('[role="alertdialog"]') as HTMLElement;
      assert(panel, "panel renders");

      const labelledBy = panel.getAttribute("aria-labelledby");
      const describedBy = panel.getAttribute("aria-describedby");
      assert(labelledBy, "panel must have aria-labelledby");
      assert(describedBy, "panel must have aria-describedby");

      const titleEl = doc.getElementById(labelledBy!);
      const descEl = doc.getElementById(describedBy!);
      assert(titleEl, "aria-labelledby id must resolve to the title node");
      assert(descEl, "aria-describedby id must resolve to the description node");
      assert(
        (titleEl!.textContent ?? "").includes("Delete account?"),
        "labelled node is the title",
      );
      assert(
        (descEl!.textContent ?? "").includes("permanently removes"),
        "described node is the description",
      );
    } finally {
      await unmount();
    }
  });

  it("closes when Cancel is clicked (alertdialog leaves the DOM)", async () => {
    const { doc, click, unmount } = render(OPEN_CONFIRM);
    try {
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') !== null,
        "alert dialog did not portal",
      );
      assert(doc.querySelector('[role="alertdialog"]'), "open initially");
      const buttons = Array.from(doc.querySelectorAll("button"));
      const cancel = buttons.find((b) => (b.textContent ?? "").includes("Cancel"))!;
      assert(cancel, "Cancel button renders");
      click(cancel);
      await waitFor(
        () => doc.querySelector('[role="alertdialog"]') === null,
        "clicking Cancel did not close the alert dialog",
      );
    } finally {
      await unmount();
    }
  });
});
