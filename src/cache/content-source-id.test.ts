/**
 * P1-4: Cache Isolation — Content Source ID Tests
 *
 * Spec: specs/platform/proxy-renderer-contract.spec.md
 * Verifies: All 6 content source ID formats and uniqueness across environments.
 * Extends existing keys.test.ts with comprehensive isolation testing.
 */
import { assertEquals, assertThrows } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { computeContentSourceId } from "./keys.ts";

describe("cache/content-source-id isolation", () => {
  describe("all 6 content source ID formats", () => {
    it("local development: local-{branch}", () => {
      assertEquals(
        computeContentSourceId(true, "preview", "feature-x", null),
        "local-feature-x",
      );
    });

    it("local development with null branch defaults to main", () => {
      assertEquals(computeContentSourceId(true, "preview", null, null), "local-main");
    });

    it("local development with undefined branch defaults to main", () => {
      assertEquals(
        computeContentSourceId(true, "preview", undefined, null),
        "local-main",
      );
    });

    it("preview: preview-{branch}", () => {
      assertEquals(
        computeContentSourceId(false, "preview", "feature-branch", null),
        "preview-feature-branch",
      );
    });

    it("preview with null branch defaults to main", () => {
      assertEquals(computeContentSourceId(false, "preview", null, null), "preview-main");
    });

    it("production release: release-{releaseId}", () => {
      assertEquals(
        computeContentSourceId(false, "production", "main", "rel_abc123"),
        "release-rel_abc123",
      );
    });

    it("production throws without releaseId", () => {
      assertThrows(
        () => computeContentSourceId(false, "production", "main", null),
        Error,
        "Missing releaseId for production contentSourceId",
      );
    });

    it("production throws with undefined releaseId", () => {
      assertThrows(
        () => computeContentSourceId(false, "production", "main", undefined),
        Error,
        "Missing releaseId for production contentSourceId",
      );
    });
  });

  describe("cross-environment uniqueness", () => {
    it("same project, different branches produce different IDs", () => {
      const idA = computeContentSourceId(false, "preview", "feature-a", null);
      const idB = computeContentSourceId(false, "preview", "feature-b", null);

      assertEquals(idA, "preview-feature-a");
      assertEquals(idB, "preview-feature-b");
      assertEquals(idA !== idB, true);
    });

    it("local vs remote preview produce different IDs for same branch", () => {
      const local = computeContentSourceId(true, "preview", "main", null);
      const remote = computeContentSourceId(false, "preview", "main", null);

      assertEquals(local, "local-main");
      assertEquals(remote, "preview-main");
      assertEquals(local !== remote, true);
    });

    it("preview vs production produce different IDs", () => {
      const preview = computeContentSourceId(false, "preview", "main", null);
      const production = computeContentSourceId(
        false,
        "production",
        "main",
        "rel_123",
      );

      assertEquals(preview, "preview-main");
      assertEquals(production, "release-rel_123");
      assertEquals(preview !== production, true);
    });

    it("different releases produce different IDs", () => {
      const release1 = computeContentSourceId(
        false,
        "production",
        "main",
        "rel_v1.0",
      );
      const release2 = computeContentSourceId(
        false,
        "production",
        "main",
        "rel_v2.0",
      );

      assertEquals(release1, "release-rel_v1.0");
      assertEquals(release2, "release-rel_v2.0");
      assertEquals(release1 !== release2, true);
    });

    it("local dev ignores environment and releaseId", () => {
      const localPreview = computeContentSourceId(true, "preview", "main", null);
      const localProd = computeContentSourceId(
        true,
        "production",
        "main",
        "rel_123",
      );

      // Both should be local-main regardless of environment
      assertEquals(localPreview, "local-main");
      assertEquals(localProd, "local-main");
      assertEquals(localPreview, localProd);
    });
  });

  describe("deployment invalidation", () => {
    it("new release changes content source ID", () => {
      const beforeDeploy = computeContentSourceId(
        false,
        "production",
        "main",
        "rel_old",
      );
      const afterDeploy = computeContentSourceId(
        false,
        "production",
        "main",
        "rel_new",
      );

      assertEquals(beforeDeploy !== afterDeploy, true);
    });

    it("branch switch changes content source ID for preview", () => {
      const branchA = computeContentSourceId(false, "preview", "feature-a", null);
      const branchB = computeContentSourceId(false, "preview", "feature-b", null);

      assertEquals(branchA !== branchB, true);
    });

    it("local branch switch changes content source ID", () => {
      const branchA = computeContentSourceId(true, "preview", "develop", null);
      const branchB = computeContentSourceId(true, "preview", "main", null);

      assertEquals(branchA, "local-develop");
      assertEquals(branchB, "local-main");
      assertEquals(branchA !== branchB, true);
    });
  });
});
