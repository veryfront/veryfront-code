import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CodeSplitter } from "./splitter.ts";

describe("build/bundler/code-splitter/splitter", () => {
  describe("CodeSplitter", () => {
    it("should construct with valid options", () => {
      const splitter = new CodeSplitter({
        projectDir: "/tmp/project",
        outDir: "/tmp/output",
        mode: "production",
        routes: [],
      });
      assertExists(splitter);
    });

    it("should have a split method", () => {
      const splitter = new CodeSplitter({
        projectDir: "/tmp/project",
        outDir: "/tmp/output",
        mode: "development",
        routes: [{ path: "/", file: "index.tsx", name: "index" }],
      });
      assertEquals(typeof splitter.split, "function");
    });
  });
});
