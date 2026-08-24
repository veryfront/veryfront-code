import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";

describe("build/asset-pipeline/tailwind-processor/detector", () => {
  it("retains the detector's intentional false result for rejected paths", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.writeFile("/workspace-outside.css", '@import "tailwindcss";');

    assertEquals(
      await isTailwindV4File("/workspace-outside.css", "/workspace", adapter),
      false,
    );
  });

  it("detects Tailwind v4 stylesheets by their tailwindcss import", async () => {
    const adapter = createMockAdapter();
    await adapter.fs.writeFile("/workspace/app.css", '@import "tailwindcss";');
    await adapter.fs.writeFile(
      "/workspace/preflight.css",
      '@import "tailwindcss/preflight";',
    );
    await adapter.fs.writeFile("/workspace/plain.css", "body { color: red; }");

    assertEquals(
      await isTailwindV4File("/workspace/app.css", "/workspace", adapter),
      true,
      "a stylesheet importing tailwindcss is a Tailwind v4 file",
    );
    assertEquals(
      await isTailwindV4File("/workspace/preflight.css", "/workspace", adapter),
      true,
      "a tailwindcss sub-path import is a Tailwind v4 file",
    );
    assertEquals(
      await isTailwindV4File("/workspace/plain.css", "/workspace", adapter),
      false,
      "a stylesheet without a tailwindcss import is not a Tailwind v4 file",
    );
  });

  describe("autoDetectContentPaths", () => {
    it("should return four content path patterns", () => {
      assertEquals(autoDetectContentPaths("/project").length, 4);
    });

    it("should include app, pages, components, and src directories", () => {
      const joined = autoDetectContentPaths("/project").join("\n");
      assertEquals(joined.includes("/project/app/"), true);
      assertEquals(joined.includes("/project/pages/"), true);
      assertEquals(joined.includes("/project/components/"), true);
      assertEquals(joined.includes("/project/src/"), true);
    });

    it("should include the glob pattern for supported extensions", () => {
      for (const p of autoDetectContentPaths("/project")) {
        assertEquals(p.includes("**/*.{js,ts,jsx,tsx,mdx}"), true);
      }
    });

    it("should use the provided project directory as base", () => {
      for (const p of autoDetectContentPaths("/my/custom/dir")) {
        assertEquals(p.startsWith("/my/custom/dir/"), true);
      }
    });
  });
});
