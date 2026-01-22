import { describe, it } from "@std/testing/bdd";
import {
  clearAllProjectCaches,
  invalidateProjectCaches,
} from "../../../src/server/context/cache-invalidation.ts";

describe("cache-invalidation", () => {
  describe("invalidateProjectCaches", () => {
    it("invalidates caches without throwing", () => {
      // Verify the function completes without error
      invalidateProjectCaches("test-project");
    });

    it("supports selective invalidation with specific file paths", () => {
      // Verify selective invalidation completes without error
      invalidateProjectCaches("test-project", ["pages/index.mdx", "components/Button.tsx"]);
    });
  });

  describe("clearAllProjectCaches", () => {
    it("clears all caches without throwing", () => {
      // Verify full cache clear completes without error
      clearAllProjectCaches("test-project");
    });
  });
});
