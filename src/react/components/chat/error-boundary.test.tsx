import type * as React from "react";
import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatErrorBoundary, useChatErrorHandler } from "./error-boundary.tsx";

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
    assert(threw, "legacy synchronous renderToString does not run componentDidCatch");
  });

  it("render() produces the default alert fallback with the Try Again button once state has an error", () => {
    const instance = Object.create(ChatErrorBoundary.prototype);
    instance.state = { hasError: true, error: new Error("kaboom") };
    instance.props = { children: null };
    instance.reset = () => undefined;
    const html = renderToString(instance.render());
    assertStringIncludes(html, 'role="alert"');
    assertStringIncludes(html, "An error occurred in the chat component");
    assertStringIncludes(html, "kaboom");
    assertStringIncludes(html, "Try Again");
  });

  it("render() uses a custom errorMessage in place of the default heading", () => {
    const instance = Object.create(ChatErrorBoundary.prototype);
    instance.state = { hasError: true, error: new Error("kaboom") };
    instance.props = { children: null, errorMessage: "Custom failure banner" };
    instance.reset = () => undefined;
    const html = renderToString(instance.render());
    assertStringIncludes(html, "Custom failure banner");
    assert(!html.includes("An error occurred in the chat component"));
  });

  it("render() renders a node fallback in place of the default UI", () => {
    const instance = Object.create(ChatErrorBoundary.prototype);
    instance.state = { hasError: true, error: new Error("kaboom") };
    instance.props = {
      children: null,
      fallback: <div data-testid="custom-fallback">custom fallback</div>,
    };
    instance.reset = () => undefined;
    const html = renderToString(instance.render());
    assertStringIncludes(html, "custom fallback");
    assert(!html.includes('role="alert"'));
  });

  it("render() calls a function fallback with the caught error and reset callback", () => {
    const instance = Object.create(ChatErrorBoundary.prototype);
    const error = new Error("kaboom");
    instance.state = { hasError: true, error };
    instance.props = {
      children: null,
      fallback: (err: Error, reset: () => void) => (
        <div data-testid="fn-fallback" data-has-reset={typeof reset}>{err.message}</div>
      ),
    };
    instance.reset = () => undefined;
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
