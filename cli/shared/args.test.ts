import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve } from "veryfront/extensions/contracts";
import type { SchemaValidator } from "veryfront/extensions/schema";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { defineSchema } from "veryfront/schemas";
import {
  type ArgSpec,
  BOOLEAN_FLAGS,
  CommonArgs,
  createArgParser,
  extractArg,
  extractArgs,
  GLOBAL_BOOLEAN_FLAGS,
  parseCliArgs,
} from "./args.ts";
import { COMMANDS } from "../help/command-definitions.ts";
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

    it("should parse explicit boolean string values", () => {
      const spec: ArgSpec = { keys: ["force"], type: "boolean" };
      assertEquals(extractArg(makeParsedArgs({ force: "true" }), spec), true);
      assertEquals(extractArg(makeParsedArgs({ force: "false" }), spec), false);
      assertEquals(extractArg(makeParsedArgs({ force: "1" }), spec), true);
      assertEquals(extractArg(makeParsedArgs({ force: "0" }), spec), false);
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

    it("should not accept a numeric prefix followed by invalid characters", () => {
      const args = makeParsedArgs({ port: "3000ms" });
      const spec: ArgSpec = { keys: ["port"], type: "number" };
      assertEquals(Number.isNaN(extractArg(args, spec)), true);
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
      assertEquals(CommonArgs.projectSlug.keys.includes("project"), true);
      assertEquals(CommonArgs.projectSlug.keys.includes("p"), true);
    });
  });

  describe("parseCliArgs", () => {
    it("should keep the positional argument after --binary", () => {
      const args = parseCliArgs(["serve", "--binary", "project"]);

      assertEquals(args.binary, true);
      assertEquals(args._, ["serve", "project"]);
    });

    it("should keep positionals after undocumented command boolean flags", () => {
      const args = parseCliArgs(["serve", "--split", "project"]);

      assertEquals(args.split, true);
      assertEquals(args._, ["serve", "project"]);
    });

    it("should preserve values for documented value-taking options", () => {
      const args = parseCliArgs(["init", "--integrations", "github", "project"]);

      assertEquals(args.integrations, "github");
      assertEquals(args._, ["init", "project"]);
      assertEquals(parseCliArgs(["init", "--integrations=true"]).integrations, "true");
    });

    it("should parse positional arguments", () => {
      assertEquals(parseCliArgs(["dev"])._[0], "dev");
    });

    it("should parse long flags with values", () => {
      assertEquals(parseCliArgs(["--port", "8080"]).port, "8080");
    });

    it("should parse long flags with equals", () => {
      assertEquals(parseCliArgs(["--port=3000"]).port, "3000");
    });

    it("should parse boolean flags", () => {
      assertEquals(parseCliArgs(["--help"]).help, true);
    });

    it("should parse --no-input without consuming the command", () => {
      const args = parseCliArgs(["--no-input", "init", "my-project"]);

      assertEquals(args["no-input"], true);
      assertEquals(args._, ["init", "my-project"]);
    });

    it("should not consume commands or positionals after documented boolean flags", () => {
      const globalFlag = parseCliArgs(["--json", "config"]);
      assertEquals(globalFlag.json, true);
      assertEquals(globalFlag._, ["config"]);

      const commandFlag = parseCliArgs(["init", "--force", "my-project"]);
      assertEquals(commandFlag.force, true);
      assertEquals(commandFlag._, ["init", "my-project"]);
    });

    it("should not map -p to port (global alias removed)", () => {
      assertEquals(parseCliArgs(["-p", "9000"]).port, undefined);
      assertEquals(parseCliArgs(["-p", "9000"]).p, "9000");
    });

    it("should preserve the raw short key for command-specific parsers", () => {
      assertEquals(parseCliArgs(["pull", "-p", "my-project"]).p, "my-project");
    });

    it("should resolve -h to help", () => {
      assertEquals(parseCliArgs(["-h"]).help, true);
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

    it("should preserve numeric-looking values until typed extraction", () => {
      assertEquals(parseCliArgs(["--port", "4000"]).port, "4000");
      assertEquals(parseCliArgs(["pull", "--project", "00123"]).project, "00123");
    });

    it("should not consume a command or positional after a boolean flag", () => {
      assertEquals(parseCliArgs(["--json", "schema"])._, ["schema"]);
      assertEquals(parseCliArgs(["clean", "--force", "target"])._, ["clean", "target"]);
    });

    it("should parse explicit false values for boolean flags", () => {
      const args = parseCliArgs(["pull", "--force=false"]);
      assertEquals(args.force, false);
      assertEquals(extractArg(args, CommonArgs.force), false);
    });

    it("should stop parsing flags after the option terminator", () => {
      const args = parseCliArgs(["test", "--", "--filter", "literal"]);
      assertEquals(args._, ["test", "--filter", "literal"]);
      assertEquals(args.filter, undefined);
    });
  });

  describe("BOOLEAN_FLAGS coverage", () => {
    // A documented boolean absent from BOOLEAN_FLAGS is parsed as value-taking
    // whenever the command word cannot resolve its arity — an unknown command,
    // or a flag written before the command word. It then swallows the following
    // positional out of `args._`, silently. These two tests are the guard.
    function collectDocumentedOptionNames(): {
      booleans: Map<string, string[]>;
      valueTaking: Map<string, string[]>;
    } {
      const booleans = new Map<string, string[]>();
      const valueTaking = new Map<string, string[]>();
      for (const [command, definition] of Object.entries(COMMANDS)) {
        for (const option of definition.options ?? []) {
          const target = option.flag.includes("<") ? valueTaking : booleans;
          for (const flag of option.flag.match(/--[a-z0-9-]+/gi) ?? []) {
            const name = flag.replace(/^-+/, "");
            target.set(name, [...(target.get(name) ?? []), command]);
          }
        }
      }
      return { booleans, valueTaking };
    }

    it("should list every documented boolean option", () => {
      const { booleans } = collectDocumentedOptionNames();
      const missing = [...booleans]
        .filter(([name]) => !BOOLEAN_FLAGS.has(name) && !GLOBAL_BOOLEAN_FLAGS.has(name))
        .map(([name, commands]) => `--${name} (${commands.join(", ")})`)
        .sort();
      assertEquals(missing, []);
    });

    it("should have no option documented as both boolean and value-taking", () => {
      const { booleans, valueTaking } = collectDocumentedOptionNames();
      const ambiguous = [...booleans.keys()].filter((name) => valueTaking.has(name)).sort();
      assertEquals(ambiguous, []);
    });

    it("should not swallow a positional after a documented boolean of an unknown command", () => {
      // `positionalArgs[0]` is not a known command, so arity falls back to BOOLEAN_FLAGS.
      assertEquals(parseCliArgs(["veryfront", "pull", "--prune", "my-app"])._, [
        "veryfront",
        "pull",
        "my-app",
      ]);
      assertEquals(parseCliArgs(["veryfront", "open", "--site", "my-app"])._, [
        "veryfront",
        "open",
        "my-app",
      ]);
      assertEquals(parseCliArgs(["veryfront", "login", "--token"])._, ["veryfront", "login"]);
    });
  });
});
