import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleBuildCommand, parseBuildArgs } from "./handler.ts";

describe("commands/build/handler", () => {
  describe("handleBuildCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleBuildCommand, "function");
      assertEquals(handleBuildCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleBuildCommand.length, 1);
    });
  });

  describe("parseBuildArgs", () => {
    it("parses output directory via --output flag", () => {
      const result = parseBuildArgs({
        _: ["build"],
        output: "custom-dist",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.output, "custom-dist");
    });

    it("parses output directory via -o shorthand", () => {
      const result = parseBuildArgs({
        _: ["build"],
        o: "build",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.output, "build");
    });

    it("parses preset flag for embedded builds", () => {
      const result = parseBuildArgs({
        _: ["build"],
        preset: "embedded",
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.preset, "embedded");
    });

    it("parses feature flags with defaults", () => {
      const result = parseBuildArgs({ _: ["build"] });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.split, true);
        assertEquals(result.data.compress, true);
        assertEquals(result.data.prefetch, true);
        assertEquals(result.data.ssg, true);
      }
    });

    it("overrides feature flags when set to false", () => {
      const result = parseBuildArgs({
        _: ["build"],
        split: false,
        compress: false,
        prefetch: false,
        ssg: false,
      });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.split, false);
        assertEquals(result.data.compress, false);
        assertEquals(result.data.prefetch, false);
        assertEquals(result.data.ssg, false);
      }
    });

    it("parses no-ssg flag", () => {
      const result = parseBuildArgs({
        _: ["build"],
        "no-ssg": true,
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.noSsg, true);
    });

    it("parses dry-run flag", () => {
      const result = parseBuildArgs({
        _: ["build"],
        "dry-run": true,
      });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.dryRun, true);
    });
  });
});
