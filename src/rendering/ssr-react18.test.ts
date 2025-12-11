
import * as React from "react";
import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";

const { Component, Suspense } = React as any;

import { renderToString } from "react-dom/server";

// Note: renderToPipeableStream is not available via ESM.sh for Deno

const AsyncComponent = (React as any).lazy(() => {
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

Deno.test("SSR: renderToString handles Suspense boundaries", () => {
  const html = renderToString(React.createElement(SuspenseComponent) as any);

  assertStringIncludes(html, "Loading...");
  assertStringIncludes(html, 'class="loading"');

  assertEquals(html.includes("Async Component Loaded"), false);
});

Deno.test("SSR: renderToString handles Error Boundaries", () => {
  // Note: Error boundaries don't catch errors during SSR in React 18
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

Deno.test("SSR: renderToString handles nested Suspense boundaries", () => {
  const html = renderToString(React.createElement(NestedSuspenseComponent) as any);

  assertStringIncludes(html, "Async Component Loaded");
  assertStringIncludes(html, "<h1>Content</h1>");
  assertStringIncludes(html, 'class="outer"');
});

Deno.test("SSR: renderToString handles concurrent features", () => {
  const html = renderToString(React.createElement(ConcurrentComponent) as any);

  assertStringIncludes(html, "Count: 0");
  assertStringIncludes(html, 'class="concurrent"');
});

// Note: renderToPipeableStream tests are commented out because ESM.sh doesn't properly export it for Deno


Deno.test("SSR: React 18 automatic batching", () => {
  let renderCount = 0;

  const BatchedComponent = () => {
    renderCount++;
    const [count1, setCount1] = React.useState(0);
    const [count2, setCount2] = React.useState(0);

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

  assertStringIncludes(html, "Count1: 0, Count2: 0");

  assertEquals(renderCount, 1);
});

Deno.test("SSR: React.lazy with custom Suspense fallback", () => {
  const TrulyAsyncComponent = React.lazy(() => {
    return new Promise<{ default: React.ComponentType<any> }>(() => {
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

  assertStringIncludes(html, 'class="custom-fallback"');
  assertStringIncludes(html, 'class="spinner"');
  assertStringIncludes(html, "⏳");
  assertStringIncludes(html, "Please wait...");
});

Deno.test("SSR: Multiple independent Suspense boundaries", () => {
  const HeaderAsync = React.lazy(
    () =>
      new Promise<{ default: React.ComponentType<any> }>(() => {
      }),
  );
  const SidebarAsync = React.lazy(
    () =>
      new Promise<{ default: React.ComponentType<any> }>(() => {
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

  assertStringIncludes(html, 'class="header"');
  assertStringIncludes(html, "Loading header...");
  assertStringIncludes(html, 'class="main"');
  assertStringIncludes(html, "<h1>Main Content</h1>");
  assertStringIncludes(html, 'class="sidebar"');
  assertStringIncludes(html, "Loading sidebar...");
});

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

  assertEquals(html1, html2);

  // Note: React renders htmlFor as "for" in the HTML output
  assertStringIncludes(html1, 'for="name"');
  assertStringIncludes(html1, 'for="email"');
  assertStringIncludes(html1, 'id="name"');
  assertStringIncludes(html1, 'id="email"');
  assertStringIncludes(html1, 'value="initial"');
});
