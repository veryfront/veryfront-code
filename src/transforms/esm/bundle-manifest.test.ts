import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/esm/bundle-manifest.test */

import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  type BundleEntry,
  computeManifestId,
  createBundleManifest,
  getManifestIdForHash,
  parseBundleManifest,
  storeBundleManifest,
  validateBundleGraphAuthority,
  validateBundleGroup,
  validateBundleManifest,
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

    it("deduplicates and orders entries deterministically", async () => {
      const first = { hash: "bbb222", url: "https://esm.sh/b@1", sizeBytes: 20 };
      const second = { hash: "aaa111", url: "https://esm.sh/a@1", sizeBytes: 10 };

      const manifest = await createBundleManifest([first, second, first]);

      assertEquals(manifest.bundles, [second, first]);
    });
  });

  describe("storeBundleManifest", () => {
    it("returns false when durable storage is unavailable", async () => {
      const manifest = await createBundleManifest([
        { hash: "abc123", url: "https://esm.sh/a@1", sizeBytes: 10 },
      ]);

      assertEquals(await storeBundleManifest(manifest), false);
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

    it("treats only the authenticated hash set as content-addressed authority", async () => {
      const original = await createBundleManifest([
        { hash: "aaa111", url: "https://esm.sh/a@1", sizeBytes: 10 },
        { hash: "bbb222", url: "https://esm.sh/b@1", sizeBytes: 20 },
      ]);
      const refreshedMetadata = {
        ...original,
        createdAt: original.createdAt + 10_000,
        ttlSeconds: original.ttlSeconds + 60,
        bundles: original.bundles.map((bundle) => ({
          ...bundle,
          url: `${bundle.url}?refresh=1`,
          sizeBytes: bundle.sizeBytes + 1,
        })),
      };

      const parsedOriginal = await parseBundleManifest(
        JSON.stringify(original),
        original.manifestId,
      );
      const parsedRefresh = await parseBundleManifest(
        JSON.stringify(refreshedMetadata),
        original.manifestId,
      );
      assert(parsedOriginal);
      assert(parsedRefresh);
      assertEquals(
        parsedRefresh.bundles.map(({ hash }) => hash),
        parsedOriginal.bundles.map(({ hash }) => hash),
      );
      assertEquals(
        validateBundleGraphAuthority(parsedOriginal, ["aaa111"]),
        { valid: true, failedHashes: [] },
      );
      assertEquals(
        validateBundleGraphAuthority(parsedRefresh, ["aaa111"]),
        { valid: true, failedHashes: [] },
      );

      const forgedHashSet = {
        ...refreshedMetadata,
        bundles: [
          refreshedMetadata.bundles[0],
          { ...refreshedMetadata.bundles[1], hash: "ccc333" },
        ],
      };
      assertEquals(
        await parseBundleManifest(JSON.stringify(forgedHashSet), original.manifestId),
        null,
      );
    });

    it("rejects direct code hashes absent from the authenticated graph authority", async () => {
      const manifest = await createBundleManifest([
        { hash: "aaa111", url: "https://esm.sh/a@1", sizeBytes: 10 },
        { hash: "bbb222", url: "https://esm.sh/b@1", sizeBytes: 20 },
      ]);

      assertEquals(
        validateBundleGraphAuthority(manifest, ["aaa111", "ccc333"]),
        {
          valid: false,
          failedHashes: ["ccc333"],
          reason: "manifest_mismatch",
        },
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
