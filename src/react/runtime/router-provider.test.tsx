import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { waitFor } from "#veryfront/testing/deno-compat.ts";
import {
  PageContextProvider,
  type PageContextValue,
  RouterProvider,
  type RouterValue,
  usePageContext,
  useRouter,
  wrapForHydration,
} from "./core.ts";
import { getNavigationStore } from "../../rendering/client/navigation-store.ts";
import { VeryfrontRouter } from "../../rendering/client/router.ts";

const NAVIGATION_STORE_KEY = Symbol.for("veryfront.navigation.store.v1");

/** Drop the cross-bundle store so each test starts with fresh subscribers. */
function resetNavigationStore(): void {
  delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
}

/**
 * A minimal stand-in for the real client router: it owns navigation (updates the
 * URL) and notifies the shared navigation store — exactly what `RouterProvider`
 * subscribes to via `useSyncExternalStore`. This is the model the real router
 * implements; the provider must not patch history or navigate on its own.
 */
interface FakeRouter {
  navigateCount: number;
  navigate(url: string, push?: boolean, replace?: boolean): Promise<void>;
}

/** Build a `RouterValue` seed from an href — what a caller hands the provider. */
function seedRouter(href: string, params: Record<string, string> = {}): RouterValue {
  const hashIndex = href.indexOf("#");
  const noHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = noHash.indexOf("?");
  const pathname = queryIndex === -1 ? noHash : noHash.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : noHash.slice(queryIndex + 1);
  return {
    domain: "example.com",
    path: pathname,
    pathname,
    params,
    query: Object.fromEntries(new URLSearchParams(search)),
    isPreview: false,
    isMounted: false,
    navigate: async () => {},
    push: async () => {},
    replace: async () => {},
    reload: async () => {},
  };
}

/** A page-context seed carrying only the page-authored fields. */
function seedPage(frontmatter: Record<string, unknown> = {}): PageContextValue {
  return {
    slug: "/",
    path: "/",
    params: {},
    query: {},
    frontmatter,
    headings: [],
    mdxHeadings: [],
  };
}

function installFakeRouter(): FakeRouter {
  const store = getNavigationStore();
  const fake: FakeRouter = {
    navigateCount: 0,
    navigate(url: string, push = true, replace = false): Promise<void> {
      fake.navigateCount++;
      if (replace) globalThis.history.replaceState({}, "", url);
      else if (push) globalThis.history.pushState({}, "", url);
      store.notify();
      return Promise.resolve();
    },
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
    "addEventListener",
    "removeEventListener",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const replacements = {
    window,
    document: window.document,
    navigator: window.navigator,
    self: window,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    history: window.history,
    location: window.location,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  resetNavigationStore();
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    resetNavigationStore();
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
          <RouterProvider router={seedRouter("/?thread=a")}>
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

  it("subscribes on first render even when the router notifies later (no boot race)", async () => {
    // The provider mounts before anything drives navigation. The shared store
    // exists regardless, so the subscription is live from the first render —
    // there is no `setTimeout`/`forceUpdate` retry to win a race with.
    const restore = installDom("https://example.com/?tab=a");
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const r = useRouter();
        return <span>tab:{r.query.tab ?? "none"}</span>;
      };

      flushSync(() => {
        root.render(
          <RouterProvider router={seedRouter("/?tab=a")}>
            <Consumer />
          </RouterProvider>,
        );
      });
      assertStringIncludes(rootElement.textContent ?? "", "tab:a");

      // Only now does a navigation source appear and drive the store directly.
      const store = getNavigationStore();
      globalThis.history.pushState({}, "", "/?tab=b");
      store.notify();
      await tick();

      assertStringIncludes(rootElement.textContent ?? "", "tab:b");

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
          <RouterProvider router={seedRouter("/uploads")}>
            <PageContextProvider pageContext={seedPage()}>
              <Consumer />
            </PageContextProvider>
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

  it("usePageContext() derives location from the router (single source of truth)", async () => {
    const restore = installDom("https://example.com/docs?v=1");
    const router = installFakeRouter();
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const r = useRouter();
        const page = usePageContext();
        // Page context's query/path mirror the router; frontmatter is its own.
        const same = page.query.v === r.query.v && page.path === r.pathname;
        return <span>match:{String(same)}|v:{page.query.v}|fm:{String(page.frontmatter.k)}</span>;
      };

      flushSync(() => {
        root.render(
          <RouterProvider router={seedRouter("/docs?v=1")}>
            <PageContextProvider pageContext={seedPage({ k: "kept" })}>
              <Consumer />
            </PageContextProvider>
          </RouterProvider>,
        );
      });
      assertStringIncludes(rootElement.textContent ?? "", "match:true|v:1|fm:kept");

      await router.navigate("/docs?v=2");
      await tick();
      // Router changed → page context's query tracked it; frontmatter unchanged.
      assertStringIncludes(rootElement.textContent ?? "", "match:true|v:2|fm:kept");

      root.unmount();
    } finally {
      restore();
    }
  });

  it("derives a clean query when the URL carries a hash fragment", () => {
    const restore = installDom("https://example.com/docs?tab=api#install");
    installFakeRouter();
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const r = useRouter();
        return <span>{r.pathname}|tab:{r.query.tab}|keys:{Object.keys(r.query).join(",")}</span>;
      };

      flushSync(() => {
        root.render(
          <RouterProvider router={seedRouter("/docs?tab=api#install")}>
            <Consumer />
          </RouterProvider>,
        );
      });

      // The hash must not leak into the query — only `tab` is present.
      assertStringIncludes(rootElement.textContent ?? "", "/docs|tab:api|keys:tab");

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
          <RouterProvider router={seedRouter("/posts/42?tab=comments", { id: "42" })}>
            <PageContextProvider pageContext={seedPage({ title: "Hello" })}>
              <Consumer />
            </PageContextProvider>
          </RouterProvider>,
        );
      });

      assertStringIncludes(rootElement.textContent ?? "", "42|comments|Hello");

      root.unmount();
    } finally {
      restore();
    }
  });

  it("wrapForHydration seeds the provider from location + params (no React passed in)", () => {
    // The hydration path wraps a child by calling this export on the app's own
    // React — nothing is threaded across the module boundary. It seeds params
    // and frontmatter and derives pathname/query from the live URL.
    const restore = installDom("https://example.com/posts/7?tab=x");
    installFakeRouter();
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const r = useRouter();
        const { frontmatter } = usePageContext();
        return <i>{r.pathname}:{r.params.id}:{r.query.tab}:{String(frontmatter.title)}</i>;
      };

      const tree = wrapForHydration(<Consumer />, {
        params: { id: "7" },
        frontmatter: { title: "Hi" },
      });
      flushSync(() => {
        root.render(tree);
      });

      assertStringIncludes(rootElement.textContent ?? "", "/posts/7:7:x:Hi");

      root.unmount();
    } finally {
      restore();
    }
  });

  it("isMounted is false on the server render and true after mount (hydration-safe)", async () => {
    const Consumer = (): React.ReactElement => {
      const r = useRouter();
      return <b>m:{String(r.isMounted)}</b>;
    };

    // Server render (no effects run) — must be false so it matches the first
    // client render; a consumer's `if (!isMounted)` guard relies on this.
    const restoreServer = installDom("https://example.com/");
    const serverHtml = renderToStaticMarkup(
      <RouterProvider router={seedRouter("/")}>
        <Consumer />
      </RouterProvider>,
    );
    restoreServer();
    assertStringIncludes(serverHtml, "m:false");

    // Client: after the mount effect flushes, it flips to true.
    const restoreClient = installDom("https://example.com/");
    installFakeRouter();
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <RouterProvider router={seedRouter("/")}>
            <Consumer />
          </RouterProvider>,
        );
      });
      await waitFor(
        () => (rootElement.textContent ?? "").includes("m:true"),
        { interval: 10, message: "RouterProvider did not finish its client mount" },
      );
      assertStringIncludes(rootElement.textContent ?? "", "m:true");
      root.unmount();
    } finally {
      restoreClient();
    }
  });

  it("integration: a real VeryfrontRouter navigation re-renders a real useRouter() consumer", async () => {
    const restore = installDom("https://example.com/dashboard?tab=a");
    try {
      // The REAL router and the REAL provider, wired only through the shared
      // navigation store — the end-to-end path this PR fixes. Soft path so the
      // navigation doesn't try to fetch a page in the test.
      const router = new VeryfrontRouter({
        baseUrl: "https://example.com",
        shouldRevalidate: () => false,
      });

      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);

      const Consumer = (): React.ReactElement => {
        const r = useRouter();
        return <span>tab:{r.query.tab ?? "none"}</span>;
      };

      flushSync(() => {
        root.render(
          <RouterProvider router={seedRouter("/dashboard?tab=a")}>
            <Consumer />
          </RouterProvider>,
        );
      });
      assertStringIncludes(rootElement.textContent ?? "", "tab:a");

      // Drive the real router — its notify() must reach the provider's subscription.
      await router.navigate("/dashboard?tab=b");
      await tick();

      assertStringIncludes(rootElement.textContent ?? "", "tab:b");

      root.unmount();
    } finally {
      restore();
    }
  });

  it("a store created by RouterProvider preserves router disposal semantics", async () => {
    const restore = installDom("https://example.com/");
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(<RouterProvider router={seedRouter("/")}>ready</RouterProvider>);
      });
      root.unmount();

      const router = new VeryfrontRouter({ baseUrl: "https://example.com" });
      const loads: string[] = [];
      // deno-lint-ignore no-explicit-any
      (router as any).loadPage = (path: string) => {
        loads.push(path);
        return Promise.resolve();
      };
      router.destroy();

      let assigned = "";
      let replaced = "";
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
          assign(href: string) {
            assigned = href;
          },
          replace(href: string) {
            replaced = href;
          },
          hash: "",
          hostname: "example.com",
          pathname: "/",
          search: "",
        },
        writable: true,
      });

      await getNavigationStore().navigate("/after-destroy");
      assertEquals(loads, []);
      assertEquals(assigned, "/after-destroy");

      await getNavigationStore().navigate("/replace-after-destroy", { history: "replace" });
      assertEquals(replaced, "/replace-after-destroy");
    } finally {
      restore();
    }
  });

  it("first client render matches the SSR snapshot (no hydration mismatch)", () => {
    const url = "https://example.com/posts/42?tab=comments";

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

    // Client first render: reactive branch derives its server snapshot from the
    // same `router` value (via `getServerSnapshot`) — identical markup, one input.
    const restoreClient = installDom(url);
    installFakeRouter();
    const clientHtml = renderToStaticMarkup(
      <RouterProvider router={snapshot}>
        <Consumer />
      </RouterProvider>,
    );
    restoreClient();

    assertEquals(serverHtml, clientHtml);
    assertStringIncludes(serverHtml, "/posts/42:42:comments");
  });
});
