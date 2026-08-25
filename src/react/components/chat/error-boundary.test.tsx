import type * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { installComponentDom } from "#veryfront/testing/dom-globals.ts";
import { ChatErrorBoundary, useChatErrorHandler } from "./error-boundary.tsx";

/**
 * Mount `element` in a fresh JSDOM and hand the body the host node plus a click
 * driver. Errors the boundary catches are swallowed so the console stays clean.
 */
async function mounted(
  element: React.ReactElement,
  body: (ctx: { host: HTMLElement; click: (el: Element) => void }) => void | Promise<void>,
): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const restore = installComponentDom(dom);
  const host = dom.window.document.getElementById("root")! as unknown as HTMLElement;
  const root = createRoot(host, { onCaughtError: () => {} });
  try {
    flushSync(() => root.render(element));
    await body({
      host,
      click: (el) =>
        flushSync(() => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))),
    });
  } finally {
    try {
      await unmountReactRoot(root);
    } finally {
      restore();
    }
  }
}

function Boom(): React.ReactElement {
  throw new Error("kaboom");
}

// `renderToString` in this environment is the synchronous "legacy" server
// renderer, which does not invoke `getDerivedStateFromError`/`componentDidCatch`
// — a throwing descendant propagates straight out of `renderToString` instead
// of being swallowed into the boundary's fallback UI. These tests characterize
// the fallback's *render output* directly (by constructing the post-catch state
// and invoking `render()`), plus the observed SSR passthrough behavior.
describe("ChatErrorBoundary", () => {
  it("renders children when there is no error", () => {
    const html = renderToString(
      <ChatErrorBoundary>
        <div>all good</div>
      </ChatErrorBoundary>,
    );
    assertStringIncludes(html, "all good");
  });

  it("a throwing child propagates out of renderToString rather than being caught", () => {
    let threw = false;
    try {
      renderToString(
        <ChatErrorBoundary>
          <Boom />
        </ChatErrorBoundary>,
      );
    } catch {
      threw = true;
    }
    assert(
      threw,
      "legacy synchronous renderToString does not run componentDidCatch",
    );
  });

  it("render() produces the default alert fallback with the Try Again button once state has an error", () => {
    const instance = new ChatErrorBoundary({ children: null });
    instance.state = { hasError: true, error: new Error("kaboom") };
    const html = renderToString(instance.render());
    assertStringIncludes(html, 'role="alert"');
    assertStringIncludes(html, "An error occurred in the chat component");
    assertStringIncludes(html, "kaboom");
    assertStringIncludes(html, "Try Again");
  });

  it("render() uses a custom errorMessage in place of the default heading", () => {
    const instance = new ChatErrorBoundary({
      children: null,
      errorMessage: "Custom failure banner",
    });
    instance.state = { hasError: true, error: new Error("kaboom") };
    const html = renderToString(instance.render());
    assertStringIncludes(html, "Custom failure banner");
    assert(!html.includes("An error occurred in the chat component"));
  });

  it("render() renders a node fallback in place of the default UI", () => {
    const instance = new ChatErrorBoundary({
      children: null,
      fallback: <div data-testid="custom-fallback">custom fallback</div>,
    });
    instance.state = { hasError: true, error: new Error("kaboom") };
    const html = renderToString(instance.render());
    assertStringIncludes(html, "custom fallback");
    assert(!html.includes('role="alert"'));
  });

  it("render() calls a function fallback with the caught error and reset callback", () => {
    const error = new Error("kaboom");
    const instance = new ChatErrorBoundary({
      children: null,
      fallback: (err: Error, reset: () => void) => (
        <div data-testid="fn-fallback" data-has-reset={typeof reset}>
          {err.message}
        </div>
      ),
    });
    instance.state = { hasError: true, error };
    const html = renderToString(instance.render());
    assertStringIncludes(html, "kaboom");
    assertStringIncludes(html, "fn-fallback");
    assertStringIncludes(html, 'data-has-reset="function"');
  });
});

describe("useChatErrorHandler", () => {
  it("starts with no error and hasError false", () => {
    function Probe() {
      const { error, hasError } = useChatErrorHandler();
      return <div data-has-error={String(hasError)}>{error?.message ?? "none"}</div>;
    }
    const html = renderToString(<Probe />);
    assertStringIncludes(html, 'data-has-error="false"');
    assertStringIncludes(html, "none");
  });

  it("exposes handleError and clearError as functions", () => {
    function Probe() {
      const { handleError, clearError } = useChatErrorHandler();
      return (
        <div
          data-handle={typeof handleError}
          data-clear={typeof clearError}
        />
      );
    }
    const html = renderToString(<Probe />);
    assertStringIncludes(html, 'data-handle="function"');
    assertStringIncludes(html, 'data-clear="function"');
  });
});

describe("ChatErrorBoundary lifecycle", () => {
  it("derives its error state from a thrown render error", () => {
    const error = new Error("kaboom");
    assertEquals(
      ChatErrorBoundary.getDerivedStateFromError(error),
      { hasError: true, error },
      "getDerivedStateFromError moves the boundary into its error state",
    );
  });

  it("reports the caught error to onError", () => {
    const error = new Error("kaboom");
    const seen: Array<[Error, React.ErrorInfo]> = [];
    const instance = new ChatErrorBoundary({
      children: null,
      onError: (err, info) => {
        seen.push([err, info]);
      },
    });
    instance.componentDidCatch(error, { componentStack: "\n    in Boom" });
    assertEquals(seen.length, 1, "componentDidCatch notifies onError exactly once");
    assertEquals(seen[0]?.[0], error, "onError receives the caught error");
    assertEquals(
      seen[0]?.[1].componentStack,
      "\n    in Boom",
      "onError receives the React error info",
    );
  });

  it("catches a throwing child and recovers when Try Again is clicked", async () => {
    let failing = true;
    function Flaky(): React.ReactElement {
      if (failing) throw new Error("kaboom");
      return <div data-recovered="">all good again</div>;
    }

    const caught: Error[] = [];
    await mounted(
      <ChatErrorBoundary
        onError={(err) => {
          caught.push(err);
        }}
      >
        <Flaky />
      </ChatErrorBoundary>,
      ({ host, click }) => {
        const alertNode = host.querySelector('[role="alert"]');
        assert(alertNode, "a throwing child renders the boundary fallback");
        assertStringIncludes(
          alertNode!.textContent ?? "",
          "kaboom",
          "the fallback shows the caught error message",
        );
        assertEquals(caught.length, 1, "onError fires once for the caught error");
        assertEquals(caught[0]?.message, "kaboom", "onError receives the thrown error");

        failing = false;
        const tryAgain = Array.from(host.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "Try Again",
        );
        assert(tryAgain, "the default fallback offers a Try Again button");
        click(tryAgain!);

        assertEquals(
          host.querySelector('[role="alert"]'),
          null,
          "reset clears the error state and stops rendering the fallback",
        );
        assert(
          host.querySelector("[data-recovered]"),
          "reset renders the children again",
        );
      },
    );
  });
});

describe("useChatErrorHandler state transitions", () => {
  it("records a handled error and clears it again", async () => {
    let latest: ReturnType<typeof useChatErrorHandler> | undefined;
    function Capture(): null {
      latest = useChatErrorHandler();
      return null;
    }

    await mounted(<Capture />, () => {
      assert(latest, "the hook result is captured");
      assertEquals(latest!.hasError, false, "the hook starts with no error");

      flushSync(() => latest!.handleError(new Error("kaboom")));
      assertEquals(latest!.hasError, true, "handleError flips hasError");
      assertEquals(latest!.error?.message, "kaboom", "handleError stores the caught error");

      flushSync(() => latest!.clearError());
      assertEquals(latest!.hasError, false, "clearError resets hasError");
      assertEquals(latest!.error, null, "clearError drops the stored error");
    });
  });
});
