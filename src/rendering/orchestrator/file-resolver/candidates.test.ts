import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildCandidatePaths, findFirstExisting } from "./candidates.ts";

describe("rendering/orchestrator/file-resolver/candidates", () => {
  describe("buildCandidatePaths", () => {
    it("should build direct and index paths", () => {
      const result = buildCandidatePaths("/app", "page", [".tsx", ".ts"]);
      assertEquals(result, [
        "/app/page.tsx",
        "/app/page.ts",
        "/app/page/index.tsx",
        "/app/page/index.ts",
      ]);
    });

    it("should return empty for empty extensions", () => {
      const result = buildCandidatePaths("/app", "page", []);
      assertEquals(result, []);
    });

    it("should handle single extension", () => {
      const result = buildCandidatePaths("/src", "utils", [".js"]);
      assertEquals(result, ["/src/utils.js", "/src/utils/index.js"]);
    });
  });

  describe("findFirstExisting", () => {
    it("should return first path that resolves", async () => {
      const existing = new Set(["/b.ts"]);
      const statFn = (p: string) =>
        existing.has(p) ? Promise.resolve({}) : Promise.reject(new Error("not found"));
      const result = await findFirstExisting(["/a.ts", "/b.ts", "/c.ts"], statFn);
      assertEquals(result, "/b.ts");
    });

    it("should return null when no candidates exist", async () => {
      const statFn = () => Promise.reject(new Error("not found"));
      const result = await findFirstExisting(["/a.ts", "/b.ts"], statFn);
      assertEquals(result, null);
    });

    it("should return null for empty candidates", async () => {
      const statFn = () => Promise.resolve({});
      const result = await findFirstExisting([], statFn);
      assertEquals(result, null);
    });

    it("should return first match when multiple exist", async () => {
      const statFn = () => Promise.resolve({});
      const result = await findFirstExisting(["/a.ts", "/b.ts"], statFn);
      assertEquals(result, "/a.ts");
    });
  });
});
