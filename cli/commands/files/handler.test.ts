import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleFilesCommand } from "./handler.ts";
import {
  parseFilesDeleteArgs,
  parseFilesGetArgs,
  parseFilesListArgs,
  parseFilesPutArgs,
} from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Files Handler", () => {
  describe("handleFilesCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleFilesCommand, "function");
      assertEquals(handleFilesCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleFilesCommand.length, 1);
    });
  });

  describe("parseFilesListArgs", () => {
    it("parses list flags", () => {
      const result = parseFilesListArgs({
        _: ["files", "list"],
        path: "knowledge/",
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.path, "knowledge/");
      assertEquals(result.data.json, true);
    });
  });

  describe("parseFilesGetArgs", () => {
    it("parses a remote file target", () => {
      const result = parseFilesGetArgs({
        _: ["files", "get", "knowledge/q1-report.md"],
        output: "/workspace/q1-report.md",
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.remotePath, "knowledge/q1-report.md");
      assertEquals(result.data.output, "/workspace/q1-report.md");
      assertEquals(result.data.json, true);
    });
  });

  describe("parseFilesPutArgs", () => {
    it("parses a remote path and local source file", () => {
      const result = parseFilesPutArgs({
        _: ["files", "put", "knowledge/q1-report.md"],
        from: "/workspace/knowledge/q1-report.md",
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.remotePath, "knowledge/q1-report.md");
      assertEquals(result.data.from, "/workspace/knowledge/q1-report.md");
      assertEquals(result.data.json, true);
    });
  });

  describe("parseFilesDeleteArgs", () => {
    it("parses a remote file delete target", () => {
      const result = parseFilesDeleteArgs({
        _: ["files", "delete", "knowledge/q1-report.md"],
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.remotePath, "knowledge/q1-report.md");
      assertEquals(result.data.json, true);
    });
  });
});
