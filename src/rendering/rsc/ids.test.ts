import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeStableId, withStableIds } from "./ids.ts";

describe("rendering/rsc/ids", () => {
  describe("computeStableId", () => {
    it("should return a base36 string", () => {
      const id = computeStableId("/pages/index.tsx");
      assertEquals(/^[0-9a-z]+$/.test(id), true);
    });

    it("should be deterministic for same input", () => {
      const a = computeStableId("/pages/index.tsx");
      const b = computeStableId("/pages/index.tsx");
      assertEquals(a, b);
    });

    it("should produce different ids for different paths", () => {
      const a = computeStableId("/pages/index.tsx");
      const b = computeStableId("/pages/about.tsx");
      assertNotEquals(a, b);
    });

    it("should handle empty string", () => {
      const id = computeStableId("");
      assertEquals(typeof id, "string");
      assertEquals(id.length > 0, true);
    });
  });

  describe("withStableIds", () => {
    it("should assign stable ids to client and server entries", () => {
      const graph = {
        client: [{ path: "/project/app/components/Button.tsx" }],
        server: [{ path: "/project/app/pages/index.tsx" }],
      };
      const result = withStableIds("/project", graph);

      assertEquals(result.client.length, 1);
      assertEquals(result.server.length, 1);
      assertEquals(typeof result.client[0].id, "string");
      assertEquals(typeof result.server[0].id, "string");
      assertEquals(result.client[0].path, "/project/app/components/Button.tsx");
      assertEquals(result.server[0].path, "/project/app/pages/index.tsx");
    });

    it("should compute relative paths from app root", () => {
      const graph = {
        client: [{ path: "/project/app/components/Button.tsx" }],
        server: [],
      };
      const result = withStableIds("/project", graph);
      assertEquals(result.client[0].rel, "/components/Button.tsx");
    });

    it("should sort entries by relative path", () => {
      const graph = {
        client: [
          { path: "/project/app/z-file.tsx" },
          { path: "/project/app/a-file.tsx" },
        ],
        server: [],
      };
      const result = withStableIds("/project", graph);
      assertEquals(result.client[0].rel, "/a-file.tsx");
      assertEquals(result.client[1].rel, "/z-file.tsx");
    });

    it("should handle paths outside app root", () => {
      const graph = {
        client: [{ path: "/other/place.tsx" }],
        server: [],
      };
      const result = withStableIds("/project", graph);
      assertEquals(result.client[0].rel, "/other/place.tsx");
    });
  });
});
