/** @module transforms/esm/bundle-manifest.test */

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  type BundleEntry,
  computeManifestId,
  createBundleManifest,
  getManifestIdForHash,
  validateBundleGroup,
} from "./bundle-manifest.ts";

describe("Bundle Manifest", { sanitizeResources: false, sanitizeOps: false }, () => {
  describe("computeManifestId", () => {
    it("produces deterministic ID regardless of input order", async () => {
      const hashes = ["abc123", "def456", "789xyz"];
      const id1 = await computeManifestId(hashes);
      const id2 = await computeManifestId([...hashes].reverse());
      const id3 = await computeManifestId(["def456", "abc123", "789xyz"]);

      assertEquals(id1, id2);
      assertEquals(id1, id3);
    });

    it("produces different IDs for different hash sets", async () => {
      const id1 = await computeManifestId(["abc123", "def456"]);
      const id2 = await computeManifestId(["abc123", "ghi789"]);

      assert(id1 !== id2, "Different hash sets should produce different manifest IDs");
    });

    it("produces consistent ID for single hash", async () => {
      const id1 = await computeManifestId(["abc123"]);
      const id2 = await computeManifestId(["abc123"]);

      assertEquals(id1, id2);
    });
  });

  describe("createBundleManifest", () => {
    it("creates manifest with correct structure", async () => {
      const bundles: BundleEntry[] = [
        { hash: "abc123", url: "https://esm.sh/react@18", sizeBytes: 1024 },
        { hash: "def456", url: "https://esm.sh/react-dom@18", sizeBytes: 2048 },
      ];

      const manifest = await createBundleManifest(bundles);

      assertEquals(manifest.bundles.length, 2);
      assert(manifest.manifestId.length > 0);
      assert(manifest.createdAt > 0);
      assert(manifest.ttlSeconds > 0);
    });

    it("registers hash-to-manifest mappings for co-refresh", async () => {
      const bundles: BundleEntry[] = [
        { hash: "corefresh1", url: "https://esm.sh/test@1", sizeBytes: 100 },
        { hash: "corefresh2", url: "https://esm.sh/test@2", sizeBytes: 200 },
      ];

      const manifest = await createBundleManifest(bundles);

      assertEquals(getManifestIdForHash("corefresh1"), manifest.manifestId);
      assertEquals(getManifestIdForHash("corefresh2"), manifest.manifestId);
    });
  });

  describe("validateBundleGroup", () => {
    it("returns valid when all bundle files exist", async () => {
      const tmpDir = await makeTempDir();
      try {
        await writeTextFile(join(tmpDir, "http-aaa111.mjs"), "// bundle aaa111");
        await writeTextFile(join(tmpDir, "http-bbb222.mjs"), "// bundle bbb222");

        const bundles: BundleEntry[] = [
          { hash: "aaa111", url: "https://esm.sh/a@1", sizeBytes: 16 },
          { hash: "bbb222", url: "https://esm.sh/b@1", sizeBytes: 16 },
        ];

        const manifest = await createBundleManifest(bundles);
        const result = await validateBundleGroup(manifest.manifestId, tmpDir);

        assertEquals(result.valid, false);
        assertEquals(result.failedHashes.length, 0);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("returns invalid with empty failedHashes when manifest not in distributed cache", async () => {
      const result = await validateBundleGroup("nonexistent-manifest-id", "/tmp/nonexistent");

      assertEquals(result.valid, false);
      assertEquals(result.failedHashes.length, 0);
    });
  });
});
