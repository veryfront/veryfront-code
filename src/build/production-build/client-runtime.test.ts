import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateAppModule } from "./client-runtime.ts";

describe("build/production-build/client-runtime", () => {
  describe("generateAppModule", () => {
    it("should return a non-empty string", () => {
      const result = generateAppModule();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should contain version export", () => {
      const result = generateAppModule();
      assertEquals(result.includes("export const version"), true);
      assertEquals(result.includes("2.0.0"), true);
    });

    it("should contain hydrate export", () => {
      const result = generateAppModule();
      assertEquals(result.includes("export const hydrate"), true);
    });

    it("should contain window.__veryfront setup", () => {
      const result = generateAppModule();
      assertEquals(result.includes("window.__veryfront"), true);
      assertEquals(result.includes("__veryfront.initialized"), true);
    });

    it("should set data-hydrated attribute on root element", () => {
      const result = generateAppModule();
      assertEquals(result.includes("data-hydrated"), true);
      assertEquals(result.includes("getElementById('root')"), true);
    });
  });
});
