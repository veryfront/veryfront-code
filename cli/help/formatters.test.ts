import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  calculateMaxLength,
  formatCommandHeader,
  formatCommandList,
  formatExample,
  formatHeader,
  formatOption,
  formatOptionFlag,
  formatSectionHeader,
  formatUsage,
} from "./formatters.ts";
import type { CommandHelp, CommandOption } from "./types.ts";
import { VERSION } from "#cli/utils";
import { setTestColorLevel } from "../ui/colors.ts";

describe("cli/help/formatters", () => {
  describe("formatUsage", () => {
    it("should format usage with bold prefix", () => {
      const result = formatUsage("veryfront dev [options]");
      assertEquals(result.includes("Usage:"), true);
      assertEquals(result.includes("veryfront dev [options]"), true);
    });
  });

  describe("formatOptionFlag", () => {
    it("should pad flag to specified length", () => {
      const result = formatOptionFlag("-p", 10);
      assertEquals(result.length, 12);
    });

    it("should not truncate long flags", () => {
      const result = formatOptionFlag("--very-long-flag", 5);
      assertEquals(result.includes("--very-long-flag"), true);
    });
  });

  describe("formatOption", () => {
    it("should format option with flag and description", () => {
      const opt: CommandOption = { flag: "--port", description: "Port number" };
      const result = formatOption(opt, 10);
      assertEquals(result.includes("--port"), true);
      assertEquals(result.includes("Port number"), true);
    });

    it("should include default value when present", () => {
      const opt: CommandOption = {
        flag: "--port",
        description: "Port number",
        default: "3000",
      };
      const result = formatOption(opt, 10);
      assertEquals(result.includes("3000"), true);
    });

    it("should not include default when absent", () => {
      const opt: CommandOption = { flag: "--port", description: "Port number" };
      const result = formatOption(opt, 10);
      assertEquals(result.includes("default"), false);
    });
  });

  describe("formatExample", () => {
    it("should format example with dollar sign prefix", () => {
      const result = formatExample("veryfront dev --port 8080");
      assertEquals(result.includes("$"), true);
      assertEquals(result.includes("veryfront dev --port 8080"), true);
    });
  });

  describe("formatSectionHeader", () => {
    it("should format section header with colon", () => {
      const result = formatSectionHeader("Options");
      assertEquals(result.includes("Options:"), true);
    });
  });

  describe("formatCommandHeader", () => {
    it("should format command header with veryfront prefix", () => {
      const result = formatCommandHeader("dev");
      assertEquals(result.includes("veryfront dev"), true);
    });
  });

  describe("calculateMaxLength", () => {
    it("should return the maximum length", () => {
      assertEquals(calculateMaxLength([{ length: 3 }, { length: 7 }, { length: 5 }]), 7);
    });

    it("should handle single item", () => {
      assertEquals(calculateMaxLength([{ length: 42 }]), 42);
    });

    it("should handle items with zero length", () => {
      assertEquals(calculateMaxLength([{ length: 0 }, { length: 3 }]), 3);
    });
  });

  describe("formatHeader", () => {
    it("uses a compact product and version line without decorative art", () => {
      setTestColorLevel("none");

      assertEquals(formatHeader(), `Veryfront ${VERSION}`);

      setTestColorLevel(null);
    });
  });

  describe("formatCommandList", () => {
    it("should format a list of commands", () => {
      const commands: CommandHelp[] = [
        { name: "dev", category: "development", description: "Start dev server", usage: "" },
        { name: "build", category: "development", description: "Build for production", usage: "" },
      ];
      const result = formatCommandList(commands);
      assertEquals(result.length, 2);
      assertEquals(result[0]?.includes("dev"), true);
      assertEquals(result[1]?.includes("build"), true);
    });

    it("should align command names", () => {
      const commands: CommandHelp[] = [
        { name: "a", category: "development", description: "Short name", usage: "" },
        { name: "longname", category: "development", description: "Long name", usage: "" },
      ];
      const result = formatCommandList(commands);
      assertEquals(result.length, 2);
      assertEquals(result[0]?.includes("Short name"), true);
      assertEquals(result[1]?.includes("Long name"), true);
    });
  });
});
