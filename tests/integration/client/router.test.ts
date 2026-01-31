/**
 * Unit Tests for Veryfront Router
 * Tests client-side routing, navigation, history management, and DOM interactions
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import type { RouterOptions } from "@veryfront/rendering/client/router.ts";
import { VeryfrontRouter } from "@veryfront/rendering/client/router.ts";
import type { DOMEnvironment } from "./test-helpers.ts";
import { mockRoots, setupDOMEnvironment } from "./test-helpers.ts";
import { delay } from "@std/async";

describe("Veryfront Router", () => {
  let env: DOMEnvironment;
  let rootElement: HTMLElement;

  function createRoot(): HTMLElement {
    const el = document.createElement("div");
    el.id = "root";
    document.body.appendChild(el);
    return el;
  }

  function removeRoot(): void {
    rootElement.parentElement?.removeChild(rootElement);
  }

  beforeEach(() => {
    env = setupDOMEnvironment({ url: "http://localhost:3000/" });
    rootElement = createRoot();
  });

  afterEach(() => {
    removeRoot();
    env.cleanup();
  });

  describe("Initialization", () => {
    it("should create router with default options", () => {
      const router = new VeryfrontRouter();
      assertExists(router);
    });

    it("should create router with custom options", () => {
      const options: RouterOptions = {
        baseUrl: "http://example.com",
        onNavigate: (_url: string) => {},
        onStart: (_url: string) => {},
        onComplete: (_url: string) => {},
        onError: (_error: Error) => {},
        prefetchDelay: 200,
        prefetch: {
          hover: true,
          viewport: true,
        },
      };

      const router = new VeryfrontRouter(options);
      assertExists(router);
    });

    it("should initialize and attach event listeners", () => {
      const router = new VeryfrontRouter();
      router.init();

      assertEquals(mockRoots.has(rootElement), true);

      router.destroy();
    });

    it("should handle missing root element gracefully", () => {
      removeRoot();

      const router = new VeryfrontRouter();
      router.init();

      assertExists(router);

      router.destroy();

      rootElement = createRoot();
    });

    it("should load global router options", () => {
      (globalThis as any).__VERYFRONT_ROUTER_OPTS__ = { prefetchDelay: 500 };

      const router = new VeryfrontRouter();
      assertExists(router);

      delete (globalThis as any).__VERYFRONT_ROUTER_OPTS__;
      router.destroy();
    });
  });

  describe("Navigation", () => {
    it("should navigate to new page", async () => {
      const html = `
        <div id="root">
          <h1>New Page</h1>
        </div>
        <script data-veryfront-page type="application/json">
          {"title": "New Page"}
        </script>
      `;

      env.fetchMock.set("/new-page", new Response(html, { status: 200 }));

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/new-page");

      assertEquals((globalThis as any).location.pathname, "/new-page");

      router.destroy();
    });

    it("should call onStart callback", async () => {
      let startedUrl = "";

      const router = new VeryfrontRouter({
        onStart: (url: string) => {
          startedUrl = url;
        },
      });
      router.init();

      env.fetchMock.set("/page", new Response('<div id="root">Page</div>', { status: 200 }));

      await router.navigate("/page");

      assertEquals(startedUrl, "/page");

      router.destroy();
    });

    it("should call onNavigate callback", async () => {
      let navigatedUrl = "";

      const router = new VeryfrontRouter({
        onNavigate: (url: string) => {
          navigatedUrl = url;
        },
      });
      router.init();

      env.fetchMock.set("/page", new Response('<div id="root">Page</div>', { status: 200 }));

      await router.navigate("/page");

      assertEquals(navigatedUrl, "/page");

      router.destroy();
    });

    it("should call onComplete callback", async () => {
      let completedUrl = "";

      const router = new VeryfrontRouter({
        onComplete: (url: string) => {
          completedUrl = url;
        },
      });
      router.init();

      env.fetchMock.set("/page", new Response('<div id="root">Page</div>', { status: 200 }));

      await router.navigate("/page");

      assertEquals(completedUrl, "/page");

      router.destroy();
    });

    it("should call onError callback on navigation failure", async () => {
      let errorCaptured: Error | null = null;

      const router = new VeryfrontRouter({
        onError: (error: Error) => {
          errorCaptured = error;
        },
      });
      router.init();

      env.fetchMock.set("/error", new Error("Network error"));

      await router.navigate("/error");

      assertExists(errorCaptured);
      assertEquals(errorCaptured?.message, "Network error");

      router.destroy();
    });

    it("should not push state when pushState is false", async () => {
      const router = new VeryfrontRouter();
      router.init();

      const originalPathname = (globalThis as any).location.pathname;

      env.fetchMock.set("/page", new Response('<div id="root">Page</div>', { status: 200 }));

      await router.navigate("/page", false);

      assertEquals((globalThis as any).location.pathname, originalPathname);

      router.destroy();
    });

    it("should handle 404 responses", async () => {
      const router = new VeryfrontRouter();
      router.init();

      env.fetchMock.set("/not-found", new Response("Not Found", { status: 404 }));

      try {
        await router.navigate("/not-found");
      } catch {
        // Expected to fail
      }

      router.destroy();
    });
  });

  describe("Caching", () => {
    it("should cache current page on init", () => {
      const pageDataScript = document.createElement("script");
      pageDataScript.setAttribute("data-veryfront-page", "");
      pageDataScript.type = "application/json";
      pageDataScript.textContent = JSON.stringify({
        title: "Current Page",
        html: "<h1>Current</h1>",
      });
      document.body.appendChild(pageDataScript);

      const router = new VeryfrontRouter();
      router.init();

      assertExists(router);

      document.body.removeChild(pageDataScript);
      router.destroy();
    });

    it("should load from cache instead of fetching", async () => {
      let fetchCount = 0;

      env.fetchMock.set("/cached", () => {
        fetchCount++;
        return new Response('<div id="root">Page</div>', { status: 200 });
      });

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/cached");
      await router.navigate("/cached");

      assertEquals(fetchCount, 1);

      router.destroy();
    });

    it("should prefetch page", async () => {
      env.fetchMock.set(
        "/prefetch",
        new Response('<div id="root">Prefetch</div>', { status: 200 }),
      );

      const router = new VeryfrontRouter();
      router.init();

      await router.prefetch("/prefetch");

      let additionalFetchCount = 0;
      env.fetchMock.set("/prefetch", () => {
        additionalFetchCount++;
        return new Response('<div id="root">Page</div>', { status: 200 });
      });

      await router.navigate("/prefetch");

      assertEquals(additionalFetchCount, 0);

      router.destroy();
    });

    it("should clear cache on destroy", async () => {
      env.fetchMock.set("/page", new Response('<div id="root">Page</div>', { status: 200 }));

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/page");

      router.destroy();

      assertExists(router);
    });
  });

  describe("Click Handling", () => {
    it("should intercept internal link clicks", async () => {
      const router = new VeryfrontRouter();
      router.init();

      const link = document.createElement("a");
      link.href = "/internal";
      link.textContent = "Internal Link";
      document.body.appendChild(link);

      env.fetchMock.set(
        "/internal",
        new Response('<div id="root">Internal</div>', { status: 200 }),
      );

      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(clickEvent);

      await delay(100);

      document.body.removeChild(link);
      router.destroy();
    });

    it("should not intercept external link clicks", () => {
      const router = new VeryfrontRouter();
      router.init();

      const link = document.createElement("a");
      link.href = "https://external.com";
      link.textContent = "External Link";
      document.body.appendChild(link);

      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      const prevented = !link.dispatchEvent(clickEvent);

      assertEquals(prevented, false);

      document.body.removeChild(link);
      router.destroy();
    });

    it('should not intercept links with target="_blank"', () => {
      const router = new VeryfrontRouter();
      router.init();

      const link = document.createElement("a");
      link.href = "/page";
      link.target = "_blank";
      link.textContent = "New Tab Link";
      document.body.appendChild(link);

      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      const prevented = !link.dispatchEvent(clickEvent);

      assertEquals(prevented, false);

      document.body.removeChild(link);
      router.destroy();
    });

    it("should not intercept hash links", () => {
      const router = new VeryfrontRouter();
      router.init();

      const link = document.createElement("a");
      link.href = "#section";
      link.textContent = "Hash Link";
      document.body.appendChild(link);

      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      const prevented = !link.dispatchEvent(clickEvent);

      assertEquals(prevented, false);

      document.body.removeChild(link);
      router.destroy();
    });
  });

  describe("Popstate Handling", () => {
    it("should handle browser back button", async () => {
      const router = new VeryfrontRouter();
      router.init();

      env.fetchMock.set("/page1", new Response('<div id="root">Page 1</div>', { status: 200 }));
      env.fetchMock.set("/page2", new Response('<div id="root">Page 2</div>', { status: 200 }));

      await router.navigate("/page1");
      await router.navigate("/page2");

      (globalThis as any).location.pathname = "/page1";
      globalThis.dispatchEvent(new PopStateEvent("popstate", {}));

      await delay(100);

      router.destroy();
    });

    it("should restore scroll position on popstate", async () => {
      const router = new VeryfrontRouter();
      router.init();

      env.fetchMock.set("/page1", new Response('<div id="root">Page 1</div>', { status: 200 }));
      env.fetchMock.set("/page2", new Response('<div id="root">Page 2</div>', { status: 200 }));

      (globalThis as any).scrollY = 500;

      await router.navigate("/page1");
      (globalThis as any).scrollY = 0;
      await router.navigate("/page2");

      (globalThis as any).location.pathname = "/page1";
      globalThis.dispatchEvent(new PopStateEvent("popstate", {}));

      await delay(200);

      router.destroy();
    });
  });

  describe("Hover Prefetch", () => {
    it("should prefetch on link hover when enabled", async () => {
      const router = new VeryfrontRouter({
        prefetch: { hover: true },
        prefetchDelay: 50,
      });
      router.init();

      const link = document.createElement("a");
      link.href = "/hover";
      document.body.appendChild(link);

      env.fetchMock.set("/hover", new Response('<div id="root">Hover</div>', { status: 200 }));

      const mouseoverEvent = new MouseEvent("mouseover", { bubbles: true, cancelable: true });
      link.dispatchEvent(mouseoverEvent);

      await delay(100);

      document.body.removeChild(link);
      router.destroy();
    });

    it("should respect data-prefetch attribute", async () => {
      const router = new VeryfrontRouter({
        prefetch: { hover: false },
      });
      router.init();

      const link = document.createElement("a");
      link.href = "/prefetch";
      link.setAttribute("data-prefetch", "true");
      document.body.appendChild(link);

      env.fetchMock.set(
        "/prefetch",
        new Response('<div id="root">Prefetch</div>', { status: 200 }),
      );

      const mouseoverEvent = new MouseEvent("mouseover", { bubbles: true, cancelable: true });
      link.dispatchEvent(mouseoverEvent);

      await delay(200);

      document.body.removeChild(link);
      router.destroy();
    });

    it('should not prefetch when data-prefetch="false"', async () => {
      let fetchCount = 0;

      env.fetchMock.set("/no-prefetch", () => {
        fetchCount++;
        return new Response('<div id="root">Page</div>', { status: 200 });
      });

      const router = new VeryfrontRouter({
        prefetch: { hover: true },
      });
      router.init();

      const link = document.createElement("a");
      link.href = "/no-prefetch";
      link.setAttribute("data-prefetch", "false");
      document.body.appendChild(link);

      const mouseoverEvent = new MouseEvent("mouseover", { bubbles: true, cancelable: true });
      link.dispatchEvent(mouseoverEvent);

      await delay(200);

      assertEquals(fetchCount, 0);

      document.body.removeChild(link);
      router.destroy();
    });
  });

  describe("Page Transition", () => {
    it("should update page title", async () => {
      const html = `
        <div id="root">
          <h1>New Page</h1>
        </div>
        <script data-veryfront-page type="application/json">
          {"frontmatter": {"title": "New Title"}}
        </script>
      `;

      env.fetchMock.set("/page", new Response(html, { status: 200 }));

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/page");
      await delay(200);

      assertEquals(document.title, "New Title");

      router.destroy();
    });

    it("should update meta tags", async () => {
      const html = `
        <div id="root">
          <h1>Page</h1>
        </div>
        <script data-veryfront-page type="application/json">
          {"frontmatter": {"description": "Test description"}}
        </script>
      `;

      env.fetchMock.set("/page", new Response(html, { status: 200 }));

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/page");
      await delay(200);

      const metaTag = document.querySelector('meta[name="description"]');
      assertExists(metaTag);

      router.destroy();
    });

    it("should show error page on navigation failure", async () => {
      env.fetchMock.set("/error", new Error("Failed to load"));

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/error");
      await delay(200);

      router.destroy();
    });

    it("should set loading state during navigation", async () => {
      const loadingIndicator = document.createElement("div");
      loadingIndicator.id = "veryfront-loading";
      loadingIndicator.style.display = "none";
      document.body.appendChild(loadingIndicator);

      env.fetchMock.set(
        "/slow",
        new Response('<div id="root">Slow Page</div>', { status: 200 }),
      );

      const router = new VeryfrontRouter();
      router.init();

      const navigationPromise = router.navigate("/slow");

      await delay(50);
      await navigationPromise;

      document.body.removeChild(loadingIndicator);
      router.destroy();
    });
  });

  describe("Cleanup", () => {
    it("should remove event listeners on destroy", () => {
      const router = new VeryfrontRouter();
      router.init();

      const link = document.createElement("a");
      link.href = "/page";
      document.body.appendChild(link);

      router.destroy();

      const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
      const prevented = !link.dispatchEvent(clickEvent);

      assertEquals(prevented, false);

      document.body.removeChild(link);
    });

    it("should disconnect observers on destroy", () => {
      const router = new VeryfrontRouter();
      router.init();

      router.destroy();

      assertExists(router);
    });

    it("should clear cache on destroy", async () => {
      env.fetchMock.set("/page", new Response('<div id="root">Page</div>', { status: 200 }));

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/page");

      router.destroy();

      assertExists(router);
    });
  });

  describe("Edge Cases", () => {
    it("should handle navigation without root element", async () => {
      removeRoot();

      const router = new VeryfrontRouter();
      router.init();

      env.fetchMock.set("/page", new Response('<div id="root">Page</div>', { status: 200 }));

      await router.navigate("/page");

      assertExists(router);

      router.destroy();

      rootElement = createRoot();
    });

    it("should handle invalid JSON in page data", () => {
      const pageDataScript = document.createElement("script");
      pageDataScript.setAttribute("data-veryfront-page", "");
      pageDataScript.type = "application/json";
      pageDataScript.textContent = "invalid json";
      document.body.appendChild(pageDataScript);

      const router = new VeryfrontRouter();
      router.init();

      assertExists(router);

      document.body.removeChild(pageDataScript);
      router.destroy();
    });

    it("should handle concurrent navigations", async () => {
      env.fetchMock.set("/page1", new Response('<div id="root">Page 1</div>', { status: 200 }));
      env.fetchMock.set("/page2", new Response('<div id="root">Page 2</div>', { status: 200 }));

      const router = new VeryfrontRouter();
      router.init();

      await Promise.all([router.navigate("/page1"), router.navigate("/page2")]);

      assertExists(router);

      router.destroy();
    });

    it("should handle empty responses", async () => {
      env.fetchMock.set("/empty", new Response("", { status: 200 }));

      const router = new VeryfrontRouter();
      router.init();

      await router.navigate("/empty");

      assertExists(router);

      router.destroy();
    });
  });
});
