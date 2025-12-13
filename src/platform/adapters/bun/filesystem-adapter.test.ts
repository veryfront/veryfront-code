import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { BunFileSystemAdapter } from "./filesystem-adapter.ts";

describe("platform/adapters/bun/filesystem-adapter", () => {
  describe("BunFileSystemAdapter", () => {
    it("should have readFile method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.readFile === "function", "readFile should be a function");
    });

    it("should have readFileBytes method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.readFileBytes === "function", "readFileBytes should be a function");
    });

    it("should have writeFile method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.writeFile === "function", "writeFile should be a function");
    });

    it("should have exists method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.exists === "function", "exists should be a function");
    });

    it("should have readDir method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.readDir === "function", "readDir should be a function");
    });

    it("should have stat method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.stat === "function", "stat should be a function");
    });

    it("should have mkdir method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.mkdir === "function", "mkdir should be a function");
    });

    it("should have remove method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.remove === "function", "remove should be a function");
    });

    it("should have makeTempDir method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.makeTempDir === "function", "makeTempDir should be a function");
    });

    it("should have watch method", () => {
      const adapter = new BunFileSystemAdapter();
      assert(typeof adapter.watch === "function", "watch should be a function");
    });

    it("should implement FileSystemAdapter interface", () => {
      const adapter = new BunFileSystemAdapter();

      // Verify all required methods exist
      assert(typeof adapter.readFile === "function");
      assert(typeof adapter.writeFile === "function");
      assert(typeof adapter.exists === "function");
      assert(typeof adapter.readDir === "function");
      assert(typeof adapter.stat === "function");
      assert(typeof adapter.mkdir === "function");
      assert(typeof adapter.remove === "function");
      assert(typeof adapter.makeTempDir === "function");
      assert(typeof adapter.watch === "function");
    });
  });
});
