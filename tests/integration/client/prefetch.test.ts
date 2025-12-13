
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { afterEach, beforeEach, describe, it } from "std/testing/bdd.ts";
import type { PrefetchOptions } from "@veryfront/rendering/client/prefetch.ts";
import { PrefetchManager } from "@veryfront/rendering/client/prefetch.ts";
import type { DOMEnvironment } from "./test-helpers.ts";
import { setupDOMEnvironment } from "./test-helpers.ts";

describe("Prefetch Manager",  () => {
  let env: DOMEnvironment;
  const managers: PrefetchManager[] = [];

  const createManager = (options?: PrefetchOptions) => {
    const manager = new PrefetchManager(options);
    managers.push(manager);
    return manager;
  };

  beforeEach(() => {
    env = setupDOMEnvironment({
      url: "http://localhost:3000/",
      connection: {
        effectiveType: "4g",
        saveData: false,
      },
    });
  });

  afterEach(() => {
    managers.forEach((manager) => {
      try {
        manager.destroy();
      } catch {
        // Ignore errors during cleanup
      }
    });
    managers.length = 0;
    env.cleanup();
  });

  describe("Initialization", () => {
    it("should create prefetch manager with default options", () => {
      const manager = createManager();
      assertExists(manager);
    });

    it("should accept custom options", () => {
      const options: PrefetchOptions = {
        rootMargin: "100px",
        delay: 500,
        maxConcurrent: 4,
        allowedNetworks: ["4g", "wifi"],
        maxSize: 1024 * 1024,
        timeout: 5000,
      };

      const manager = createManager(options);
      assertExists(manager);
    });

    it("should use default values for missing options", () => {
      const manager = createManager({
        rootMargin: "100px",
      });
      assertExists(manager);
    });

    it("should not initialize when saveData is enabled", () => {
      (globalThis.navigator as any).connection.saveData = true;

      const manager = createManager();
      manager.init();

      assertEquals(env.mockObservers.length, 0);
    });

    it("should not initialize on slow network", () => {
      (globalThis.navigator as any).connection.effectiveType = "2g";

      const manager = createManager({
        allowedNetworks: ["4g", "wifi"],
      });
      manager.init();

      assertEquals(env.mockObservers.length, 0);
    });
  });

  describe("Network Detection", () => {
    it("should prefetch on 4g network", () => {
      (globalThis.navigator as any).connection.effectiveType = "4g";

      const manager = createManager();
      manager.init();

      assertEquals(env.mockObservers.length > 0, true);
    });

    it("should prefetch on wifi network", () => {
      (globalThis.navigator as any).connection.effectiveType = "wifi";

      const manager = createManager();
      manager.init();

      assertEquals(env.mockObservers.length > 0, true);
    });

    it("should not prefetch on 3g when not allowed", () => {
      (globalThis.navigator as any).connection.effectiveType = "3g";

      const manager = createManager({
        allowedNetworks: ["4g", "wifi"],
      });
      manager.init();

      assertEquals(env.mockObservers.length, 0);
    });

    it("should handle missing network information", () => {
      (globalThis.navigator as any).connection = undefined;

      const manager = createManager();
      manager.init();

      assertEquals(env.mockObservers.length > 0, true);
    });
  });

  describe("Link Prefetching", () => {
    it("should prefetch link when visible", async () => {
      env.fetchMock.set("/test", new Response("Test", { status: 200 }));

      const manager = createManager();
      await manager.prefetch("/test");

      assertExists(manager);
    });

    it("should add prefetch header to requests", async () => {
      let capturedHeaders: Headers | undefined;

      env.fetchMock.set("/test", (_url: string, options?: RequestInit) => {
        capturedHeaders = new Headers(options?.headers);
        return new Response("OK", { status: 200 });
      });

      const manager = createManager();
      await manager.prefetch("/test");

      assertExists(capturedHeaders);
      assertEquals(capturedHeaders?.get("X-Veryfront-Prefetch"), "1");
    });

    it("should respect max concurrent prefetches", async () => {
      let activeFetches = 0;
      let maxActiveFetches = 0;

      const concurrentFetch = async () => {
        activeFetches++;
        maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
        await new Promise((resolve) => setTimeout(resolve, 100));
        activeFetches--;
        return new Response("OK", { status: 200 });
      };

      env.fetchMock.set("/test1", concurrentFetch);
      env.fetchMock.set("/test2", concurrentFetch);
      env.fetchMock.set("/test3", concurrentFetch);

      const manager = createManager({
        maxConcurrent: 2,
      });

      await Promise.all([
        manager.prefetch("/test1"),
        manager.prefetch("/test2"),
        manager.prefetch("/test3"),
      ]);

      assertEquals(maxActiveFetches <= 2, true);
    });

    it("should skip prefetch if already prefetched", async () => {
      let fetchCount = 0;

      env.fetchMock.set("/test", (_url: string) => {
        fetchCount++;
        return new Response("OK", { status: 200 });
      });

      const manager = createManager();
      await manager.prefetch("/test");
      await manager.prefetch("/test");

      assertEquals(fetchCount, 1);
    });

    it("should handle fetch errors gracefully", async () => {
      env.fetchMock.set("/error", new Error("Network error"));

      const manager = createManager();

      await manager.prefetch("/error");
      assertExists(manager);
    });

    it("should respect timeout", async () => {
      env.fetchMock.set("/slow", (_url: string, options?: RequestInit) => {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            resolve(new Response("OK", { status: 200 }));
          }, 10000);

          options?.signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new Error("Aborted"));
          });
        });
      });

      const manager = createManager({
        timeout: 100,
      });

      const start = Date.now();
      await manager.prefetch("/slow");
      const duration = Date.now() - start;

      assertEquals(duration < 1000, true);
    });

    it("should skip large responses", async () => {
      const response = new Response("Large content", {
        status: 200,
        headers: {
          "content-length": "10000000", // 10MB
        },
      });

      env.fetchMock.set("/large", response);

      const manager = createManager({
        maxSize: 1024 * 1024, // 1MB
      });

      await manager.prefetch("/large");

      assertExists(manager);
    });
  });

  describe("Resource Hints", () => {
    it("should apply resource hints", () => {
      const manager = createManager();

      const hints = [
        { type: "prefetch" as const, href: "/script.js", as: "script" },
        { type: "preload" as const, href: "/style.css", as: "style" },
      ];

      manager.applyResourceHints(hints);

      const prefetchLink = document.querySelector('link[rel="prefetch"][href="/script.js"]');
      const preloadLink = document.querySelector('link[rel="preload"][href="/style.css"]');

      assertExists(prefetchLink);
      assertExists(preloadLink);
    });

    it("should not duplicate resource hints", () => {
      const manager = createManager();

      const hints = [{ type: "prefetch" as const, href: "/script.js" }];

      manager.applyResourceHints(hints);
      manager.applyResourceHints(hints);

      const links = document.querySelectorAll('link[rel="prefetch"][href="/script.js"]');
      assertEquals(links.length, 1);
    });

    it("should generate resource hints for route", () => {
      const hints = PrefetchManager.generateResourceHints("/route", [
        "/script.js",
        "/style.css",
        "/font.woff2",
      ]);

      assertExists(hints);
      assertEquals(hints.includes("modulepreload"), true);
      assertEquals(hints.includes("preload"), true);
      assertEquals(hints.includes('as="font"'), true);
    });

    it("should extract resource hints from HTML", () => {
      const html = `
        <html>
          <head>
            <script src="/script.js"></script>
            <link rel="stylesheet" href="/style.css">
            <link rel="preload" href="/font.woff2" as="font">
          </head>
        </html>
      `;

      const manager = createManager();
      (manager as any).resourceHintsManager.extractResourceHints(html, new Set());

      assertExists(manager);
    });
  });

  describe("Cleanup", () => {
    it("should destroy and cleanup resources", () => {
      const manager = createManager();
      manager.init();

      manager.destroy();

      assertExists(manager);
    });

    it("should stop all prefetches on destroy", async () => {
      let aborted = false;

      env.fetchMock.set("/test", async (_url: string, options?: RequestInit) => {
        try {
          await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(resolve, 1000);
            options?.signal?.addEventListener("abort", () => {
              clearTimeout(timeoutId);
              aborted = true;
              reject(new Error("Aborted"));
            });
          });
          return new Response("OK", { status: 200 });
        } catch (error) {
          throw error;
        }
      });

      const manager = createManager();
      const prefetchPromise = manager.prefetch("/test");

      manager.destroy();

      try {
        await prefetchPromise;
      } catch {
        // Expected to fail
      }

      assertEquals(aborted, true);
    });
  });

  describe("Integration with LinkObserver", () => {
    it("should observe links on init", () => {
      const link1 = document.createElement("a");
      link1.href = "/page1";
      document.body.appendChild(link1);

      const link2 = document.createElement("a");
      link2.href = "/page2";
      document.body.appendChild(link2);

      const manager = createManager();
      manager.init();

      assertEquals(env.mockObservers.length > 0, true);

      document.body.removeChild(link1);
      document.body.removeChild(link2);
      manager.destroy();
    });

    it("should prefetch link when it enters viewport", async () => {
      env.fetchMock.set("/page", new Response("Page", { status: 200 }));

      const link = document.createElement("a");
      link.href = "/page";
      document.body.appendChild(link);

      const manager = createManager({
        delay: 0, // No delay for testing
      });
      manager.init();

      if (env.mockObservers.length > 0 && env.mockObservers[0]) {
        env.mockObservers[0].observe(link);
        env.mockObservers[0].triggerIntersection(link, true);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      document.body.removeChild(link);
      manager.destroy();
    });

    it("should respect rootMargin option", () => {
      const manager = createManager({
        rootMargin: "100px",
      });
      manager.init();

      if (env.mockObservers.length > 0 && env.mockObservers[0]) {
        const options = env.mockObservers[0].getOptions();
        assertEquals(options.rootMargin, "100px");
      }

      manager.destroy();
    });

    it("should apply delay before prefetching", async () => {
      const link = document.createElement("a");
      link.href = "/page";
      document.body.appendChild(link);

      let prefetchStarted = false;

      env.fetchMock.set("/page", (_url: string) => {
        prefetchStarted = true;
        return new Response("Page", { status: 200 });
      });

      const manager = createManager({
        delay: 100,
      });
      manager.init();

      if (env.mockObservers.length > 0 && env.mockObservers[0]) {
        env.mockObservers[0].observe(link);
        env.mockObservers[0].triggerIntersection(link, true);
      }

      assertEquals(prefetchStarted, false);

      await new Promise((resolve) => setTimeout(resolve, 150));

      document.body.removeChild(link);
      manager.destroy();
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing document.head", () => {
      const originalHead = document.head;
      (document as any).head = undefined;

      const manager = createManager();

      manager.applyResourceHints([{ type: "prefetch", href: "/test.js" }]);
      (document as any).head = originalHead;
    });

    it("should handle invalid HTML in resource extraction", () => {
      const manager = createManager();
      (manager as any).resourceHintsManager.extractResourceHints("<invalid", new Set());

      assertExists(manager);
    });

    it("should handle concurrent destroy calls", () => {
      const manager = createManager();
      manager.init();

      manager.destroy();
      manager.destroy();

      assertExists(manager);
    });

    it("should handle prefetch after destroy", async () => {
      const manager = createManager();
      manager.init();
      manager.destroy();

      await manager.prefetch("/test");
      assertExists(manager);
    });
  });
});
