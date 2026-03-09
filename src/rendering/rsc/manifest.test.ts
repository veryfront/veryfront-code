import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildRscModules, buildVersionedManifest, type GraphIds } from "./manifest.ts";

describe("rendering/rsc/manifest", () => {
  describe("buildRscModules", () => {
    it("should return empty array when graphIds is undefined", async () => {
      const result = await buildRscModules("/project", undefined);
      assertEquals(result, []);
    });

    it("should return empty array when graphIds has no entries", async () => {
      const graphIds: GraphIds = { client: [], server: [] };
      const result = await buildRscModules("/project", graphIds);
      assertEquals(result, []);
    });
  });

  describe("buildVersionedManifest", () => {
    it("should return version 1 manifest with empty modules for undefined graphIds", async () => {
      const manifest = await buildVersionedManifest("/project", undefined);
      assertEquals(manifest.version, 1);
      assertEquals(manifest.modules, []);
      assertEquals(typeof manifest.hash, "string");
      assertEquals(manifest.hash.length > 0, true);
    });

    it("should return version 1 manifest with empty modules for empty graphIds", async () => {
      const graphIds: GraphIds = { client: [], server: [] };
      const manifest = await buildVersionedManifest("/project", graphIds);
      assertEquals(manifest.version, 1);
      assertEquals(manifest.modules.length, 0);
    });

    it("should return consistent hash for same input", async () => {
      const m1 = await buildVersionedManifest("/project", undefined);
      const m2 = await buildVersionedManifest("/project", undefined);
      assertEquals(m1.hash, m2.hash);
    });
  });
});
