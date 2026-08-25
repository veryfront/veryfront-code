import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/esm/bundle-manifest.test */

import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  type BundleEntry,
  computeManifestId,
  createBundleManifest,
  getManifestIdForHash,
  parseBundleManifest,
  validateBundleGroup,
  validateBundleManifest,
} from "./bundle-manifest.ts";

describe("Bundle Manifest", () => {
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
      assert(manifest.manifestId.length > 0, "manifest id must be present");
      assert(manifest.createdAt > 0, "manifest must record a creation timestamp");
      assertEquals(
        manifest.ttlSeconds,
        BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC,
        "manifest must carry the distributed-cache TTL used by storeBundleManifest",
      );
    });

    it("registers hash-to-manifest mappings for co-refresh", async () => {
      const bundles: BundleEntry[] = [
        { hash: "c0efe511", url: "https://esm.sh/test@1", sizeBytes: 100 },
        { hash: "c0efe522", url: "https://esm.sh/test@2", sizeBytes: 200 },
      ];

      const manifest = await createBundleManifest(bundles);

      assertEquals(getManifestIdForHash("c0efe511"), manifest.manifestId);
      assertEquals(getManifestIdForHash("c0efe522"), manifest.manifestId);
    });

    it("rejects invalid bundle hashes before constructing cache paths", async () => {
      await assertRejects(
        () =>
          createBundleManifest([
            { hash: "../escape", url: "https://esm.sh/test@1", sizeBytes: 100 },
          ]),
        TypeError,
        "entry is invalid",
      );
    });

    it("rejects an empty bundle list", async () => {
      await assertRejects(
        () => createBundleManifest([]),
        TypeError,
        "Bundle manifest must contain",
        "an empty bundle list would collapse every manifest onto one shared identity",
      );
    });

    it("rejects a url containing a control character", async () => {
      await assertRejects(
        () =>
          createBundleManifest([
            { hash: "abc123", url: "https://esm.sh/a\n@1", sizeBytes: 10 },
          ]),
        TypeError,
        "entry is invalid",
        "a control character must never round-trip into the serialized manifest",
      );
    });

    it("rejects a url longer than the manifest url limit", async () => {
      // The module caps manifest urls at 8 KiB; anything longer must be refused.
      const overlongUrl = `https://esm.sh/${"a".repeat(8 * 1024)}`;

      await assertRejects(
        () => createBundleManifest([{ hash: "abc123", url: overlongUrl, sizeBytes: 10 }]),
        TypeError,
        "entry is invalid",
        "an overlong url must be refused before the manifest is built",
      );
    });

    it("rejects a negative bundle size", async () => {
      await assertRejects(
        () =>
          createBundleManifest([
            { hash: "abc123", url: "https://esm.sh/a@1", sizeBytes: -1 },
          ]),
        TypeError,
        "entry is invalid",
        "a negative byte count is not a valid bundle size",
      );
    });

    it("deduplicates and orders entries deterministically", async () => {
      const first = { hash: "bbb222", url: "https://esm.sh/b@1", sizeBytes: 20 };
      const second = { hash: "aaa111", url: "https://esm.sh/a@1", sizeBytes: 10 };

      const manifest = await createBundleManifest([first, second, first]);

      assertEquals(manifest.bundles, [second, first]);
    });
  });

  describe("parseBundleManifest", () => {
    it("authenticates a valid serialized manifest", async () => {
      const manifest = await createBundleManifest([
        { hash: "abc123", url: "https://esm.sh/a@1", sizeBytes: 10 },
      ]);

      assertEquals(
        await parseBundleManifest(JSON.stringify(manifest), manifest.manifestId),
        manifest,
      );
    });

    it("rejects tampered identities and path-shaped hashes", async () => {
      const manifest = await createBundleManifest([
        { hash: "abc123", url: "https://esm.sh/a@1", sizeBytes: 10 },
      ]);
      const tampered = {
        ...manifest,
        bundles: [{ ...manifest.bundles[0], hash: "../escape" }],
      };

      assertEquals(await parseBundleManifest(JSON.stringify(tampered)), null);
      assertEquals(
        await parseBundleManifest(JSON.stringify(manifest), "f".repeat(64)),
        null,
      );
    });

    it("rejects a manifest whose bundle list no longer derives its id", async () => {
      const manifest = await createBundleManifest([
        { hash: "abc123", url: "https://esm.sh/a@1", sizeBytes: 10 },
      ]);
      const swapped = {
        ...manifest,
        bundles: [{ ...manifest.bundles[0], hash: "deadbeef" }],
      };

      assertEquals(
        await parseBundleManifest(JSON.stringify(swapped)),
        null,
        "manifestId must authenticate the bundle hashes it names",
      );
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
        const result = await validateBundleManifest(manifest, tmpDir);

        assertEquals(
          result,
          { valid: true, failedHashes: [] },
          "a manifest whose bundles are all present on disk validates",
        );
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("returns invalid with empty failedHashes when manifest not in distributed cache", async () => {
      const result = await validateBundleGroup("nonexistent-manifest-id", "/tmp/nonexistent");

      assertEquals(result.valid, false);
      assertEquals(result.failedHashes.length, 0);
      assertEquals(result.reason, "manifest_missing");
    });

    it("uses the provided recovery function when manifest bundles are missing locally", async () => {
      const tmpDir = await makeTempDir();
      try {
        const bundles: BundleEntry[] = [
          { hash: "ec0e111", url: "https://esm.sh/recover@1", sizeBytes: 16 },
        ];
        const manifest = await createBundleManifest(bundles);
        let recovered = false;

        const result = await validateBundleManifest(manifest, tmpDir, async (missing, cacheDir) => {
          recovered = true;
          assertEquals(missing.map(({ hash }) => hash), ["ec0e111"]);
          assertEquals(cacheDir, tmpDir);
          await writeTextFile(join(tmpDir, "http-ec0e111.mjs"), "// recovered bundle");
          return [];
        });

        assertEquals(recovered, true);
        assertEquals(result.valid, true);
        assertEquals(result.failedHashes, []);
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });

    it("rejects a manifest whose present root has a missing transitive dependency", async () => {
      const tmpDir = await makeTempDir();
      try {
        await writeTextFile(
          join(tmpDir, "http-aaa111.mjs"),
          'import "./http-bbb222.mjs";',
        );
        const manifest = await createBundleManifest([
          { hash: "aaa111", url: "https://esm.sh/root@1", sizeBytes: 29 },
        ]);

        const result = await validateBundleManifest(manifest, tmpDir);

        assertEquals(result.valid, false);
        assertEquals(result.reason, "bundle_missing");
      } finally {
        await remove(tmpDir, { recursive: true });
      }
    });
  });
});
