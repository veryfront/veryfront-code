import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CodeSplitter } from "./splitter.ts";

describe("build/bundler/code-splitter/splitter", () => {
  describe("CodeSplitter constructor", () => {
    it("should create an instance with options", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept development mode", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "development",
        routes: [{ path: "/", file: "/project/src/index.tsx" }],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept routes with names", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [
          { path: "/", file: "/project/src/index.tsx", name: "index" },
          { path: "/about", file: "/project/src/about.tsx", name: "about" },
        ],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("should accept optional external and shared config", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
        shared: ["react", "react-dom"],
        external: ["lodash"],
        moduleResolution: "bundled",
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });
  });

  describe("split method", () => {
    it("should have a split method", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
      });
      assertEquals(typeof splitter.split, "function");
    });
  });
});
