import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { collectAllRoutes } from "./route-collector.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    name: "test",
    fs: {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
      mkdir: () => Promise.resolve(),
      readDir: () =>
        (async function* () {
        })(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0 }),
      remove: () => Promise.resolve(),
      readTextFile: () => Promise.resolve(""),
      writeTextFile: () => Promise.resolve(),
    },
  } as unknown as RuntimeAdapter;
}

describe("build/production-build/build/route-collector", () => {
  describe("collectAllRoutes", () => {
    it("should return empty routes when ssg is false", async () => {
      const adapter = createMockAdapter();
      const result = await collectAllRoutes(adapter, "/tmp/project", false);
      assertEquals(result.pages, []);
      assertEquals(result.app, []);
    });

    it("should return empty routes when ssg is false regardless of include/exclude", async () => {
      const adapter = createMockAdapter();
      const result = await collectAllRoutes(
        adapter,
        "/tmp/project",
        false,
        ["/**"],
        ["/admin"],
      );
      assertEquals(result.pages, []);
      assertEquals(result.app, []);
    });
  });
});
