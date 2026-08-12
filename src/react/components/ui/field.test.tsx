/**
 * `<Field>` behaviour — proves the label/control/description/error ids are
 * derived and wired for accessibility, and that an invalid field surfaces
 * `aria-invalid` + a `role="alert"` error.
 *
 * @module react/components/ui/field.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from "./field.tsx";

// ---------------------------------------------------------------------------
// jsdom harness (from conformance.test.tsx) — fresh DOM per render, with the
// browser-API stubs effect-driven components expect.
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

describe("Field", () => {
  it("wires label htmlFor and control id, and aria-describedby → description", () => {
    const { host, unmount } = render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <FieldControl>
          <input />
        </FieldControl>
        <FieldDescription>help</FieldDescription>
      </Field>,
    );
    try {
      const label = host.querySelector("label")!;
      const input = host.querySelector("input")!;
      const description = host.querySelector("p")!;

      assert(input.id.length > 0, "control must receive a derived id");
      assert(
        label.getAttribute("for") === input.id,
        "label htmlFor must equal the control id",
      );
      assert(
        (input.getAttribute("aria-describedby") ?? "").includes(description.id),
        "aria-describedby must include the description id",
      );
      // Valid field: no aria-invalid asserted.
      assert(
        input.getAttribute("aria-invalid") === null,
        "a valid field must not set aria-invalid",
      );
    } finally {
      unmount();
    }
  });

  it("surfaces aria-invalid and a role=alert error when invalid", () => {
    const { host, unmount } = render(
      <Field invalid>
        <FieldLabel>Email</FieldLabel>
        <FieldControl>
          <input />
        </FieldControl>
        <FieldError>Required</FieldError>
      </Field>,
    );
    try {
      const input = host.querySelector("input")!;
      const alert = host.querySelector('[role="alert"]');

      assert(
        input.getAttribute("aria-invalid") === "true",
        "invalid field must set aria-invalid='true' on the control",
      );
      assert(alert !== null, "invalid field must render a role='alert' error");
      assert(
        (input.getAttribute("aria-describedby") ?? "").includes(alert!.id),
        "aria-describedby must include the error id when invalid",
      );
    } finally {
      unmount();
    }
  });

  it("FieldError renders nothing when it has no children", () => {
    const { host, unmount } = render(
      <Field invalid>
        <FieldControl>
          <input />
        </FieldControl>
        <FieldError>{null}</FieldError>
      </Field>,
    );
    try {
      assert(
        host.querySelector('[role="alert"]') === null,
        "empty FieldError must render nothing",
      );
    } finally {
      unmount();
    }
  });
});
