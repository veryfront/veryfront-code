import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { z } from "zod";
import { type ArgSpec, CommonArgs, createArgParser, extractArg, extractArgs } from "./args.ts";
import type { ParsedArgs } from "../index/types.ts";

function makeParsedArgs(overrides: Record<string, unknown> = {}): ParsedArgs {
  return { _: [], ...overrides } as ParsedArgs;
}

describe("cli/shared/args", () => {
  describe("extractArg", () => {
    it("should extract a string arg by key", () => {
      const args = makeParsedArgs({ "project-slug": "my-app" });
      const spec: ArgSpec = { keys: ["project-slug", "p"], type: "string" };
      assertEquals(extractArg(args, spec), "my-app");
    });

    it("should try multiple keys and return the first match", () => {
      const args = makeParsedArgs({ p: "short-val" });
      const spec: ArgSpec = { keys: ["project-slug", "p"], type: "string" };
      assertEquals(extractArg(args, spec), "short-val");
    });

    it("should return undefined when no key matches and no positional", () => {
      const args = makeParsedArgs({});
      const spec: ArgSpec = { keys: ["missing"], type: "string" };
      assertEquals(extractArg(args, spec), undefined);
    });

    it("should extract positional argument", () => {
      const args = makeParsedArgs({ _: ["pull", "my-project"] });
      const spec: ArgSpec = { keys: ["project-slug"], type: "string", positional: 0 };
      assertEquals(extractArg(args, spec), "my-project");
    });

    it("should prefer named arg over positional", () => {
      const args = makeParsedArgs({ _: ["pull", "positional-val"], "project-slug": "named-val" });
      const spec: ArgSpec = { keys: ["project-slug"], type: "string", positional: 0 };
      assertEquals(extractArg(args, spec), "named-val");
    });

    it("should coerce boolean arg", () => {
      const args = makeParsedArgs({ force: true });
      const spec: ArgSpec = { keys: ["force"], type: "boolean" };
      assertEquals(extractArg(args, spec), true);
    });

    it("should coerce falsy value to boolean false", () => {
      const args = makeParsedArgs({ force: "" });
      const spec: ArgSpec = { keys: ["force"], type: "boolean" };
      assertEquals(extractArg(args, spec), false);
    });

    it("should coerce number arg from numeric value", () => {
      const args = makeParsedArgs({ port: 8080 });
      const spec: ArgSpec = { keys: ["port"], type: "number" };
      assertEquals(extractArg(args, spec), 8080);
    });

    it("should coerce number arg from string value", () => {
      const args = makeParsedArgs({ port: "3000" });
      const spec: ArgSpec = { keys: ["port"], type: "number" };
      assertEquals(extractArg(args, spec), 3000);
    });

    it("should return undefined for positional out of range", () => {
      const args = makeParsedArgs({ _: ["pull"] });
      const spec: ArgSpec = { keys: ["slug"], type: "string", positional: 0 };
      assertEquals(extractArg(args, spec), undefined);
    });
  });

  describe("extractArgs", () => {
    it("should extract multiple args at once", () => {
      const args = makeParsedArgs({ force: true, branch: "main" });
      const argMap = {
        force: { keys: ["force", "f"], type: "boolean" as const },
        branch: { keys: ["branch", "b"], type: "string" as const },
      };
      const result = extractArgs(args, argMap);
      assertEquals(result.force, true);
      assertEquals(result.branch, "main");
    });

    it("should skip undefined fields", () => {
      const args = makeParsedArgs({});
      const argMap = {
        force: { keys: ["force"], type: "boolean" as const },
      };
      const result = extractArgs(args, argMap);
      assertEquals(Object.keys(result).length, 0);
    });
  });

  describe("createArgParser", () => {
    it("should create a parser that validates with schema", () => {
      const schema = z.object({
        force: z.boolean().default(false),
        branch: z.string().optional(),
      });
      const argMap = {
        force: { keys: ["force", "f"], type: "boolean" as const },
        branch: { keys: ["branch", "b"], type: "string" as const },
      };

      const parse = createArgParser(schema, argMap);
      const args = makeParsedArgs({ force: true, branch: "main" });
      const result = parse(args);

      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.force, true);
        assertEquals(result.data.branch, "main");
      }
    });

    it("should apply default values from schema", () => {
      const schema = z.object({
        force: z.boolean().default(false),
      });
      const argMap = {
        force: { keys: ["force"], type: "boolean" as const },
      };

      const parse = createArgParser(schema, argMap);
      const args = makeParsedArgs({});
      const result = parse(args);

      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.force, false);
      }
    });

    it("should return error for invalid data", () => {
      const schema = z.object({
        name: z.string().min(1),
      });
      const argMap = {
        name: { keys: ["name"], type: "string" as const },
      };

      const parse = createArgParser(schema, argMap);
      const args = makeParsedArgs({});
      const result = parse(args);

      assertEquals(result.success, false);
    });
  });

  describe("CommonArgs", () => {
    it("should have force spec with correct keys", () => {
      assertEquals(CommonArgs.force.keys, ["force", "f"]);
      assertEquals(CommonArgs.force.type, "boolean");
    });

    it("should have dryRun spec", () => {
      assertEquals(CommonArgs.dryRun.keys, ["dry-run"]);
      assertEquals(CommonArgs.dryRun.type, "boolean");
    });

    it("should have projectSlug spec with multiple keys", () => {
      assertEquals(CommonArgs.projectSlug.keys.includes("project-slug"), true);
      assertEquals(CommonArgs.projectSlug.keys.includes("project"), true);
      assertEquals(CommonArgs.projectSlug.keys.includes("p"), true);
    });
  });
});
