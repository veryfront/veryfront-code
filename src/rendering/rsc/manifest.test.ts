import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildRscModules, buildVersionedManifest, type GraphIds } from "./manifest.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

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

    it("builds deterministic modules from validated project files", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/app/card.tsx",
        "export const Card = () => null; export default Card;",
      );
      adapter.fs.files.set(
        "/project/app/button.tsx",
        "export const Button = () => null;",
      );
      const graphIds: GraphIds = {
        client: [
          { id: "Card", path: "/project/app/card.tsx", rel: "/card.tsx" },
          { id: "Button", path: "app/button.tsx", rel: "/button.tsx" },
        ],
        server: [],
      };

      assertEquals(await buildRscModules("/project", graphIds, adapter.fs), [
        {
          id: "Button",
          clientRef: "/app/button.tsx#Button",
          exports: ["Button"],
        },
        {
          id: "Card",
          clientRef: "/app/card.tsx#Card",
          exports: ["default", "Card"],
        },
      ]);
    });

    it("rejects source paths outside the project", async () => {
      const adapter = createMockAdapter();
      const graphIds: GraphIds = {
        client: [{ id: "Escape", path: "/outside.tsx", rel: "/escape.tsx" }],
        server: [],
      };

      await assertRejects(
        () => buildRscModules("/project", graphIds, adapter.fs),
        TypeError,
        "source must stay inside the project",
      );
    });

    it("propagates missing source failures instead of inventing exports", async () => {
      const adapter = createMockAdapter();
      const graphIds: GraphIds = {
        client: [{ id: "Missing", path: "/project/missing.tsx", rel: "/missing.tsx" }],
        server: [],
      };

      await assertRejects(
        () => buildRscModules("/project", graphIds, adapter.fs),
        Error,
        "Path not found",
      );
    });

    it("rejects duplicate module IDs", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/a.tsx", "export default function A() {};");
      adapter.fs.files.set("/project/b.tsx", "export default function B() {};");
      const graphIds: GraphIds = {
        client: [{ id: "Duplicate", path: "/project/a.tsx", rel: "/a.tsx" }],
        server: [{ id: "Duplicate", path: "/project/b.tsx", rel: "/b.tsx" }],
      };

      await assertRejects(
        () => buildRscModules("/project", graphIds, adapter.fs),
        TypeError,
        "duplicate module ID",
      );
    });
  });

  describe("buildVersionedManifest", () => {
    it("should return version 1 manifest with empty modules for undefined graphIds", async () => {
      const manifest = await buildVersionedManifest("/project", undefined);
      assertEquals(manifest.version, 1);
      assertEquals(manifest.modules, []);
      assertEquals(typeof manifest.hash, "string");
      assertEquals(manifest.hash.length, 64);
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
