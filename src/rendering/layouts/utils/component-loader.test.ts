import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createLayoutComponentCache,
  shouldUnwrapAppRouterDocumentLayout,
  unwrapAppRouterDocumentLayout,
} from "./component-loader.ts";

describe("rendering/layouts/utils/component-loader", () => {
  describe("createLayoutComponentCache", () => {
    it("should create a cache with default max entries", () => {
      const cache = createLayoutComponentCache();
      assertEquals(typeof cache.get, "function");
      assertEquals(typeof cache.set, "function");
      assertEquals(typeof cache.delete, "function");
      assertEquals(typeof cache.clear, "function");
    });

    it("should create a cache with custom max entries", () => {
      const cache = createLayoutComponentCache(10);
      assertEquals(typeof cache.get, "function");
    });
  });

  describe("InMemoryLayoutComponentCache (via factory)", () => {
    function DummyComponent() {
      return null;
    }
    function AnotherComponent() {
      return null;
    }

    // Use real-format keys: layout:{projectId}:{path}:{hash}:{csid}
    const key1 = "layout:proj:/path1:hash1:csid";
    const key2 = "layout:proj:/path2:hash2:csid";
    const key3 = "layout:proj:/path3:hash3:csid";

    it("should return undefined for missing keys", () => {
      const cache = createLayoutComponentCache();
      assertEquals(cache.get("layout:proj:/missing:h:c"), undefined);
    });

    it("should set and get a component", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      assertEquals(cache.get(key1), DummyComponent);
    });

    it("should overwrite existing key", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      cache.set(key1, AnotherComponent);
      assertEquals(cache.get(key1), AnotherComponent);
    });

    it("should delete a key", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      cache.delete(key1);
      assertEquals(cache.get(key1), undefined);
    });

    it("should clear all entries", () => {
      const cache = createLayoutComponentCache();
      cache.set(key1, DummyComponent);
      cache.set(key2, AnotherComponent);
      cache.clear();
      assertEquals(cache.get(key1), undefined);
      assertEquals(cache.get(key2), undefined);
    });

    it("should evict oldest entry when per-project cap is reached", () => {
      // perProjectMaxEntries=2, maxEntries large enough not to evict the project bucket
      const cache = createLayoutComponentCache(100, 2);

      const C1 = () => null;
      const C2 = () => null;
      const C3 = () => null;

      cache.set(key1, C1);
      cache.set(key2, C2);
      cache.set(key3, C3);

      assertEquals(cache.get(key1), undefined);
      assertEquals(cache.get(key2), C2);
      assertEquals(cache.get(key3), C3);
    });

    it("should promote accessed entries (LRU behavior)", () => {
      const cache = createLayoutComponentCache(100, 2);

      const C1 = () => null;
      const C2 = () => null;
      const C3 = () => null;

      cache.set(key1, C1);
      cache.set(key2, C2);

      // Access key1 to promote it
      cache.get(key1);

      // Now key2 should be the oldest, so adding key3 should evict key2
      cache.set(key3, C3);

      assertEquals(cache.get(key1), C1);
      assertEquals(cache.get(key2), undefined);
      assertEquals(cache.get(key3), C3);
    });

    it("should handle clearForProject", () => {
      const cache = createLayoutComponentCache();
      const C1 = () => null;
      const C2 = () => null;

      cache.set("layout:project1:/path1:hash1:csid1", C1);
      cache.set("layout:project2:/path2:hash2:csid2", C2);

      cache.clearForProject?.("project1");

      assertEquals(cache.get("layout:project1:/path1:hash1:csid1"), undefined);
      assertEquals(cache.get("layout:project2:/path2:hash2:csid2"), C2);
    });

    it("should handle delete of non-existing key", () => {
      const cache = createLayoutComponentCache();
      cache.delete("layout:proj:/nonexistent:h:c"); // Should not throw
    });

    it("should handle per-project cap of 1", () => {
      const cache = createLayoutComponentCache(100, 1);
      const C1 = () => null;
      const C2 = () => null;

      cache.set(key1, C1);
      cache.set(key2, C2);

      assertEquals(cache.get(key1), undefined);
      assertEquals(cache.get(key2), C2);
    });
  });

  describe("PerProjectLayoutComponentCache (via factory with perProjectMaxEntries)", () => {
    function makeKey(projectId: string, index: number): string {
      return `layout:${projectId}:/path${index}:hash${index}:csid`;
    }

    it("should isolate project A entries from project B when A overflows its per-project cap", () => {
      // perProjectMaxEntries=2, maxProjects derived from maxEntries=10 / 2 = 5
      const cache = createLayoutComponentCache(10, 2);

      const B1 = () => null;
      const B2 = () => null;
      cache.set(makeKey("project-b", 1), B1);
      cache.set(makeKey("project-b", 2), B2);

      // Fill project A beyond its per-project cap of 2
      const A1 = () => null;
      const A2 = () => null;
      const A3 = () => null;
      cache.set(makeKey("project-a", 1), A1);
      cache.set(makeKey("project-a", 2), A2);
      cache.set(makeKey("project-a", 3), A3); // evicts A1 within project-a only

      // A1 should be gone, A2/A3 survive
      assertEquals(cache.get(makeKey("project-a", 1)), undefined);
      assertEquals(cache.get(makeKey("project-a", 2)), A2);
      assertEquals(cache.get(makeKey("project-a", 3)), A3);

      // Project B entries must be untouched
      assertEquals(cache.get(makeKey("project-b", 1)), B1);
      assertEquals(cache.get(makeKey("project-b", 2)), B2);
    });

    it("should not evict project B entries on heavy use of project A", () => {
      const cache = createLayoutComponentCache(20, 3);

      const BEntry = () => null;
      cache.set(makeKey("project-b", 1), BEntry);

      // Flood project A with 10 entries (cap=3, so 7 intra-A evictions happen)
      for (let i = 0; i < 10; i++) {
        cache.set(makeKey("project-a", i), () => null);
      }

      // Project B entry must still be present
      assertEquals(cache.get(makeKey("project-b", 1)), BEntry);
    });

    it("should remove only the target project on clearForProject", () => {
      const cache = createLayoutComponentCache(10, 2);

      const A1 = () => null;
      const B1 = () => null;
      cache.set(makeKey("project-a", 1), A1);
      cache.set(makeKey("project-b", 1), B1);

      cache.clearForProject?.("project-a");

      assertEquals(cache.get(makeKey("project-a", 1)), undefined);
      assertEquals(cache.get(makeKey("project-b", 1)), B1);
    });

    it("should remove all projects on clear()", () => {
      const cache = createLayoutComponentCache(10, 2);

      cache.set(makeKey("project-a", 1), () => null);
      cache.set(makeKey("project-b", 1), () => null);

      cache.clear();

      assertEquals(cache.get(makeKey("project-a", 1)), undefined);
      assertEquals(cache.get(makeKey("project-b", 1)), undefined);
    });
  });

  describe("App Router document layout unwrapping", () => {
    it("should detect the App Router root layout path", () => {
      assertEquals(
        shouldUnwrapAppRouterDocumentLayout("/project/app/layout.tsx", "/project"),
        true,
      );
      assertEquals(
        shouldUnwrapAppRouterDocumentLayout("/project/app/dashboard/layout.tsx", "/project"),
        false,
      );
    });

    it("should preserve body children without mounting html and body inside the root", () => {
      function RootLayout({ children }: { children: React.ReactNode }) {
        return React.createElement(
          "html",
          null,
          React.createElement("body", null, React.createElement("main", null, children)),
        );
      }

      const WrappedLayout = unwrapAppRouterDocumentLayout(React, RootLayout);
      const result = WrappedLayout({
        children: React.createElement("button", { id: "counter" }, "Count: 0"),
      }) as React.ReactElement;

      assertEquals(result.type, "main");
      const child = React.Children.only(result.props.children) as React.ReactElement;
      assertEquals(child.type, "button");
    });
  });
});
