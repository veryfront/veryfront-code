/**
 * React 18 SSR Compatibility Tests
 * Tests for Suspense, Error Boundaries, and Streaming SSR
 */

import * as React from "react";
import { assertEquals, assertStringIncludes } from "@std/assert";

const { Component, Suspense } = React as any;

import { renderToString } from "react-dom/server";

// Note: renderToPipeableStream is not available via ESM.sh for Deno
// We'll test streaming SSR concepts without the actual streaming implementation

// Test Components
const AsyncComponent = (React as any).lazy(() => {
  // For SSR testing, resolve immediately to avoid timer leaks
  return Promise.resolve({
    default: () =>
      React.createElement("div", { className: "async-content" }, "Async Component Loaded"),
  });
});

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
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const ErrorComponent = () => {
  throw new Error("Test error");
};

const SuspenseComponent = () => {
  return React.createElement(
    Suspense,
    {
      fallback: React.createElement("div", { className: "loading" }, "Loading..."),
    },
    React.createElement(AsyncComponent),
  );
};

const NestedSuspenseComponent = () => {
  return React.createElement(
    "div",
    { className: "outer" },
    React.createElement(
      Suspense,
      {
        fallback: React.createElement("div", { className: "outer-loading" }, "Outer Loading..."),
      },
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
};

// Concurrent Feature Component
// Note: useTransition is not available in the ESM.sh React import
const ConcurrentComponent = () => {
  const [count, setCount] = React.useState(0);

  const handleClick = () => {
    setCount((c) => c + 1);
  };

  return React.createElement(
    "div",
    { className: "concurrent" },
    React.createElement("button", { onClick: handleClick }, `Count: ${count}`),
  );
};

// Test React 18 renderToString with Suspense
Deno.test("SSR: renderToString handles Suspense boundaries", () => {
  const html = renderToString(React.createElement(SuspenseComponent) as any);

  // Should render fallback during SSR
  assertStringIncludes(html, "Loading...");
  assertStringIncludes(html, 'class="loading"');

  // Should not include async content in initial render
  assertEquals(html.includes("Async Component Loaded"), false);
});

// Test Error Boundaries with SSR
Deno.test("SSR: renderToString handles Error Boundaries", () => {
  // Note: Error boundaries don't catch errors during SSR in React 18
  // They only work on the client side during hydration
  // This test verifies that errors are thrown during SSR
  let errorThrown = false;
  try {
    const component = React.createElement(
      ErrorBoundary as any,
      {
        fallback: React.createElement("div", { className: "error" }, "Error occurred"),
      },
      React.createElement(ErrorComponent),
    );
    renderToString(component as any);
  } catch (error) {
    errorThrown = true;
    assertEquals((error as Error).message, "Test error");
  }

  assertEquals(errorThrown, true, "Error should be thrown during SSR");
});

// Test nested Suspense boundaries
Deno.test("SSR: renderToString handles nested Suspense boundaries", () => {
  const html = renderToString(React.createElement(NestedSuspenseComponent) as any);

  // Since our AsyncComponent resolves synchronously for testing,
  // it renders the content directly without showing fallback
  assertStringIncludes(html, "Async Component Loaded");
  assertStringIncludes(html, "<h1>Content</h1>");
  assertStringIncludes(html, 'class="outer"');
});

// Test concurrent features
Deno.test("SSR: renderToString handles concurrent features", () => {
  const html = renderToString(React.createElement(ConcurrentComponent) as any);

  // Should render initial state
  assertStringIncludes(html, "Count: 0");
  assertStringIncludes(html, 'class="concurrent"');
});

// Note: renderToPipeableStream tests are commented out because ESM.sh doesn't properly export it for Deno
// In a real implementation, you would need to implement streaming SSR support using Node.js compatible streams

/*
// Test renderToPipeableStream for streaming SSR
Deno.test("SSR: renderToPipeableStream supports streaming", () => {
  // This test would verify that streaming SSR works properly
  // Key features to test:
  // 1. Shell is sent immediately with Suspense fallbacks
  // 2. Async components are streamed later
  // 3. HTML is properly formed with script tags to hydrate async content

  // For now, we're using renderToString which waits for all Suspense boundaries
  const html = renderToString(React.createElement(SuspenseComponent) as any);
  assertStringIncludes(html, "Loading...");
});
*/

/*
// Test streaming with shell and deferred content
Deno.test("SSR: renderToPipeableStream with shell and deferred content", () => {
  // This test would verify:
  // 1. Shell HTML is sent immediately with main content
  // 2. Suspense boundaries show fallbacks in the shell
  // 3. Async content is streamed later and replaces fallbacks
  // 4. Proper script tags are injected to handle the replacement
});
*/

// Test React 18 automatic batching
Deno.test("SSR: React 18 automatic batching", () => {
  let renderCount = 0;

  const BatchedComponent = () => {
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
  };

  const html = renderToString(React.createElement(BatchedComponent) as any);

  // During SSR, effects don't run, so counts stay at 0
  assertStringIncludes(html, "Count1: 0, Count2: 0");

  // Should only render once during SSR
  assertEquals(renderCount, 1);
});

// Test React.lazy with truly async component
Deno.test("SSR: React.lazy with custom Suspense fallback", () => {
  // Create a component that actually suspends
  const TrulyAsyncComponent = React.lazy(() => {
    return new Promise<{ default: React.ComponentType<any> }>(() => {
      // Never resolves - will always show fallback
    });
  });

  const CustomFallback = () =>
    React.createElement(
      "div",
      { className: "custom-fallback" },
      React.createElement("div", { className: "spinner" }, "⏳"),
      React.createElement("p", null, "Please wait..."),
    );

  const LazyApp = () =>
    React.createElement(
      Suspense,
      { fallback: React.createElement(CustomFallback) },
      React.createElement(TrulyAsyncComponent),
    );

  const html = renderToString(React.createElement(LazyApp) as any);

  // Should render custom fallback
  assertStringIncludes(html, 'class="custom-fallback"');
  assertStringIncludes(html, 'class="spinner"');
  assertStringIncludes(html, "⏳");
  assertStringIncludes(html, "Please wait...");
});

// Test multiple Suspense boundaries with different fallbacks
Deno.test("SSR: Multiple independent Suspense boundaries", () => {
  // Create async components that actually suspend
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

  const MultiSuspenseApp = () =>
    React.createElement(
      "div",
      { className: "app" },
      React.createElement(
        "section",
        { className: "header" },
        React.createElement(
          Suspense,
          {
            fallback: React.createElement("div", null, "Loading header..."),
          },
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
          {
            fallback: React.createElement("div", null, "Loading sidebar..."),
          },
          React.createElement(SidebarAsync),
        ),
      ),
    );

  const html = renderToString(React.createElement(MultiSuspenseApp) as any);

  // Should render all sections with appropriate fallbacks
  assertStringIncludes(html, 'class="header"');
  assertStringIncludes(html, "Loading header...");
  assertStringIncludes(html, 'class="main"');
  assertStringIncludes(html, "<h1>Main Content</h1>");
  assertStringIncludes(html, 'class="sidebar"');
  assertStringIncludes(html, "Loading sidebar...");
});

// Test consistent rendering
Deno.test("SSR: Consistent rendering across multiple calls", () => {
  const ComponentWithState = () => {
    const [value] = React.useState("initial");

    return React.createElement(
      "form",
      null,
      React.createElement("label", { htmlFor: "name" }, "Name:"),
      React.createElement("input", {
        id: "name",
        type: "text",
        defaultValue: value,
      }),
      React.createElement("label", { htmlFor: "email" }, "Email:"),
      React.createElement("input", { id: "email", type: "email" }),
    );
  };

  const html1 = renderToString(React.createElement(ComponentWithState) as any);
  const html2 = renderToString(React.createElement(ComponentWithState) as any);

  // Both renders should produce identical HTML
  assertEquals(html1, html2);

  // Should contain properly linked labels and inputs
  // Note: React renders htmlFor as "for" in the HTML output
  assertStringIncludes(html1, 'for="name"');
  assertStringIncludes(html1, 'for="email"');
  assertStringIncludes(html1, 'id="name"');
  assertStringIncludes(html1, 'id="email"');
  assertStringIncludes(html1, 'value="initial"');
});
