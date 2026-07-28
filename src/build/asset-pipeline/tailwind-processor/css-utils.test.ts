import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { expect } from "#std/expect.ts";
import { minifyCSS } from "./css-utils.ts";

describe("build/asset-pipeline/tailwind-processor/css-utils", () => {
  describe("minifyCSS", () => {
    it("minifies valid CSS without corrupting structured values", async () => {
      const result = await minifyCSS(`
        /* Header styles */
        .header {
          background: url("data:image/svg+xml;utf8,<svg></svg>");
          width: calc(100% - var(--gap, 1rem));
        }
      `);

      expect(result).not.toContain("Header styles");
      expect(result).toContain("data:image/svg+xml;utf8,<svg></svg>");
      expect(result).toContain("calc(100% - var(--gap");
      expect(result).toContain("1rem))");
    });

    it("handles empty CSS", async () => {
      expect(await minifyCSS("")).toBe("");
    });

    it("rejects malformed CSS instead of publishing a regex fallback", async () => {
      await assertRejects(
        () => minifyCSS(".broken { /*"),
        Error,
      );
    });
  });
});
