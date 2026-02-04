/**
 * Tests for banner component
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { resetColorCache } from "../colors.ts";
import { banner, errorBanner, inlineBanner, successBanner } from "./banner.ts";

describe("banner", () => {
  let originalForceColor: string | undefined;
  let originalNoColor: string | undefined;

  beforeAll(() => {
    originalForceColor = getEnv("FORCE_COLOR");
    originalNoColor = getEnv("NO_COLOR");

    if (originalNoColor !== undefined) deleteEnv("NO_COLOR");
    setEnv("FORCE_COLOR", "3");
    resetColorCache();
  });

  afterAll(() => {
    if (originalForceColor !== undefined) {
      setEnv("FORCE_COLOR", originalForceColor);
    } else {
      deleteEnv("FORCE_COLOR");
    }

    if (originalNoColor !== undefined) {
      setEnv("NO_COLOR", originalNoColor);
    } else {
      deleteEnv("NO_COLOR");
    }

    resetColorCache();
  });

  describe("banner", () => {
    it("returns a string", () => {
      const result = banner();
      assertEquals(typeof result, "string");
    });

    it("includes default title", () => {
      const result = banner();
      assertStringIncludes(result, "Veryfront");
    });

    it("includes custom title", () => {
      const result = banner({ title: "Custom Title" });
      assertStringIncludes(result, "Custom Title");
    });

    it("includes subtitle when provided", () => {
      const result = banner({ title: "Test", subtitle: "v1.0.0" });
      assertStringIncludes(result, "v1.0.0");
    });

    it("includes info values when provided", () => {
      const result = banner({
        info: { url: "http://localhost:3000", project: "my-app" },
      });
      assertStringIncludes(result, "http://localhost:3000");
      assertStringIncludes(result, "my-app");
    });

    it("respects showLogo option", () => {
      const withLogo = banner({ showLogo: true });
      const withoutLogo = banner({ showLogo: false });
      // Without logo should be shorter
      assertEquals(withoutLogo.length < withLogo.length, true);
    });

    it("uses box formatting", () => {
      const result = banner();
      // Should contain box drawing characters
      assertStringIncludes(result, "─");
    });
  });

  describe("inlineBanner", () => {
    it("returns a string", () => {
      const result = inlineBanner();
      assertEquals(typeof result, "string");
    });

    it("includes title", () => {
      const result = inlineBanner({ title: "Test Banner" });
      assertStringIncludes(result, "Test Banner");
    });

    it("includes info when provided", () => {
      const result = inlineBanner({ info: { port: 3000 } });
      assertStringIncludes(result, "3000");
    });
  });

  describe("errorBanner", () => {
    it("returns a string", () => {
      const result = errorBanner("Something went wrong");
      assertEquals(typeof result, "string");
    });

    it("includes error message", () => {
      const result = errorBanner("File not found");
      assertStringIncludes(result, "File not found");
    });

    it("includes Error title", () => {
      const result = errorBanner("Test error");
      assertStringIncludes(result, "Error");
    });

    it("includes suggestion when provided", () => {
      const result = errorBanner("Not found", "Check the path");
      assertStringIncludes(result, "Check the path");
    });

    it("uses red color codes", () => {
      const result = errorBanner("Error");
      // Should include red ANSI code
      assertStringIncludes(result, "\x1b[38;2;239;68;68m");
    });
  });

  describe("successBanner", () => {
    it("returns a string", () => {
      const result = successBanner("Operation completed");
      assertEquals(typeof result, "string");
    });

    it("includes success message", () => {
      const result = successBanner("Files saved");
      assertStringIncludes(result, "Files saved");
    });

    it("includes Success title with checkmark", () => {
      const result = successBanner("Done");
      assertStringIncludes(result, "Success");
    });

    it("includes info when provided", () => {
      const result = successBanner("Deployed", { url: "https://example.com" });
      assertStringIncludes(result, "https://example.com");
    });

    it("uses green color codes", () => {
      const result = successBanner("Success");
      // Should include green ANSI code
      assertStringIncludes(result, "\x1b[38;2;34;197;94m");
    });
  });
});
