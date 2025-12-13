import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { BunEnvironmentAdapter } from "./environment-adapter.ts";

describe("platform/adapters/bun/environment-adapter", () => {
  describe("BunEnvironmentAdapter", () => {
    it("should have get method", () => {
      const adapter = new BunEnvironmentAdapter();
      assert(typeof adapter.get === "function", "get should be a function");
    });

    it("should have set method", () => {
      const adapter = new BunEnvironmentAdapter();
      assert(typeof adapter.set === "function", "set should be a function");
    });

    it("should have toObject method", () => {
      const adapter = new BunEnvironmentAdapter();
      assert(typeof adapter.toObject === "function", "toObject should be a function");
    });

    it("should implement EnvironmentAdapter interface", () => {
      const adapter = new BunEnvironmentAdapter();

      // Verify all required methods exist
      assert(typeof adapter.get === "function");
      assert(typeof adapter.set === "function");
      assert(typeof adapter.toObject === "function");
    });
  });
});
