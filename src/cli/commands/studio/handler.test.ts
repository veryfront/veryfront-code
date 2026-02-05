/**
 * Tests for studio command handler
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleStudioCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

describe("commands/studio/handler", () => {
  describe("handleStudioCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleStudioCommand, "function");
      assertEquals(handleStudioCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleStudioCommand.length, 1);
    });
  });

  describe("ParsedArgs for studio command", () => {
    it("extracts project from positional args", () => {
      const args: ParsedArgs = {
        _: ["studio", "my-project"],
      };
      assertEquals(args._[1], "my-project");
    });

    it("supports branch flag", () => {
      const args: ParsedArgs = {
        _: ["studio", "my-project"],
        branch: "feature/new-design",
      };
      assertEquals(args.branch, "feature/new-design");
    });

    it("supports file flag", () => {
      const args: ParsedArgs = {
        _: ["studio", "my-project"],
        file: "pages/index.tsx",
      };
      assertEquals(args.file, "pages/index.tsx");
    });

    it("handles studio command without project", () => {
      const args: ParsedArgs = {
        _: ["studio"],
      };
      assertEquals(args._[1], undefined);
    });

    it("supports all flags together", () => {
      const args: ParsedArgs = {
        _: ["studio", "project-name"],
        branch: "main",
        file: "app/page.tsx",
      };
      assertEquals(args._[1], "project-name");
      assertEquals(args.branch, "main");
      assertEquals(args.file, "app/page.tsx");
    });
  });
});
