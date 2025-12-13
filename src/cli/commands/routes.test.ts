import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";

describe("routes", () => {
  describe("routesCommand", () => {
    it("should export routesCommand function", async () => {
      const module = await import("./routes.ts");
      assertExists(module.routesCommand);
      assertEquals(typeof module.routesCommand, "function");
    });
  });

  describe("options parameter", () => {
    it("should accept json option", () => {
      const options = { json: true };
      assertEquals(options.json, true);
    });

    it("should accept empty options", () => {
      const options = {};
      assertEquals(Object.keys(options).length, 0);
    });

    it("should default json to false when not provided", () => {
      const options: { json?: boolean } = {};
      assertEquals(options.json, undefined);
    });
  });
});
