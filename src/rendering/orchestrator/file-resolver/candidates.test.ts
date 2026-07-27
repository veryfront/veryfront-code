import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createError, toError } from "#veryfront/errors";
import { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

describe("rendering/orchestrator/file-resolver/candidates", () => {
  describe("buildCandidatePaths", () => {
    it("should build direct and index paths", () => {
      assertEquals(buildCandidatePaths("/app", "page", [".tsx", ".ts"]), [
        "/app/page.tsx",
        "/app/page/index.tsx",
        "/app/page.ts",
        "/app/page/index.ts",
      ]);
    });

    it("should return empty for empty extensions", () => {
      assertEquals(buildCandidatePaths("/app", "page", []), []);
    });

    it("should handle single extension", () => {
      assertEquals(buildCandidatePaths("/src", "utils", [".js"]), [
        "/src/utils.js",
        "/src/utils/index.js",
      ]);
    });
  });

  describe("findFirstExisting", () => {
    it("should return first path that resolves", async () => {
      const existing = new Set(["/b.ts"]);
      const statFn = (p: string) =>
        existing.has(p)
          ? Promise.resolve({})
          : Promise.reject(Object.assign(new Error("not found"), { code: "ENOENT" }));

      assertEquals(await findFirstExisting(["/a.ts", "/b.ts", "/c.ts"], statFn), "/b.ts");
    });

    it("should return null when no candidates exist", async () => {
      const statFn = () =>
        Promise.reject(Object.assign(new Error("not found"), { code: "ENOENT" }));
      assertEquals(await findFirstExisting(["/a.ts", "/b.ts"], statFn), null);
    });

    it("should return null for empty candidates", async () => {
      const statFn = () => Promise.resolve({});
      assertEquals(await findFirstExisting([], statFn), null);
    });

    it("continues after a hosted adapter reports a structured missing path", async () => {
      const missing = toError(
        createError({
          type: "file",
          message: "File not found: /a.ts",
        }),
      );
      const statFn = (path: string) =>
        path === "/a.ts" ? Promise.reject(missing) : Promise.resolve({});

      assertEquals(await findFirstExisting(["/a.ts", "/b.ts"], statFn), "/b.ts");
    });

    it("should return first match when multiple exist", async () => {
      const statFn = () => Promise.resolve({});
      assertEquals(await findFirstExisting(["/a.ts", "/b.ts"], statFn), "/a.ts");
    });

    it("propagates operational stat failures", async () => {
      const failure = Object.assign(new Error("storage unavailable"), { code: "EIO" });

      await assertRejects(
        () => findFirstExisting(["/a.ts", "/b.ts"], () => Promise.reject(failure)),
        Error,
        "storage unavailable",
      );
    });
  });
});
