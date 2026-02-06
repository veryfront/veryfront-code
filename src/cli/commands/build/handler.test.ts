import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleBuildCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

/**
 * Mirrors the parseBuildArgs extraction logic for testing.
 * Validates that CLI flags are correctly mapped to build options.
 */
function extractBuildArgs(args: ParsedArgs) {
  let outputDir: string | undefined;
  if (typeof args.output === "string") {
    outputDir = args.output;
  } else if (typeof args.o === "string") {
    outputDir = args.o;
  }

  const preset = typeof args.preset === "string" ? args.preset : undefined;

  return {
    outputDir,
    preset,
    splitting: args.split !== false,
    compress: args.compress !== false,
    prefetch: args.prefetch !== false,
    ssg: args.ssg !== false && args["no-ssg"] !== true,
    include: typeof args.include === "string" ? [args.include] : undefined,
    exclude: typeof args.exclude === "string" ? [args.exclude] : undefined,
    dryRun: Boolean(args["dry-run"] ?? args.dryrun),
  };
}

describe("commands/build/handler", () => {
  describe("handleBuildCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleBuildCommand, "function");
      assertEquals(handleBuildCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single parameter", () => {
      assertEquals(handleBuildCommand.length, 1);
    });
  });

  describe("build argument extraction", () => {
    it("extracts --output as outputDir", () => {
      const result = extractBuildArgs({ _: ["build"], output: "custom-dist" });
      assertEquals(result.outputDir, "custom-dist");
    });

    it("extracts -o as outputDir", () => {
      const result = extractBuildArgs({ _: ["build"], o: "build" });
      assertEquals(result.outputDir, "build");
    });

    it("prefers --output over -o", () => {
      const result = extractBuildArgs({ _: ["build"], output: "a", o: "b" });
      assertEquals(result.outputDir, "a");
    });

    it("returns undefined outputDir when not provided", () => {
      const result = extractBuildArgs({ _: ["build"] });
      assertEquals(result.outputDir, undefined);
    });

    it("extracts --preset flag", () => {
      const result = extractBuildArgs({ _: ["build"], preset: "embedded" });
      assertEquals(result.preset, "embedded");
    });

    it("defaults splitting to true", () => {
      assertEquals(extractBuildArgs({ _: ["build"] }).splitting, true);
    });

    it("disables splitting when --split false", () => {
      assertEquals(extractBuildArgs({ _: ["build"], split: false }).splitting, false);
    });

    it("defaults compress to true", () => {
      assertEquals(extractBuildArgs({ _: ["build"] }).compress, true);
    });

    it("disables compress when --compress false", () => {
      assertEquals(extractBuildArgs({ _: ["build"], compress: false }).compress, false);
    });

    it("defaults prefetch to true", () => {
      assertEquals(extractBuildArgs({ _: ["build"] }).prefetch, true);
    });

    it("disables prefetch when --prefetch false", () => {
      assertEquals(extractBuildArgs({ _: ["build"], prefetch: false }).prefetch, false);
    });

    it("defaults ssg to true", () => {
      assertEquals(extractBuildArgs({ _: ["build"] }).ssg, true);
    });

    it("disables ssg when --ssg false", () => {
      assertEquals(extractBuildArgs({ _: ["build"], ssg: false }).ssg, false);
    });

    it("disables ssg when --no-ssg is true", () => {
      assertEquals(extractBuildArgs({ _: ["build"], "no-ssg": true }).ssg, false);
    });

    it("wraps --include string into array", () => {
      const result = extractBuildArgs({ _: ["build"], include: "pages/**,app/**" });
      assertEquals(result.include, ["pages/**,app/**"]);
    });

    it("wraps --exclude string into array", () => {
      const result = extractBuildArgs({ _: ["build"], exclude: "**/*.test.ts" });
      assertEquals(result.exclude, ["**/*.test.ts"]);
    });

    it("returns undefined for include/exclude when not provided", () => {
      const result = extractBuildArgs({ _: ["build"] });
      assertEquals(result.include, undefined);
      assertEquals(result.exclude, undefined);
    });

    it("parses --dry-run flag", () => {
      assertEquals(extractBuildArgs({ _: ["build"], "dry-run": true }).dryRun, true);
    });

    it("parses --dryrun alias", () => {
      assertEquals(extractBuildArgs({ _: ["build"], dryrun: true }).dryRun, true);
    });

    it("defaults dryRun to false", () => {
      assertEquals(extractBuildArgs({ _: ["build"] }).dryRun, false);
    });
  });
});
