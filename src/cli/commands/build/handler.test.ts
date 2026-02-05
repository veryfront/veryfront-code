import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleBuildCommand } from "./handler.ts";
import type { BuildCommandArgs } from "../../shared/types.ts";

describe("commands/build/handler", () => {
  describe("handleBuildCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleBuildCommand, "function");
      assertEquals(handleBuildCommand.constructor.name, "AsyncFunction");
    });

    it("accepts BuildCommandArgs parameter", () => {
      assertEquals(handleBuildCommand.length, 1);
    });
  });

  describe("BuildCommandArgs interface", () => {
    it("supports output directory via --output flag", () => {
      const args: BuildCommandArgs = {
        _: ["build"],
        output: "custom-dist",
      };
      assertEquals(args.output, "custom-dist");
    });

    it("supports output directory via -o shorthand", () => {
      const args: BuildCommandArgs = {
        _: ["build"],
        o: "build",
      };
      assertEquals(args.o, "build");
    });

    it("supports preset flag for embedded builds", () => {
      const args: BuildCommandArgs = {
        _: ["build"],
        preset: "embedded",
      };
      assertEquals(args.preset, "embedded");
    });

    it("supports feature flags", () => {
      const args: BuildCommandArgs = {
        _: ["build"],
        split: true,
        compress: true,
        prefetch: false,
        ssg: true,
      };
      assertEquals(args.split, true);
      assertEquals(args.compress, true);
      assertEquals(args.prefetch, false);
      assertEquals(args.ssg, true);
    });

    it("supports no-ssg flag", () => {
      const args: BuildCommandArgs = {
        _: ["build"],
        "no-ssg": true,
      };
      assertEquals(args["no-ssg"], true);
    });

    it("supports include and exclude patterns", () => {
      const args: BuildCommandArgs = {
        _: ["build"],
        include: "pages/**,app/**",
        exclude: "**/*.test.ts",
      };
      assertEquals(args.include, "pages/**,app/**");
      assertEquals(args.exclude, "**/*.test.ts");
    });

    it("supports dry-run flags", () => {
      const args1: BuildCommandArgs = {
        _: ["build"],
        "dry-run": true,
      };
      const args2: BuildCommandArgs = {
        _: ["build"],
        dryrun: true,
      };
      assertEquals(args1["dry-run"], true);
      assertEquals(args2.dryrun, true);
    });
  });
});
