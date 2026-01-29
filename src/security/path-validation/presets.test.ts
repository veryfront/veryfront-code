import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ValidationPresets } from "./presets.ts";

describe("ValidationPresets", () => {
  describe("userInput", () => {
    it("should use strict level", () => {
      const opts = ValidationPresets.userInput("/base");
      assertEquals(opts.level, "strict");
    });

    it("should set baseDir correctly", () => {
      const opts = ValidationPresets.userInput("/my/project");
      assertEquals(opts.baseDir, "/my/project");
    });

    it("should not allow absolute paths", () => {
      const opts = ValidationPresets.userInput("/base");
      assertEquals(opts.allowAbsolute, false);
    });

    it("should not follow symlinks", () => {
      const opts = ValidationPresets.userInput("/base");
      assertEquals(opts.followSymlinks, false);
    });

    it("should require file existence check", () => {
      const opts = ValidationPresets.userInput("/base");
      assertEquals(opts.checkExists, true);
    });

    it("should have a comprehensive list of allowed directories", () => {
      const opts = ValidationPresets.userInput("/base");
      assertEquals(Array.isArray(opts.allowedDirs), true);
      assertEquals(opts.allowedDirs!.includes("pages"), true);
      assertEquals(opts.allowedDirs!.includes("components"), true);
      assertEquals(opts.allowedDirs!.includes("public"), true);
      assertEquals(opts.allowedDirs!.includes("src"), true);
      assertEquals(opts.allowedDirs!.includes("app"), true);
    });
  });

  describe("internal", () => {
    it("should use normal level", () => {
      const opts = ValidationPresets.internal("/base");
      assertEquals(opts.level, "normal");
    });

    it("should not follow symlinks", () => {
      const opts = ValidationPresets.internal("/base");
      assertEquals(opts.followSymlinks, false);
    });

    it("should not check file existence", () => {
      const opts = ValidationPresets.internal("/base");
      assertEquals(opts.checkExists, false);
    });

    it("should not allow absolute paths", () => {
      const opts = ValidationPresets.internal("/base");
      assertEquals(opts.allowAbsolute, false);
    });

    it("should not restrict directories", () => {
      const opts = ValidationPresets.internal("/base");
      assertEquals(opts.allowedDirs, undefined);
    });
  });

  describe("build", () => {
    it("should use permissive level", () => {
      const opts = ValidationPresets.build("/base");
      assertEquals(opts.level, "permissive");
    });

    it("should follow symlinks", () => {
      const opts = ValidationPresets.build("/base");
      assertEquals(opts.followSymlinks, true);
    });

    it("should allow absolute paths", () => {
      const opts = ValidationPresets.build("/base");
      assertEquals(opts.allowAbsolute, true);
    });

    it("should not check file existence", () => {
      const opts = ValidationPresets.build("/base");
      assertEquals(opts.checkExists, false);
    });
  });

  describe("static", () => {
    it("should use normal level", () => {
      const opts = ValidationPresets.static("/base");
      assertEquals(opts.level, "normal");
    });

    it("should only allow dist and public directories", () => {
      const opts = ValidationPresets.static("/base");
      assertEquals(opts.allowedDirs, ["dist", "public"]);
    });

    it("should require file existence check", () => {
      const opts = ValidationPresets.static("/base");
      assertEquals(opts.checkExists, true);
    });

    it("should not follow symlinks", () => {
      const opts = ValidationPresets.static("/base");
      assertEquals(opts.followSymlinks, false);
    });

    it("should not allow absolute paths", () => {
      const opts = ValidationPresets.static("/base");
      assertEquals(opts.allowAbsolute, false);
    });
  });
});
