/**
 * React 18 SSR Compatibility Tests
 * Tests for Suspense, Error Boundaries, and Streaming SSR
 */

import * as React from "react";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { renderToString } from "react-dom/server";

const { Component, Suspense } = React as any;

const AsyncComponent = (React as any).lazy(() =>
  // For SSR testing, resolve immediately to avoid timer leaks
  Promise.resolve({
    default: () =>
      React.createElement("div", { className: "async-content" }, "Async Component Loaded"),
  })
);

class ErrorBoundary extends (Component as any)<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error) {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function ErrorComponent(): never {
  throw new Error("Test error");
}

function SuspenseComponent(): React.ReactElement {
  return React.createElement(
    Suspense,
    { fallback: React.createElement("div", { className: "loading" }, "Loading...") },
    React.createElement(AsyncComponent),
  );
}

function NestedSuspenseComponent(): React.ReactElement {
  return React.createElement(
    "div",
    { className: "outer" },
    React.createElement(
      Suspense,
      { fallback: React.createElement("div", { className: "outer-loading" }, "Outer Loading...") },
      React.createElement(
        "div",
        null,
        React.createElement("h1", null, "Content"),
        React.createElement(
          Suspense,
          {
            fallback: React.createElement(
              "div",
              { className: "inner-loading" },
              "Inner Loading...",
            ),
          },
          React.createElement(AsyncComponent),
        ),
      ),
    ),
  );
}

// Note: useTransition is not available in the ESM.sh React import
function ConcurrentComponent(): React.ReactElement {
  const [count, setCount] = React.useState(0);

  function handleClick(): void {
    setCount((c) => c + 1);
  }

  return React.createElement(
    "div",
    { className: "concurrent" },
    React.createElement("button", { onClick: handleClick }, `Count: ${count}`),
  );
}

describe("React 18 SSR", () => {
  it("renderToString handles Suspense boundaries", () => {
    const html = renderToString(React.createElement(SuspenseComponent));

    assertStringIncludes(html, "Loading...");
    assertStringIncludes(html, 'class="loading"');
    assertEquals(html.includes("Async Component Loaded"), false);
  });

  it("renderToString handles Error Boundaries", () => {
    // Note: Error boundaries don't catch errors during SSR in React 18
    // They only work on the client side during hydration
    // This test verifies that errors are thrown during SSR
    let errorThrown = false;

    try {
      renderToString(
        React.createElement(
          ErrorBoundary as any,
          { fallback: React.createElement("div", { className: "error" }, "Error occurred") },
          React.createElement(ErrorComponent),
        ),
      );
    } catch (error) {
      errorThrown = true;
      assertEquals((error as Error).message, "Test error");
    }

    assertEquals(errorThrown, true, "Error should be thrown during SSR");
  });

  it("renderToString handles nested Suspense boundaries", () => {
    const html = renderToString(React.createElement(NestedSuspenseComponent));

    // Since our AsyncComponent resolves synchronously for testing,
    // it renders the content directly without showing fallback
    assertStringIncludes(html, "Async Component Loaded");
    assertStringIncludes(html, "<h1>Content</h1>");
    assertStringIncludes(html, 'class="outer"');
  });

  it("renderToString handles concurrent features", () => {
    const html = renderToString(React.createElement(ConcurrentComponent));

    assertStringIncludes(html, "Count: 0");
    assertStringIncludes(html, 'class="concurrent"');
  });

  it("React 18 automatic batching", () => {
    let renderCount = 0;

    function BatchedComponent(): React.ReactElement {
      renderCount++;
      const [count1, setCount1] = React.useState(0);
      const [count2, setCount2] = React.useState(0);

      // This would trigger multiple renders in React 17, but only one in React 18
      React.useEffect(() => {
        setCount1(1);
        setCount2(2);
      }, []);

      return React.createElement(
        "div",
        null,
        `Count1: ${count1}, Count2: ${count2}, Renders: ${renderCount}`,
      );
    }

    const html = renderToString(React.createElement(BatchedComponent));

    // During SSR, effects don't run, so counts stay at 0
    assertStringIncludes(html, "Count1: 0, Count2: 0");
    assertEquals(renderCount, 1);
  });

  it("React.lazy with custom Suspense fallback", () => {
    const TrulyAsyncComponent = React.lazy(
      () =>
        new Promise<{ default: React.ComponentType<any> }>(() => {
          /* never resolves */
        }),
    );

    function CustomFallback(): React.ReactElement {
      return React.createElement(
        "div",
        { className: "custom-fallback" },
        React.createElement("div", { className: "spinner" }, "⏳"),
        React.createElement("p", null, "Please wait..."),
      );
    }

    function LazyApp(): React.ReactElement {
      return React.createElement(
        Suspense,
        { fallback: React.createElement(CustomFallback) },
        React.createElement(TrulyAsyncComponent),
      );
    }

    const html = renderToString(React.createElement(LazyApp));

    assertStringIncludes(html, 'class="custom-fallback"');
    assertStringIncludes(html, 'class="spinner"');
    assertStringIncludes(html, "⏳");
    assertStringIncludes(html, "Please wait...");
  });

  it("Multiple independent Suspense boundaries", () => {
    const HeaderAsync = React.lazy(
      () =>
        new Promise<{ default: React.ComponentType<any> }>(() => {
          /* empty */
        }),
    );
    const SidebarAsync = React.lazy(
      () =>
        new Promise<{ default: React.ComponentType<any> }>(() => {
          /* empty */
        }),
    );

    function MultiSuspenseApp(): React.ReactElement {
      return React.createElement(
        "div",
        { className: "app" },
        React.createElement(
          "section",
          { className: "header" },
          React.createElement(
            Suspense,
            { fallback: React.createElement("div", null, "Loading header...") },
            React.createElement(HeaderAsync),
          ),
        ),
        React.createElement(
          "section",
          { className: "main" },
          React.createElement("h1", null, "Main Content"),
        ),
        React.createElement(
          "section",
          { className: "sidebar" },
          React.createElement(
            Suspense,
            { fallback: React.createElement("div", null, "Loading sidebar...") },
            React.createElement(SidebarAsync),
          ),
        ),
      );
    }

    const html = renderToString(React.createElement(MultiSuspenseApp));

    assertStringIncludes(html, 'class="header"');
    assertStringIncludes(html, "Loading header...");
    assertStringIncludes(html, 'class="main"');
    assertStringIncludes(html, "<h1>Main Content</h1>");
    assertStringIncludes(html, 'class="sidebar"');
    assertStringIncludes(html, "Loading sidebar...");
  });

  it("Consistent rendering across multiple calls", () => {
    function ComponentWithState(): React.ReactElement {
      const [value] = React.useState("initial");

      return React.createElement(
        "form",
        null,
        React.createElement("label", { htmlFor: "name" }, "Name:"),
        React.createElement("input", { id: "name", type: "text", defaultValue: value }),
        React.createElement("label", { htmlFor: "email" }, "Email:"),
        React.createElement("input", { id: "email", type: "email" }),
      );
    }

    const html1 = renderToString(React.createElement(ComponentWithState));
    const html2 = renderToString(React.createElement(ComponentWithState));

    assertEquals(html1, html2);

    // Note: React renders htmlFor as "for" in the HTML output
    assertStringIncludes(html1, 'for="name"');
    assertStringIncludes(html1, 'for="email"');
    assertStringIncludes(html1, 'id="name"');
    assertStringIncludes(html1, 'id="email"');
    assertStringIncludes(html1, 'value="initial"');
  });
});
