import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleUploadsCommand } from "./handler.ts";
import {
  parseUploadsDeleteArgs,
  parseUploadsListArgs,
  parseUploadsPullArgs,
  parseUploadsPutArgs,
} from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Uploads Handler", () => {
  describe("handleUploadsCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleUploadsCommand, "function");
      assertEquals(handleUploadsCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleUploadsCommand.length, 1);
    });
  });

  describe("parseUploadsListArgs", () => {
    it("parses list flags", () => {
      const result = parseUploadsListArgs({
        _: ["uploads", "list"],
        path: "uploads/",
        limit: 50,
        recursive: false,
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.path, "uploads/");
      assertEquals(result.data.limit, 50);
      assertEquals(result.data.recursive, false);
      assertEquals(result.data.json, true);
    });
  });

  describe("parseUploadsPullArgs", () => {
    it("parses explicit upload paths", () => {
      const result = parseUploadsPullArgs({
        _: ["uploads", "pull", "contracts/q1.pdf", "contracts/q2.pdf"],
        "output-dir": "/workspace/uploads",
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.uploads, ["contracts/q1.pdf", "contracts/q2.pdf"]);
      assertEquals(result.data.outputDir, "/workspace/uploads");
      assertEquals(result.data.all, false);
    });

    it("parses bulk pull flags", () => {
      const result = parseUploadsPullArgs({
        _: ["uploads", "pull"],
        path: "uploads/",
        all: true,
        "output-dir": "/workspace/uploads",
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.path, "uploads/");
      assertEquals(result.data.all, true);
      assertEquals(result.data.outputDir, "/workspace/uploads");
      assertEquals(result.data.json, true);
    });
  });

  describe("parseUploadsPutArgs", () => {
    it("parses a remote upload path and local source file", () => {
      const result = parseUploadsPutArgs({
        _: ["uploads", "put", "contracts/q1.pdf"],
        from: "/workspace/uploads/q1.pdf",
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.uploadPath, "contracts/q1.pdf");
      assertEquals(result.data.from, "/workspace/uploads/q1.pdf");
      assertEquals(result.data.json, true);
    });
  });

  describe("parseUploadsDeleteArgs", () => {
    it("parses an upload delete target", () => {
      const result = parseUploadsDeleteArgs({
        _: ["uploads", "delete", "contracts/q1.pdf"],
        json: true,
      } as ParsedArgs);

      assertSuccess(result);
      assertEquals(result.data.uploadPath, "contracts/q1.pdf");
      assertEquals(result.data.json, true);
    });
  });
});
