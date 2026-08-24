import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { MDXComponents } from "#veryfront/types";
import { MDXProvider, useMDXComponents } from "./index.ts";

function OuterHeading({ children }: React.ComponentProps<"h1">): React.ReactElement {
  return <h1 data-source="outer">{children}</h1>;
}

function InnerHeading({ children }: React.ComponentProps<"h1">): React.ReactElement {
  return <h1 data-source="inner">{children}</h1>;
}

function OuterLink({ children, ...props }: React.ComponentProps<"a">): React.ReactElement {
  return (
    <a {...props} data-source="outer">
      {children}
    </a>
  );
}

function LocalCode({ children }: React.ComponentProps<"code">): React.ReactElement {
  return <code data-source="local">{children}</code>;
}

function ComponentProbe(): React.ReactElement {
  const components = useMDXComponents({ code: LocalCode });
  const Heading = components.h1 ?? "h1";
  const Link = components.a ?? "a";
  const Code = components.code ?? "code";

  return (
    <>
      <Heading>Heading</Heading>
      <Link href="/docs">Link</Link>
      <Code>Code</Code>
    </>
  );
}

describe("veryfront/mdx provider behavior", () => {
  it("composes nested providers and gives nearer overrides precedence", () => {
    const html = renderToString(
      <MDXProvider components={{ h1: OuterHeading, a: OuterLink }}>
        <MDXProvider components={{ h1: InnerHeading }}>
          <ComponentProbe />
        </MDXProvider>
        <ComponentProbe />
      </MDXProvider>,
    );

    assertStringIncludes(html, '<h1 data-source="inner">Heading</h1>');
    assertStringIncludes(html, '<a href="/docs" data-source="outer">Link</a>');
    assertStringIncludes(html, '<code data-source="local">Code</code>');
    assertStringIncludes(
      html,
      '<h1 data-source="outer">Heading</h1>',
      "a nested provider must not leak its overrides into sibling subtrees",
    );

    const bare = renderToString(<ComponentProbe />);

    assertStringIncludes(
      bare,
      "<h1>Heading</h1>",
      "provider merges must not pollute the default MDX context",
    );
  });

  it("returns the same merged map while provider inputs are unchanged", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
      { url: "https://example.com/" },
    );
    const browserGlobals = globalThis as unknown as Record<string, unknown>;
    const keys = ["window", "document", "navigator", "Node", "Element", "HTMLElement"] as const;
    const previous = new Map(
      keys.map((key) => [key, Object.getOwnPropertyDescriptor(browserGlobals, key)] as const),
    );

    const seen: MDXComponents[] = [];
    const components: MDXComponents = { h1: OuterHeading };
    let root: ReturnType<typeof createRoot> | undefined;

    function Capture(): null {
      seen.push(useMDXComponents());
      return null;
    }

    try {
      Object.assign(browserGlobals, {
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        Node: dom.window.Node,
        Element: dom.window.Element,
        HTMLElement: dom.window.HTMLElement,
      });
      const rootElement = document.getElementById("root");
      assert(rootElement, "Expected root element to exist");
      const mountedRoot = createRoot(rootElement);
      root = mountedRoot;
      const render = () => (
        <MDXProvider components={components}>
          <Capture />
        </MDXProvider>
      );

      flushSync(() => mountedRoot.render(render()));
      flushSync(() => mountedRoot.render(render()));

      assertEquals(seen.length, 2);
      assertStrictEquals(seen[0], seen[1]);
    } finally {
      const mountedRoot = root;
      if (mountedRoot) flushSync(() => mountedRoot.unmount());
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(browserGlobals, key, descriptor);
        else delete browserGlobals[key];
      }
      dom.window.close();
    }
  });
});
