/**
 * `<Field>` behaviour - proves the label/control/description/error ids are
 * derived and wired for accessibility, and that an invalid field surfaces
 * `aria-invalid` + a `role="alert"` error.
 *
 * @module react/components/ui/field.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";

import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from "./field.tsx";

import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
// ---------------------------------------------------------------------------
// jsdom harness (from conformance.test.tsx) - fresh DOM per render, with the
// browser-API stubs effect-driven components expect.
// ---------------------------------------------------------------------------
function installDom(dom: JSDOM): () => void {
  return installComponentDom(dom, { matchMedia: true });
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
  flushSync(() => {});
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
  afterEach(async () => {
    // React defers scheduler cleanup after unmount. Drain that timer before
    // Deno's leak sanitizer closes the surrounding behaviour group.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

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

  it("omits aria-describedby when no FieldDescription is rendered", () => {
    const { host, unmount } = render(
      <Field invalid>
        <FieldLabel>Email</FieldLabel>
        <FieldControl>
          <input type="email" />
        </FieldControl>
        <FieldError>Enter a valid email.</FieldError>
      </Field>,
    );
    try {
      const control = host.querySelector("input")!;
      const describedBy = control.getAttribute("aria-describedby");
      for (const id of (describedBy ?? "").split(" ").filter(Boolean)) {
        assert(
          host.ownerDocument.getElementById(id) ?? host.querySelector(`#${id}`),
          `aria-describedby must not reference the missing node ${id}`,
        );
      }
    } finally {
      unmount();
    }
  });

  it("preserves a ref and aria-describedby set directly on the child control", () => {
    let node: HTMLElement | null = null;
    const { host, unmount } = render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <FieldControl>
          <input
            type="email"
            aria-describedby="consumer-hint"
            ref={(el: HTMLInputElement | null) => {
              node = el;
            }}
          />
        </FieldControl>
        <FieldDescription>Veryfront never shares it.</FieldDescription>
      </Field>,
    );
    try {
      const control = host.querySelector("input")!;
      assertEquals(node, control, "a ref on the child control must still receive the node");
      const describedBy = control.getAttribute("aria-describedby") ?? "";
      assert(
        describedBy.split(" ").includes("consumer-hint"),
        "the child's own aria-describedby must be merged, not dropped",
      );
    } finally {
      unmount();
    }
  });

  it("uses custom description and error ids in aria-describedby", () => {
    const { host, unmount } = render(
      <Field invalid>
        <FieldControl>
          <input />
        </FieldControl>
        <FieldDescription id="custom-description">Custom help</FieldDescription>
        <FieldError id="custom-error">Custom error</FieldError>
      </Field>,
    );
    try {
      const control = host.querySelector("input")!;
      const describedBy = (control.getAttribute("aria-describedby") ?? "").split(" ");
      assertEquals(host.querySelector("#custom-description")?.textContent, "Custom help");
      assertEquals(host.querySelector("#custom-error")?.textContent, "Custom error");
      assert(
        describedBy.includes("custom-description"),
        "control references the custom description",
      );
      assert(describedBy.includes("custom-error"), "control references the custom error");
    } finally {
      unmount();
    }
  });

  it("wires descriptions and errors rendered by wrapper components", async () => {
    function WrappedDescription(): React.ReactElement {
      return <FieldDescription>Wrapped help</FieldDescription>;
    }
    function WrappedError(): React.ReactElement {
      return <FieldError>Wrapped error</FieldError>;
    }

    const { host, unmount } = render(
      <Field invalid>
        <FieldControl>
          <input />
        </FieldControl>
        <WrappedDescription />
        <WrappedError />
      </Field>,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushSync(() => {});
      const control = host.querySelector("input")!;
      const describedBy = (control.getAttribute("aria-describedby") ?? "").split(" ");
      const description = Array.from(host.querySelectorAll("p")).find((node) =>
        node.textContent === "Wrapped help"
      );
      const error = host.querySelector('[role="alert"]');
      assert(description, "wrapped description renders");
      assert(error, "wrapped error renders");
      assert(describedBy.includes(description.id), "control references the wrapped description");
      assert(describedBy.includes(error.id), "control references the wrapped error");
    } finally {
      unmount();
    }
  });

  it("uses custom ids from descriptions and errors rendered by wrapper components", async () => {
    function WrappedDescription(): React.ReactElement {
      return <FieldDescription id="wrapped-description">Wrapped help</FieldDescription>;
    }
    function WrappedError(): React.ReactElement {
      return <FieldError id="wrapped-error">Wrapped error</FieldError>;
    }

    const { host, unmount } = render(
      <Field invalid>
        <FieldControl>
          <input />
        </FieldControl>
        <WrappedDescription />
        <WrappedError />
      </Field>,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushSync(() => {});
      const control = host.querySelector("input")!;
      const describedBy = (control.getAttribute("aria-describedby") ?? "").split(" ");
      assertEquals(host.querySelector("#wrapped-description")?.textContent, "Wrapped help");
      assertEquals(host.querySelector("#wrapped-error")?.textContent, "Wrapped error");
      assert(
        describedBy.includes("wrapped-description"),
        "control references the wrapped custom description id",
      );
      assert(
        describedBy.includes("wrapped-error"),
        "control references the wrapped custom error id",
      );
    } finally {
      unmount();
    }
  });
});
