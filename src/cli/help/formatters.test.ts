import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  formatHeader,
  formatCommandName,
  formatDescription,
  formatUsage,
  formatOption,
  formatExample,
  formatSectionHeader,
  formatCommandHeader,
  formatAsciiLogo,
  calculateMaxLength,
  formatCommandList,
} from "./formatters.ts";

describe("formatters", () => {
  describe("formatHeader", () => {
    it("should export formatHeader function", () => {
      assertExists(formatHeader);
      assertEquals(typeof formatHeader, "function");
    });

    it("should return formatted header string", () => {
      const result = formatHeader();
      assertExists(result);
      assertEquals(typeof result, "string");
    });
  });

  describe("formatCommandName", () => {
    it("should format command name with padding", () => {
      const result = formatCommandName("dev", 10);
      assertExists(result);
      assertEquals(typeof result, "string");
    });
  });

  describe("formatDescription", () => {
    it("should format description text", () => {
      const result = formatDescription("Test description");
      assertExists(result);
      assertEquals(typeof result, "string");
    });
  });

  describe("formatUsage", () => {
    it("should format usage string", () => {
      const result = formatUsage("veryfront dev");
      assertExists(result);
      assertEquals(result.includes("veryfront dev"), true);
    });
  });

  describe("formatOption", () => {
    it("should format option with flag and description", () => {
      const option = {
        flag: "-p, --port",
        description: "Port number",
      };
      const result = formatOption(option, 10);
      assertExists(result);
      assertEquals(typeof result, "string");
    });

    it("should include default value if provided", () => {
      const option = {
        flag: "-p, --port",
        description: "Port number",
        default: "3000",
      };
      const result = formatOption(option, 10);
      assertEquals(result.includes("3000"), true);
    });
  });

  describe("formatExample", () => {
    it("should format example command", () => {
      const result = formatExample("veryfront dev --port 8080");
      assertExists(result);
      assertEquals(typeof result, "string");
    });
  });

  describe("formatSectionHeader", () => {
    it("should format section header", () => {
      const result = formatSectionHeader("Options");
      assertExists(result);
      assertEquals(result.includes("Options"), true);
    });
  });

  describe("formatCommandHeader", () => {
    it("should format command header", () => {
      const result = formatCommandHeader("dev");
      assertExists(result);
      assertEquals(result.includes("dev"), true);
    });
  });

  describe("formatAsciiLogo", () => {
    it("should return ASCII logo string", () => {
      const result = formatAsciiLogo();
      assertExists(result);
      assertEquals(typeof result, "string");
      assertEquals(result.includes("VERYFRONT"), true);
    });
  });

  describe("calculateMaxLength", () => {
    it("should calculate maximum length from items", () => {
      const items = [
        { length: 5 },
        { length: 10 },
        { length: 7 },
      ];
      const result = calculateMaxLength(items);
      assertEquals(result, 10);
    });

    it("should handle single item", () => {
      const result = calculateMaxLength([{ length: 42 }]);
      assertEquals(result, 42);
    });
  });

  describe("formatCommandList", () => {
    it("should format list of commands", () => {
      const commands = [
        { name: "dev", description: "Start dev server", usage: "veryfront dev" },
        { name: "build", description: "Build for production", usage: "veryfront build" },
      ];
      const result = formatCommandList(commands);
      assertExists(result);
      assertEquals(Array.isArray(result), true);
      assertEquals(result.length, 2);
    });
  });
});
