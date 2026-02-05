import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleRoutesCommand, parseRoutesArgs } from "./handler.ts";

describe("commands/routes/handler", () => {
  describe("handleRoutesCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleRoutesCommand, "function");
      assertEquals(handleRoutesCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleRoutesCommand.length, 1);
    });
  });

  describe("parseRoutesArgs", () => {
    it("defaults projectDir to empty string when not provided", () => {
      const result = parseRoutesArgs({ _: ["routes"] });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.projectDir, "");
    });

    it("uses --project-dir string value when provided", () => {
      const result = parseRoutesArgs({ _: ["routes"], "project-dir": "/custom/path" });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.projectDir, "/custom/path");
    });

    it("uses --dir alias", () => {
      const result = parseRoutesArgs({ _: ["routes"], dir: "/custom/path" });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.projectDir, "/custom/path");
    });

    it("uses -d alias", () => {
      const result = parseRoutesArgs({ _: ["routes"], d: "/custom/path" });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.projectDir, "/custom/path");
    });

    it("parses --json flag as true", () => {
      const result = parseRoutesArgs({ _: ["routes"], json: true });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.json, true);
    });

    it("defaults --json to false", () => {
      const result = parseRoutesArgs({ _: ["routes"] });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.json, false);
    });

    it("parses --json flag as false", () => {
      const result = parseRoutesArgs({ _: ["routes"], json: false });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.json, false);
    });
  });
});
