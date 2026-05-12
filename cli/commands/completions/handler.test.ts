import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractFishFlags,
  extractLongFlags,
  generateBashCompletions,
  generateFishCompletions,
  generateZshCompletions,
  shellEscape,
} from "./command.ts";

describe("Completions Command", () => {
  describe("shellEscape", () => {
    it("escapes backslashes", () => {
      assertEquals(shellEscape("a\\b"), "a\\\\b");
    });

    it("escapes single quotes", () => {
      assertEquals(shellEscape("it's"), "it\\'s");
    });

    it("escapes both backslashes and quotes", () => {
      assertEquals(shellEscape("a\\'b"), "a\\\\\\'b");
    });

    it("returns empty string unchanged", () => {
      assertEquals(shellEscape(""), "");
    });

    it("leaves normal text unchanged", () => {
      assertEquals(shellEscape("hello world"), "hello world");
    });
  });

  describe("extractLongFlags", () => {
    it("extracts --flag from simple flag", () => {
      const flags = extractLongFlags([
        { flag: "--port", description: "Port" },
      ]);
      assertEquals(flags, ["--port"]);
    });

    it("extracts --flag from short,long combo", () => {
      const flags = extractLongFlags([
        { flag: "-p, --port <number>", description: "Port" },
      ]);
      assertEquals(flags, ["--port"]);
    });

    it("handles multiple options", () => {
      const flags = extractLongFlags([
        { flag: "-p, --port <number>", description: "Port" },
        { flag: "--env <name>", description: "Environment" },
        { flag: "-f, --force", description: "Force" },
      ]);
      assertEquals(flags.includes("--port"), true);
      assertEquals(flags.includes("--env"), true);
      assertEquals(flags.includes("--force"), true);
      assertEquals(flags.length, 3);
    });

    it("excludes short-only flags", () => {
      const flags = extractLongFlags([
        { flag: "-v", description: "Verbose" },
      ]);
      assertEquals(flags.length, 0);
    });

    it("handles empty options", () => {
      assertEquals(extractLongFlags([]).length, 0);
    });
  });

  describe("extractFishFlags", () => {
    it("extracts short and long from combo", () => {
      const flags = extractFishFlags([
        { flag: "-p, --port <number>", description: "Port" },
      ]);
      assertEquals(flags[0]?.short, "p");
      assertEquals(flags[0]?.long, "port");
      assertEquals(flags[0]?.description, "Port");
    });

    it("extracts long-only flag", () => {
      const flags = extractFishFlags([
        { flag: "--env <name>", description: "Environment" },
      ]);
      assertEquals(flags[0]?.short, undefined);
      assertEquals(flags[0]?.long, "env");
    });

    it("extracts short-only flag", () => {
      const flags = extractFishFlags([
        { flag: "-v", description: "Verbose" },
      ]);
      assertEquals(flags[0]?.short, "v");
      assertEquals(flags[0]?.long, undefined);
    });
  });

  describe("generateBashCompletions", () => {
    it("includes command names", () => {
      const script = generateBashCompletions();
      assertEquals(script.includes("deploy"), true);
      assertEquals(script.includes("build"), true);
      assertEquals(script.includes("dev"), true);
    });

    it("includes complete function", () => {
      const script = generateBashCompletions();
      assertEquals(script.includes("complete -F"), true);
      assertEquals(script.includes("_veryfront_completions"), true);
    });

    it("includes global flags", () => {
      const script = generateBashCompletions();
      assertEquals(script.includes("--json"), true);
      assertEquals(script.includes("--yes"), true);
      assertEquals(script.includes("--quiet"), true);
      assertEquals(script.includes("--verbose"), true);
      assertEquals(script.includes("--help"), true);
      assertEquals(script.includes("--version"), true);
    });

    it("includes per-command long flags", () => {
      const script = generateBashCompletions();
      assertEquals(script.includes("--branch"), true);
      assertEquals(script.includes("--force"), true);
    });

    it("includes case statement for commands", () => {
      const script = generateBashCompletions();
      assertEquals(script.includes("case"), true);
      assertEquals(script.includes("deploy)"), true);
      assertEquals(script.includes("build)"), true);
    });
  });

  describe("generateZshCompletions", () => {
    it("includes compdef", () => {
      const script = generateZshCompletions();
      assertEquals(script.includes("#compdef veryfront"), true);
    });

    it("includes command descriptions", () => {
      const script = generateZshCompletions();
      assertEquals(script.includes("deploy:"), true);
      assertEquals(script.includes("build:"), true);
    });

    it("includes _describe for command completion", () => {
      const script = generateZshCompletions();
      assertEquals(script.includes("_describe"), true);
    });

    it("includes args state for per-command flags", () => {
      const script = generateZshCompletions();
      assertEquals(script.includes("args)"), true);
      assertEquals(script.includes("_arguments"), true);
    });

    it("includes _veryfront function", () => {
      const script = generateZshCompletions();
      assertEquals(script.includes("_veryfront()"), true);
    });
  });

  describe("generateFishCompletions", () => {
    it("includes complete commands", () => {
      const script = generateFishCompletions();
      assertEquals(script.includes("complete -c veryfront"), true);
    });

    it("includes subcommand condition", () => {
      const script = generateFishCompletions();
      assertEquals(script.includes("__fish_use_subcommand"), true);
      assertEquals(script.includes("__fish_seen_subcommand_from"), true);
    });

    it("uses -l for long flags (not raw --flag)", () => {
      const script = generateFishCompletions();
      assertEquals(script.includes("-l 'branch'"), true);
      assertEquals(script.includes("-l '--branch'"), false);
    });

    it("includes -s for short flags", () => {
      const script = generateFishCompletions();
      assertEquals(script.includes("-s 'b'"), true);
    });

    it("includes command descriptions with -d", () => {
      const script = generateFishCompletions();
      assertEquals(script.includes("-d '"), true);
    });
  });
});
