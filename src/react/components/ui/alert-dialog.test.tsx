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
import { assert } from "#veryfront/testing/assert.ts";
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

/** Render `element` into a fresh DOM; returns the document, host node, and a teardown. */
function render(element: React.ReactElement): {
  doc: Document;
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
    doc: dom.window.document,
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
  it("renders a role='alertdialog' surface when open", () => {
    const { doc, unmount } = render(OPEN_CONFIRM);
    try {
      const panel = doc.querySelector('[role="alertdialog"]');
      assert(panel, "an element with role='alertdialog' must exist while open");
    } finally {
      unmount();
    }
  });

  it("is labelled by the title and described by the description (ids resolve)", () => {
    const { doc, unmount } = render(OPEN_CONFIRM);
    try {
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
      unmount();
    }
  });

  it("closes when Cancel is clicked (alertdialog leaves the DOM)", () => {
    const { doc, click, unmount } = render(OPEN_CONFIRM);
    try {
      assert(doc.querySelector('[role="alertdialog"]'), "open initially");
      const buttons = Array.from(doc.querySelectorAll("button"));
      const cancel = buttons.find((b) => (b.textContent ?? "").includes("Cancel"))!;
      assert(cancel, "Cancel button renders");
      click(cancel);
      assert(
        doc.querySelector('[role="alertdialog"]') === null,
        "clicking Cancel closes the alert dialog",
      );
    } finally {
      unmount();
    }
  });
});
