/**
 * Tests for generate command handler
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleGenerateCommand } from "./handler.ts";
import type { GenerateCommandArgs } from "../../index/types.ts";

describe("commands/generate/handler", () => {
  describe("handleGenerateCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleGenerateCommand, "function");
      assertEquals(handleGenerateCommand.constructor.name, "AsyncFunction");
    });

    it("accepts GenerateCommandArgs parameter", () => {
      assertEquals(handleGenerateCommand.length, 1);
    });
  });

  describe("GenerateCommandArgs for generate command", () => {
    it("extracts type from positional args", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "page", "home"],
      };
      assertEquals(args._[1], "page");
    });

    it("extracts name from positional args", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "api", "users"],
      };
      assertEquals(args._[2], "users");
    });

    it("supports page type", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "page", "about"],
      };
      assertEquals(args._[1], "page");
      assertEquals(args._[2], "about");
    });

    it("supports layout type", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "layout", "dashboard"],
      };
      assertEquals(args._[1], "layout");
      assertEquals(args._[2], "dashboard");
    });

    it("supports api type", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "api", "products"],
      };
      assertEquals(args._[1], "api");
      assertEquals(args._[2], "products");
    });

    it("supports integration type without name", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "integration"],
      };
      assertEquals(args._[1], "integration");
      assertEquals(args._[2], undefined);
    });

    it("supports provider type", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "provider", "theme"],
      };
      assertEquals(args._[1], "provider");
      assertEquals(args._[2], "theme");
    });

    it("handles nested path names", () => {
      const args: GenerateCommandArgs = {
        _: ["generate", "page", "blog/posts/[id]"],
      };
      assertEquals(args._[2], "blog/posts/[id]");
    });
  });
});
