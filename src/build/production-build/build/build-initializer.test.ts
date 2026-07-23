import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeBuildOptions } from "./build-initializer.ts";
import { resolve } from "#veryfront/compat/path/index.ts";

describe("build/production-build/build/build-initializer", () => {
  describe("normalizeBuildOptions", () => {
    it("should preserve projectDir", () => {
      const result = normalizeBuildOptions({ projectDir: "/my-project" });
      assertEquals(result.projectDir, "/my-project");
    });

    it("normalizes relative project and output directories to absolute paths", () => {
      const result = normalizeBuildOptions({ projectDir: ".", outputDir: "./dist" });
      assertEquals(result.projectDir, resolve("."));
      assertEquals(result.outputDir, resolve("./dist"));
    });

    it("should default outputDir to .veryfront/output", () => {
      const result = normalizeBuildOptions({ projectDir: "/my-project" });
      assertEquals(result.outputDir?.includes(".veryfront/output"), true);
    });

    it("should use provided outputDir", () => {
      const result = normalizeBuildOptions({
        projectDir: "/my-project",
        outputDir: "/custom/output",
      });
      assertEquals(result.outputDir, "/custom/output");
    });

    it("rejects the project directory as the build output", () => {
      assertThrows(
        () => normalizeBuildOptions({ projectDir: "/my-project", outputDir: "/my-project" }),
        TypeError,
        "must not be the project directory",
      );
    });

    it("rejects a project ancestor as the build output", () => {
      assertThrows(
        () => normalizeBuildOptions({ projectDir: "/workspace/project", outputDir: "/workspace" }),
        TypeError,
        "must not be the project directory",
      );
    });

    it("rejects a project ancestor when the child name starts with two dots", () => {
      assertThrows(
        () =>
          normalizeBuildOptions({ projectDir: "/workspace/..project", outputDir: "/workspace" }),
        TypeError,
        "must not be the project directory",
      );
    });

    it("rejects empty project directories", () => {
      assertThrows(
        () => normalizeBuildOptions({ projectDir: "  " }),
        TypeError,
        "projectDir must be a non-empty string",
      );
    });

    it("rejects a filesystem root as the project", () => {
      assertThrows(
        () => normalizeBuildOptions({ projectDir: "/" }),
        TypeError,
        "filesystem root",
      );
    });

    it("should default enableSplitting to true", () => {
      const result = normalizeBuildOptions({ projectDir: "/project" });
      assertEquals(result.enableSplitting, true);
    });

    it("should default enableCompression to true", () => {
      const result = normalizeBuildOptions({ projectDir: "/project" });
      assertEquals(result.enableCompression, true);
    });

    it("should default enablePrefetch to true", () => {
      const result = normalizeBuildOptions({ projectDir: "/project" });
      assertEquals(result.enablePrefetch, true);
    });

    it("should default ssg to false", () => {
      const result = normalizeBuildOptions({ projectDir: "/project" });
      assertEquals(result.ssg, false);
    });

    it("should respect explicitly enabled ssg", () => {
      const result = normalizeBuildOptions({ projectDir: "/project", ssg: true });
      assertEquals(result.ssg, true);
    });

    it("should default dryRun to false", () => {
      const result = normalizeBuildOptions({ projectDir: "/project" });
      assertEquals(result.dryRun, false);
    });

    it("should respect explicitly set false values", () => {
      const result = normalizeBuildOptions({
        projectDir: "/project",
        enableSplitting: false,
        enableCompression: false,
        enablePrefetch: false,
        ssg: false,
        dryRun: true,
      });
      assertEquals(result.enableSplitting, false);
      assertEquals(result.enableCompression, false);
      assertEquals(result.enablePrefetch, false);
      assertEquals(result.ssg, false);
      assertEquals(result.dryRun, true);
    });

    it("supports the documented shorthand feature flags", () => {
      const result = normalizeBuildOptions({
        projectDir: "/project",
        splitting: false,
        compress: false,
        prefetch: false,
      });

      assertEquals(result.enableSplitting, false);
      assertEquals(result.enableCompression, false);
      assertEquals(result.enablePrefetch, false);
    });

    it("gives verbose feature flags precedence over shorthand flags", () => {
      const result = normalizeBuildOptions({
        projectDir: "/project",
        splitting: false,
        enableSplitting: true,
        compress: false,
        enableCompression: true,
        prefetch: false,
        enablePrefetch: true,
      });

      assertEquals(result.enableSplitting, true);
      assertEquals(result.enableCompression, true);
      assertEquals(result.enablePrefetch, true);
    });

    it("should pass through include and exclude arrays", () => {
      const result = normalizeBuildOptions({
        projectDir: "/project",
        include: ["/blog/*"],
        exclude: ["/admin/*"],
      });
      assertEquals(result.include, ["/blog/*"]);
      assertEquals(result.exclude, ["/admin/*"]);
    });

    it("validates feature flags and route patterns at runtime", () => {
      assertThrows(
        () => normalizeBuildOptions({ projectDir: "/project", ssg: "yes" as never }),
        TypeError,
        "ssg must be a boolean",
      );
      assertThrows(
        () => normalizeBuildOptions({ projectDir: "/project", include: [""] }),
        TypeError,
        "include",
      );
      assertThrows(
        () => normalizeBuildOptions({ projectDir: "/project", exclude: ["/a", "/a"] }),
        TypeError,
        "duplicate",
      );
    });
  });
});
