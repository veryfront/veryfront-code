import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RouterProvider, type RouterValue, usePageContext, useRouter } from "./core.ts";

/**
 * A minimal stand-in for `veryFrontRouter`'s reactive surface: it owns
 * navigation (updates the URL) and notifies subscribers — exactly what
 * `RouterProvider` subscribes to via `useSyncExternalStore`. This is the
 * react-router model the real router implements; the provider must not patch
 * history or navigate on its own.
 */
interface FakeRouter {
  navigateCount: number;
  navigate(url: string, push?: boolean, replace?: boolean): Promise<void>;
}

function installFakeRouter(): FakeRouter {
  const listeners = new Set<() => void>();
  const fake: FakeRouter = {
    navigateCount: 0,
    navigate(url: string, push = true, replace = false): Promise<void> {
      fake.navigateCount++;
      if (replace) globalThis.history.replaceState({}, "", url);
      else if (push) globalThis.history.pushState({}, "", url);
      for (const listener of listeners) listener();
      return Promise.resolve();
    },
  };
  (globalThis as Record<string, unknown>).veryFrontRouter = {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCurrentHref(): string {
      return `${globalThis.location.pathname}${globalThis.location.search}`;
    },
    navigate: fake.navigate,
  };
  return fake;
}

function installDom(url: string): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "history",
    "location",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    history: window.history,
    location: window.location,
  });
  return () => {
    Object.assign(globalThis, previous);
    delete (globalThis as Record<string, unknown>).veryFrontRouter;
    dom.window.close();
  };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("react/runtime/RouterProvider (reactive)", () => {
  it("re-renders useRouter().query on a query-only navigation (no page load)", async () => {
    const restore = installDom("https://example.com/?thread=a");
    const router = installFakeRouter();
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const r = useRouter();
        return <span>thread:{r.query.thread ?? "none"}</span>;
      };

      flushSync(() => {
        root.render(
          <RouterProvider initialHref="/?thread=a">
            <Consumer />
          </RouterProvider>,
        );
      });
      assertStringIncludes(rootElement.textContent ?? "", "thread:a");

      // A query-only navigation through the router — no second navigation, no
      // page reload; the router notifies and the provider re-renders.
      await router.navigate("/?thread=b");
      await tick();

      assertStringIncludes(rootElement.textContent ?? "", "thread:b");
      assertEquals(router.navigateCount, 1);

      root.unmount();
    } finally {
      restore();
    }
  });

  it("re-renders usePageContext().query and useRouter().pathname on navigation", async () => {
    const restore = installDom("https://example.com/uploads");
    const router = installFakeRouter();
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const { query } = usePageContext();
        const r = useRouter();
        return <span>{r.pathname}|{query.thread ?? "none"}</span>;
      };

      flushSync(() => {
        root.render(
          <RouterProvider initialHref="/uploads">
            <Consumer />
          </RouterProvider>,
        );
      });
      assertStringIncludes(rootElement.textContent ?? "", "/uploads|none");

      await router.navigate("/?thread=x");
      await tick();

      assertStringIncludes(rootElement.textContent ?? "", "/|x");

      root.unmount();
    } finally {
      restore();
    }
  });

  it("seeds params and frontmatter from props, and derives query from the URL", async () => {
    const restore = installDom("https://example.com/posts/42?tab=comments");
    installFakeRouter();
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const r = useRouter();
        const { frontmatter } = usePageContext();
        return (
          <span>
            {r.params.id}|{r.query.tab}|{String(frontmatter.title)}
          </span>
        );
      };

      flushSync(() => {
        root.render(
          <RouterProvider
            initialHref="/posts/42?tab=comments"
            params={{ id: "42" }}
            frontmatter={{ title: "Hello" }}
          >
            <Consumer />
          </RouterProvider>,
        );
      });

      assertStringIncludes(rootElement.textContent ?? "", "42|comments|Hello");

      root.unmount();
    } finally {
      restore();
    }
  });

  it("first client render matches the SSR snapshot (no hydration mismatch)", () => {
    const url = "https://example.com/posts/42?tab=comments";
    const initialHref = "/posts/42?tab=comments";

    const Consumer = (): React.ReactElement => {
      const r = useRouter();
      return <b>{r.pathname}:{r.params.id}:{r.query.tab}</b>;
    };

    // Server render: static snapshot branch (as produced by SSR).
    const restoreServer = installDom(url);
    (globalThis as Record<string, unknown>).__VERYFRONT_SSR__ = true;
    const snapshot: RouterValue = {
      domain: "example.com",
      path: "/posts/42",
      pathname: "/posts/42",
      params: { id: "42" },
      query: { tab: "comments" },
      isPreview: false,
      isMounted: false,
      navigate: async () => {},
      push: async () => {},
      replace: async () => {},
      reload: async () => {},
    };
    const serverHtml = renderToStaticMarkup(
      <RouterProvider router={snapshot}>
        <Consumer />
      </RouterProvider>,
    );
    delete (globalThis as Record<string, unknown>).__VERYFRONT_SSR__;
    restoreServer();

    // Client first render: reactive branch reads the server snapshot via
    // `getServerSnapshot` (= initialHref) — so it must produce identical markup.
    const restoreClient = installDom(url);
    installFakeRouter();
    const clientHtml = renderToStaticMarkup(
      <RouterProvider initialHref={initialHref} params={{ id: "42" }}>
        <Consumer />
      </RouterProvider>,
    );
    restoreClient();

    assertEquals(serverHtml, clientHtml);
    assertStringIncludes(serverHtml, "/posts/42:42:comments");
  });
});
