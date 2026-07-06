import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve } from "veryfront/extensions/contracts";
import type { SchemaValidator } from "veryfront/extensions/schema";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { defineSchema } from "veryfront/schemas";
import {
  type ArgSpec,
  CommonArgs,
  createArgParser,
  extractArg,
  extractArgs,
  parseCliArgs,
} from "./args.ts";
import type { ParsedArgs } from "./types.ts";

if (!tryResolve<SchemaValidator>("SchemaValidator")) {
  register<SchemaValidator>("SchemaValidator", createZodAdapter());
}

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
      const schema = defineSchema((v) =>
        v.object({
          force: v.boolean().default(false),
          branch: v.string().optional(),
        })
      )();
      const argMap = {
        force: { keys: ["force", "f"], type: "boolean" as const },
        branch: { keys: ["branch", "b"], type: "string" as const },
      };

      const parse = createArgParser(schema, argMap);
      const args = makeParsedArgs({ force: true, branch: "main" });
      const result = parse(args);

      assertEquals(result.success, true);
      if (!result.success) return;

      assertEquals(result.data.force, true);
      assertEquals(result.data.branch, "main");
    });

    it("should apply default values from schema", () => {
      const schema = defineSchema((v) =>
        v.object({
          force: v.boolean().default(false),
        })
      )();
      const argMap = {
        force: { keys: ["force"], type: "boolean" as const },
      };

      const parse = createArgParser(schema, argMap);
      const args = makeParsedArgs({});
      const result = parse(args);

      assertEquals(result.success, true);
      if (!result.success) return;

      assertEquals(result.data.force, false);
    });

    it("should return error for invalid data", () => {
      const schema = defineSchema((v) =>
        v.object({
          name: v.string().min(1),
        })
      )();
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

  describe("parseCliArgs", () => {
    it("should parse positional arguments", () => {
      assertEquals(parseCliArgs(["dev"])._[0], "dev");
    });

    it("should parse long flags with values", () => {
      assertEquals(parseCliArgs(["--port", "8080"]).port, 8080);
    });

    it("should parse long flags with equals", () => {
      assertEquals(parseCliArgs(["--port=3000"]).port, 3000);
    });

    it("should parse boolean flags", () => {
      assertEquals(parseCliArgs(["--help"]).help, true);
    });

    it("should resolve short aliases", () => {
      assertEquals(parseCliArgs(["-p", "9000"]).port, 9000);
    });

    it("should preserve the raw short key for command-specific parsers", () => {
      assertEquals(parseCliArgs(["pull", "-p", "my-project"]).p, "my-project");
    });

    it("should resolve -h to help", () => {
      assertEquals(parseCliArgs(["-h"]).help, true);
    });

    it("should handle --with as array flag", () => {
      assertEquals(parseCliArgs(["--with", "react", "--with", "tailwind"]).with, [
        "react",
        "tailwind",
      ]);
    });

    it("should handle repeated --candidate-model values as an array flag", () => {
      assertEquals(
        parseCliArgs([
          "--candidate-model",
          "moonshotai/kimi-k2.6",
          "--candidate-model",
          "openai/gpt-5.5",
        ])["candidate-model"],
        ["moonshotai/kimi-k2.6", "openai/gpt-5.5"],
      );
    });

    it("should not set default port", () => {
      assertEquals(parseCliArgs([]).port, undefined);
    });

    it("should convert numeric string values", () => {
      assertEquals(parseCliArgs(["--port", "4000"]).port, 4000);
    });
  });
});
