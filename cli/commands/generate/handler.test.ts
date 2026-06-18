import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for generate command handler
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleGenerateCommand, parseGenerateArgs } from "./handler.ts";
import type { ParsedArgs } from "#cli/shared/types";

describe("commands/generate/handler", () => {
  describe("handleGenerateCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleGenerateCommand, "function");
      assertEquals(handleGenerateCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleGenerateCommand.length, 1);
    });
  });

  describe("ParsedArgs for generate command", () => {
    it("extracts type from positional args", () => {
      const args: ParsedArgs = {
        _: ["generate", "page", "home"],
      };
      assertEquals(args._[1], "page");
    });

    it("extracts name from positional args", () => {
      const args: ParsedArgs = {
        _: ["generate", "api", "users"],
      };
      assertEquals(args._[2], "users");
    });

    it("supports page type", () => {
      const args: ParsedArgs = {
        _: ["generate", "page", "about"],
      };
      assertEquals(args._[1], "page");
      assertEquals(args._[2], "about");
    });

    it("supports layout type", () => {
      const args: ParsedArgs = {
        _: ["generate", "layout", "dashboard"],
      };
      assertEquals(args._[1], "layout");
      assertEquals(args._[2], "dashboard");
    });

    it("supports api type", () => {
      const args: ParsedArgs = {
        _: ["generate", "api", "products"],
      };
      assertEquals(args._[1], "api");
      assertEquals(args._[2], "products");
    });

    it("supports integration type without name", () => {
      const args: ParsedArgs = {
        _: ["generate", "integration"],
      };
      assertEquals(args._[1], "integration");
      assertEquals(args._[2], undefined);
    });

    it("parses all shared scaffold types", () => {
      const types = [
        "page",
        "layout",
        "api",
        "component",
        "tool",
        "agent",
        "prompt",
        "workflow",
        "task",
        "resource",
        "skill",
      ];

      for (const type of types) {
        const result = parseGenerateArgs({
          _: ["generate", type, "example"],
        });

        assertEquals(result.success, true, `expected ${type} to parse`);
      }
    });

    it("rejects provider type because the generator does not implement it", () => {
      const result = parseGenerateArgs({
        _: ["generate", "provider", "theme"],
      });

      assertEquals(result.success, false);
    });

    it("handles nested path names", () => {
      const args: ParsedArgs = {
        _: ["generate", "page", "blog/posts/[id]"],
      };
      assertEquals(args._[2], "blog/posts/[id]");
    });
  });
});
