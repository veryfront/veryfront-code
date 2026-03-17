import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleKnowledgeCommand } from "./handler.ts";
import { parseKnowledgeIngestArgs } from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Knowledge Handler", () => {
  describe("handleKnowledgeCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleKnowledgeCommand, "function");
      assertEquals(handleKnowledgeCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleKnowledgeCommand.length, 1);
    });
  });

  describe("parseKnowledgeIngestArgs", () => {
    it("parses a single local source path", () => {
      const result = parseKnowledgeIngestArgs({
        _: ["knowledge", "ingest", "/workspace/uploads/q1.pdf"],
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.source, "/workspace/uploads/q1.pdf");
      assertEquals(result.data.json, true);
      assertEquals(result.data.all, false);
    });

    it("parses prefix-based bulk upload ingestion flags", () => {
      const result = parseKnowledgeIngestArgs({
        _: ["knowledge", "ingest"],
        path: "uploads/",
        all: true,
        recursive: true,
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.path, "uploads/");
      assertEquals(result.data.all, true);
      assertEquals(result.data.recursive, true);
      assertEquals(result.data.json, true);
    });
  });
});
