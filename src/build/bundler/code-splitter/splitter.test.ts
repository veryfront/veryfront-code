import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { BuildContext } from "veryfront/extensions/bundler";
import { CodeSplitter, rebuildAndDispose } from "./splitter.ts";

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

    it("should accept optional external config", () => {
      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [],
        external: ["lodash"],
        moduleResolution: "bundled",
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("rejects blank project and output directories", () => {
      assertThrows(
        () =>
          new CodeSplitter({
            projectDir: " ",
            outDir: "/output",
            mode: "production",
            routes: [],
          }),
        TypeError,
        "projectDir",
      );
      assertThrows(
        () =>
          new CodeSplitter({
            projectDir: "/project",
            outDir: "",
            mode: "production",
            routes: [],
          }),
        TypeError,
        "outDir",
      );
    });

    it("rejects route entry files outside projectDir", () => {
      assertThrows(
        () =>
          new CodeSplitter({
            projectDir: "/project",
            outDir: "/output",
            mode: "production",
            routes: [{ path: "/admin", file: "/outside/admin.tsx" }],
          }),
        TypeError,
        "outside projectDir",
      );
    });

    it("rejects an output directory that contains the project", () => {
      assertThrows(
        () =>
          new CodeSplitter({
            projectDir: "/project",
            outDir: "/",
            mode: "production",
            routes: [],
          }),
        TypeError,
        "must not contain projectDir",
      );
    });

    it("uses complete path segments for project containment", () => {
      assertThrows(
        () =>
          new CodeSplitter({
            projectDir: "/workspace/..project",
            outDir: "/workspace",
            mode: "production",
            routes: [],
          }),
        TypeError,
        "must not contain projectDir",
      );

      const splitter = new CodeSplitter({
        projectDir: "/project",
        outDir: "/output",
        mode: "production",
        routes: [{ path: "/hidden", file: "/project/..entry.tsx" }],
      });
      assertEquals(splitter instanceof CodeSplitter, true);
    });

    it("rejects invalid optional configuration", () => {
      assertThrows(
        () =>
          new CodeSplitter({
            projectDir: "/project",
            outDir: "/output",
            mode: "production",
            routes: [],
            external: [""],
          }),
        TypeError,
        "external",
      );
      assertThrows(
        () =>
          new CodeSplitter({
            projectDir: "/project",
            outDir: "/output",
            mode: "production",
            routes: [],
            moduleResolution: "invalid" as never,
          }),
        TypeError,
        "moduleResolution",
      );
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

    it("disposes the build context when rebuild fails", async () => {
      const rebuildError = new Error("intentional rebuild failure");
      let disposed = false;
      const buildContext: BuildContext = {
        rebuild() {
          return Promise.reject(rebuildError);
        },
        dispose() {
          disposed = true;
          return Promise.resolve();
        },
      };

      const error = await assertRejects(
        () => rebuildAndDispose(buildContext),
        Error,
        "intentional rebuild failure",
      );

      assertEquals(error, rebuildError);
      assertEquals(disposed, true);
    });

    it("reports both rebuild and disposal errors", async () => {
      const rebuildError = new Error("primary rebuild failure");
      const buildContext: BuildContext = {
        rebuild() {
          return Promise.reject(rebuildError);
        },
        dispose() {
          return Promise.reject(new Error("secondary disposal failure"));
        },
      };

      const error = await assertRejects(
        () => rebuildAndDispose(buildContext),
        AggregateError,
        "Code splitting and context cleanup both failed",
      );

      assertEquals(error.errors[0], rebuildError);
      assertEquals((error.errors[1] as Error).message, "secondary disposal failure");
    });
  });
});
