/**
 * InputOTP behaviour. Pins the observable contract: the root is a
 * `role="group"`; it renders exactly `maxLength` presentational slots mirroring
 * the controlled `value`; and it renders ONE visually-hidden real `<input>`
 * (`inputMode="numeric"`) that captures typing/paste.
 *
 * NOTE: synthetic key/input events do NOT reach React handlers in this
 * deno+jsdom harness, so behaviour is proven by rendering a controlled `value`
 * and asserting the structure it produces (not by simulating typing); the write
 * path is driven by invoking the input's own React `onChange` prop directly.
 *
 * @module react/components/ui/input-otp.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { InputOTP } from "./input-otp.tsx";

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
      assertEquals(
        input.getAttribute("maxLength"),
        null,
        "the browser must not truncate pasted separators before sanitization",
      );
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
        1,
        "a full code keeps a visible focus indicator on one slot",
      );
      assert(
        slots[5]?.hasAttribute("data-active"),
        "the final slot stays active when the controlled code is full",
      );
    } finally {
      unmount();
    }
  });

  it("sanitizes the value it reports through onChange", () => {
    const received: string[] = [];
    const { host, unmount } = render(
      <InputOTP value="" maxLength={6} onChange={(next) => received.push(next)} />,
    );
    try {
      const input = host.querySelector("input")!;
      const propsKey = Object.keys(input).find((name) => name.startsWith("__reactProps$"));
      assert(propsKey, "the rendered input exposes its React props");
      const inputProps = (input as unknown as Record<string, {
        onChange?: (event: unknown) => void;
      }>)[propsKey]!;

      flushSync(() => inputProps.onChange?.({ target: { value: "12-34 5678" } }));
      assertEquals(received, ["123456"], "onChange reports digits only, clamped to maxLength");
    } finally {
      unmount();
    }
  });

  it("disables the focusable input and marks the group", () => {
    const { host, unmount } = render(<InputOTP value="12" disabled />);
    try {
      assertEquals(
        host.querySelector("input")!.disabled,
        true,
        "the control that receives focus is the one that must be disabled",
      );
      assert(
        host.querySelector('[role="group"]')!.hasAttribute("data-disabled"),
        "the group exposes the disabled state for styling",
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
