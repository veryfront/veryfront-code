import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import * as BunExports from "./bun.ts";

describe("platform/adapters/bun", () => {
  describe("exports", () => {
    it("should export BunAdapter", () => {
      assert(BunExports.BunAdapter !== undefined, "BunAdapter should be exported");
    });

    it("should export bunAdapter", () => {
      assert(BunExports.bunAdapter !== undefined, "bunAdapter should be exported");
    });

    it("should export BunEnvironmentAdapter", () => {
      assert(BunExports.BunEnvironmentAdapter !== undefined, "BunEnvironmentAdapter should be exported");
    });

    it("should export BunFileSystemAdapter", () => {
      assert(BunExports.BunFileSystemAdapter !== undefined, "BunFileSystemAdapter should be exported");
    });

    it("should export BunServer", () => {
      assert(BunExports.BunServer !== undefined, "BunServer should be exported");
    });

    it("should export BunServerAdapter", () => {
      assert(BunExports.BunServerAdapter !== undefined, "BunServerAdapter should be exported");
    });

    it("should export BunWebSocket", () => {
      assert(BunExports.BunWebSocket !== undefined, "BunWebSocket should be exported");
    });

    it("should export createBunServer", () => {
      assert(BunExports.createBunServer !== undefined, "createBunServer should be exported");
    });
  });
});
