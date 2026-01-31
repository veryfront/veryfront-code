import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ValidationPresets } from "./presets.ts";

describe("ValidationPresets", () => {
  describe("userInput", () => {
    it("should use strict level", () => {
      assertEquals(ValidationPresets.userInput("/base").level, "strict");
    });

    it("should set baseDir correctly", () => {
      assertEquals(ValidationPresets.userInput("/my/project").baseDir, "/my/project");
    });

    it("should not allow absolute paths", () => {
      assertEquals(ValidationPresets.userInput("/base").allowAbsolute, false);
    });

    it("should not follow symlinks", () => {
      assertEquals(ValidationPresets.userInput("/base").followSymlinks, false);
    });

    it("should require file existence check", () => {
      assertEquals(ValidationPresets.userInput("/base").checkExists, true);
    });

    it("should have a comprehensive list of allowed directories", () => {
      const { allowedDirs } = ValidationPresets.userInput("/base");
      assertEquals(Array.isArray(allowedDirs), true);
      assertEquals(allowedDirs?.includes("pages"), true);
      assertEquals(allowedDirs?.includes("components"), true);
      assertEquals(allowedDirs?.includes("public"), true);
      assertEquals(allowedDirs?.includes("src"), true);
      assertEquals(allowedDirs?.includes("app"), true);
    });
  });

  describe("internal", () => {
    it("should use normal level", () => {
      assertEquals(ValidationPresets.internal("/base").level, "normal");
    });

    it("should not follow symlinks", () => {
      assertEquals(ValidationPresets.internal("/base").followSymlinks, false);
    });

    it("should not check file existence", () => {
      assertEquals(ValidationPresets.internal("/base").checkExists, false);
    });

    it("should not allow absolute paths", () => {
      assertEquals(ValidationPresets.internal("/base").allowAbsolute, false);
    });

    it("should not restrict directories", () => {
      assertEquals(ValidationPresets.internal("/base").allowedDirs, undefined);
    });
  });

  describe("build", () => {
    it("should use permissive level", () => {
      assertEquals(ValidationPresets.build("/base").level, "permissive");
    });

    it("should follow symlinks", () => {
      assertEquals(ValidationPresets.build("/base").followSymlinks, true);
    });

    it("should allow absolute paths", () => {
      assertEquals(ValidationPresets.build("/base").allowAbsolute, true);
    });

    it("should not check file existence", () => {
      assertEquals(ValidationPresets.build("/base").checkExists, false);
    });
  });

  describe("static", () => {
    it("should use normal level", () => {
      assertEquals(ValidationPresets.static("/base").level, "normal");
    });

    it("should only allow dist and public directories", () => {
      assertEquals(ValidationPresets.static("/base").allowedDirs, ["dist", "public"]);
    });

    it("should require file existence check", () => {
      assertEquals(ValidationPresets.static("/base").checkExists, true);
    });

    it("should not follow symlinks", () => {
      assertEquals(ValidationPresets.static("/base").followSymlinks, false);
    });

    it("should not allow absolute paths", () => {
      assertEquals(ValidationPresets.static("/base").allowAbsolute, false);
    });
  });
});
