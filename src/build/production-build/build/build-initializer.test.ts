import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeBuildOptions } from "./build-initializer.ts";

describe("build/production-build/build/build-initializer", () => {
  describe("normalizeBuildOptions", () => {
    it("should preserve projectDir", () => {
      const result = normalizeBuildOptions({ projectDir: "/my-project" });
      assertEquals(result.projectDir, "/my-project");
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

    it("should default ssg to true", () => {
      const result = normalizeBuildOptions({ projectDir: "/project" });
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

    it("should pass through include and exclude arrays", () => {
      const result = normalizeBuildOptions({
        projectDir: "/project",
        include: ["/blog/*"],
        exclude: ["/admin/*"],
      });
      assertEquals(result.include, ["/blog/*"]);
      assertEquals(result.exclude, ["/admin/*"]);
    });
  });
});
