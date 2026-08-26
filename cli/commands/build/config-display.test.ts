import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for build config display
 */

import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { setLoggerPreset } from "#cli/logger-config";
import { setVerboseMode } from "#cli/utils";
import { displayBuildConfig, displayBuildStart } from "./config-display.ts";
import type { BuildOptions } from "./types.ts";

/** Strips SGR colour codes so assertions can look at the raw layout. */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Matches the CLI logger's `  <glyph> ` prefix. */
const GLYPH_LINE = /^ {2}\S /;

/** Renders through the real CLI logger preset and returns each printed line. */
function captureCliPresetLines(run: () => void): string[] {
  const output: string[] = [];
  const origLog = console.log;

  setLoggerPreset("cli");
  try {
    console.log = (msg?: unknown, ...rest: unknown[]) => {
      output.push(String(msg ?? ""), ...rest.map(String));
    };
    run();
  } finally {
    console.log = origLog;
    setLoggerPreset("server");
  }

  return output.join("\n").replace(ANSI_SGR, "").split("\n");
}

function assertNoGlyphOnlyLine(lines: string[]): void {
  for (const line of lines) {
    if (line.trim() === "") continue;
    assert(
      !(GLYPH_LINE.test(line) && line.replace(GLYPH_LINE, "").trim() === ""),
      `emitted a glyph-only line with no content: ${JSON.stringify(line)}`,
    );
  }
}

describe("build/config-display", () => {
  describe("displayBuildConfig", () => {
    it("handles minimal options (only projectDir)", () => {
      const options: BuildOptions = {
        projectDir: "/path/to/project",
      };

      displayBuildConfig(options);
    });

    it("handles all features enabled", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        outputDir: "build",
        splitting: true,
        compress: true,
        prefetch: true,
        ssg: true,
        dryRun: false,
      };

      displayBuildConfig(options);
    });

    it("handles all features disabled", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        outputDir: "dist",
        splitting: false,
        compress: false,
        prefetch: false,
        ssg: false,
        dryRun: false,
      };

      displayBuildConfig(options);
    });

    it("handles dry run mode", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        dryRun: true,
      };

      displayBuildConfig(options);
    });

    it("handles include patterns", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        include: ["pages/**", "app/**"],
      };

      displayBuildConfig(options);
    });

    it("handles exclude patterns", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        exclude: ["**/*.test.ts", "**/__tests__/**"],
      };

      displayBuildConfig(options);
    });

    it("handles both include and exclude patterns", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        include: ["src/**"],
        exclude: ["src/tests/**"],
      };

      displayBuildConfig(options);
    });

    it("handles empty include/exclude arrays", () => {
      const options: BuildOptions = {
        projectDir: "/project",
        include: [],
        exclude: [],
      };

      displayBuildConfig(options);
    });
  });

  // Regression: the section break after the dry-run notice was emitted as
  // `cliLogger.info("")`. The CLI logger preset renders every message as
  // `  <glyph> <message>`, so an empty message printed a bare "  ● " line
  // between the notice and "Building...". Same defect the routes command had.
  describe("section separators under the CLI logger preset", () => {
    it("separates the dry-run notice without a bare glyph line", () => {
      const lines = captureCliPresetLines(() => {
        displayBuildConfig({ projectDir: "/project", dryRun: true });
        displayBuildStart();
      });

      assertNoGlyphOnlyLine(lines);

      const buildingIndex = lines.findIndex((line) => line.includes("Building..."));
      assert(buildingIndex > 0, "expected a Building... line after the dry-run notice");
      assert(
        lines[buildingIndex - 1] === "",
        `expected a blank line before Building..., got ${JSON.stringify(lines[buildingIndex - 1])}`,
      );
    });

    it("separates the verbose config block without a bare glyph line", () => {
      setVerboseMode(true);
      let lines: string[];
      try {
        lines = captureCliPresetLines(() => {
          displayBuildConfig({ projectDir: "/project", outputDir: "dist" });
          displayBuildStart();
        });
      } finally {
        setVerboseMode(false);
      }

      assertNoGlyphOnlyLine(lines);

      const buildingIndex = lines.findIndex((line) => line.includes("Building..."));
      assert(buildingIndex > 0, "expected a Building... line after the verbose config block");
      assert(
        lines[buildingIndex - 1] === "",
        `expected a blank line before Building..., got ${JSON.stringify(lines[buildingIndex - 1])}`,
      );
    });
  });

  describe("displayBuildStart", () => {
    it("executes without error", () => {
      displayBuildStart();
    });
  });
});
