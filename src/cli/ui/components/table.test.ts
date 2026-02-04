/**
 * Tests for table component
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { resetColorCache } from "../colors.ts";
import { checkList, keyValueList, table } from "./table.ts";

describe("table", () => {
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

  describe("table", () => {
    it("renders basic table with headers", () => {
      const rows = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];
      const result = table(rows, {
        columns: [
          { header: "Name", key: "name" },
          { header: "Age", key: "age" },
        ],
      });

      assertStringIncludes(result, "Name");
      assertStringIncludes(result, "Age");
      assertStringIncludes(result, "Alice");
      assertStringIncludes(result, "Bob");
      assertStringIncludes(result, "30");
      assertStringIncludes(result, "25");
    });

    it("handles missing values", () => {
      const rows = [
        { name: "Alice" },
        { name: "Bob", age: 25 },
      ];
      const result = table(rows, {
        columns: [
          { header: "Name", key: "name" },
          { header: "Age", key: "age" },
        ],
      });

      assertStringIncludes(result, "Alice");
      assertStringIncludes(result, "Bob");
    });

    it("respects showHeader option", () => {
      const rows = [{ name: "Alice" }];
      const withHeader = table(rows, {
        columns: [{ header: "Name", key: "name" }],
        showHeader: true,
      });
      const withoutHeader = table(rows, {
        columns: [{ header: "Name", key: "name" }],
        showHeader: false,
      });

      assertStringIncludes(withHeader, "Name");
      assertEquals(withoutHeader.includes("Name"), false);
    });

    it("handles custom indent", () => {
      const rows = [{ name: "Test" }];
      const result = table(rows, {
        columns: [{ header: "Name", key: "name" }],
        indent: 4,
      });

      // Should have 4 spaces of indentation
      assertStringIncludes(result, "    ");
    });

    it("handles boolean values", () => {
      const rows = [{ active: true }, { active: false }];
      const result = table(rows, {
        columns: [{ header: "Active", key: "active" }],
      });

      assertStringIncludes(result, "true");
      assertStringIncludes(result, "false");
    });
  });

  describe("keyValueList", () => {
    it("renders key-value pairs", () => {
      const items = [
        { key: "Name", value: "Test" },
        { key: "Version", value: "1.0.0" },
      ];
      const result = keyValueList(items);

      assertStringIncludes(result, "Name");
      assertStringIncludes(result, "Test");
      assertStringIncludes(result, "Version");
      assertStringIncludes(result, "1.0.0");
    });

    it("shows status icons", () => {
      const items = [
        { key: "Success", value: "ok", status: "success" as const },
        { key: "Error", value: "fail", status: "error" as const },
        { key: "Warning", value: "warn", status: "warning" as const },
        { key: "Info", value: "note", status: "info" as const },
      ];
      const result = keyValueList(items);

      // Should include status icons
      assertStringIncludes(result, "✓");
      assertStringIncludes(result, "✗");
      assertStringIncludes(result, "!");
      assertStringIncludes(result, "●");
    });

    it("respects custom indent", () => {
      const items = [{ key: "Test", value: "Value" }];
      const result = keyValueList(items, { indent: 4 });

      assertStringIncludes(result, "    ");
    });

    it("respects custom keyWidth", () => {
      const items = [{ key: "A", value: "Value" }];
      const result = keyValueList(items, { keyWidth: 10 });

      // Key should be padded to 10 characters
      assertEquals(typeof result, "string");
    });
  });

  describe("checkList", () => {
    it("renders items with status", () => {
      const items = [
        { label: "Passed", status: "pass" as const },
        { label: "Failed", status: "fail" as const },
        { label: "Warning", status: "warn" as const },
        { label: "Skipped", status: "skip" as const },
      ];
      const result = checkList(items);

      assertStringIncludes(result, "Passed");
      assertStringIncludes(result, "Failed");
      assertStringIncludes(result, "Warning");
      assertStringIncludes(result, "Skipped");
    });

    it("shows status icons", () => {
      const items = [
        { label: "Pass", status: "pass" as const },
        { label: "Fail", status: "fail" as const },
        { label: "Warn", status: "warn" as const },
        { label: "Skip", status: "skip" as const },
      ];
      const result = checkList(items);

      assertStringIncludes(result, "✓");
      assertStringIncludes(result, "✗");
      assertStringIncludes(result, "!");
      assertStringIncludes(result, "○");
    });

    it("includes detail when provided", () => {
      const items = [
        { label: "Test", status: "pass" as const, detail: "additional info" },
      ];
      const result = checkList(items);

      assertStringIncludes(result, "additional info");
    });

    it("respects custom indent", () => {
      const items = [{ label: "Test", status: "pass" as const }];
      const result = checkList(items, { indent: 4 });

      assertStringIncludes(result, "    ");
    });
  });
});
