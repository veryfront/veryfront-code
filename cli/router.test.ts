import "#veryfront/schemas/_test-setup.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { COMMANDS } from "./help/command-definitions.ts";
import { parseLoginMethod } from "./auth/utils.ts";
import { classifyCliError, routeCommand, safeJsonErrorContext } from "./router.ts";
import { INVALID_ARGUMENT, UNKNOWN_ERROR } from "veryfront/errors";
import { cliLogger, VERSION } from "./utils/index.ts";
import { setJsonMode } from "./shared/json-output.ts";
import { isInteractive, resetInteractiveMode } from "./shared/interactive.ts";
import type { ParsedArgs } from "./shared/types.ts";

/**
 * Test-only helpers for patterns that don't have importable counterparts.
 * resolveProjectDir in shared/args.ts calls cwd() internally, so we use a
 * pure version here to test the resolution logic in isolation.
 */
function resolveProjectDir(
  args: Record<string, unknown>,
  keys: string[],
  cwdVal: string,
): string {
  const raw = keys.map((k) => args[k]).find((v) => v != null);
  if (!raw) return cwdVal;

  const dir = String(raw);
  if (dir.startsWith("/")) return dir;

  return `${cwdVal}/${dir}`;
}

function parseCsvArg(value: unknown): string[] | undefined {
  if (!value) return undefined;

  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatIssues(issues: Array<{ path: string[]; message: string }>): string {
  return issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

/**
 * Builds args carrying a raw, unvalidated `mode` so the router's own validation
 * is what rejects it. The widening is scoped to `mode`, every other field keeps
 * its `ParsedArgs` type, and `args` is copied rather than mutated.
 */
function parsedArgsWithRawMode(args: ParsedArgs, mode: unknown): ParsedArgs {
  return { ...args, mode: mode as ParsedArgs["mode"] };
}

describe("cli/command-definitions integrity", () => {
  it("should have all expected commands", () => {
    const expectedCommands = [
      "init",
      "dev",
      "build",
      "serve",
      "doctor",
      "clean",
      "routes",
      "studio",
      "styles",
      "lock",
      "generate",
      "pull",
      "push",
      "merge",
      "deploy",
      "up",
      "login",
      "logout",
      "whoami",
      "install",
      "uninstall",
      "demo",
      "mcp",
      "analyze-chunks",
      "issues",
      "uploads",
      "files",
      "knowledge",
      "project",
    ];

    for (const cmd of expectedCommands) {
      assertEquals(cmd in COMMANDS, true, `Missing command: ${cmd}`);
    }
  });

  it("should have name matching registry key for each command", () => {
    for (const [key, cmd] of Object.entries(COMMANDS)) {
      assertEquals(cmd.name, key, `Command name mismatch: ${key} vs ${cmd.name}`);
    }
  });

  it("should have description for each command", () => {
    for (const [key, cmd] of Object.entries(COMMANDS)) {
      assertEquals(typeof cmd.description, "string", `Missing description for ${key}`);
      assertEquals(cmd.description.length > 0, true, `Empty description for ${key}`);
    }
  });

  it("should have usage for each command", () => {
    for (const [key, cmd] of Object.entries(COMMANDS)) {
      assertEquals(typeof cmd.usage, "string", `Missing usage for ${key}`);
      assertEquals(
        cmd.usage.includes("veryfront"),
        true,
        `Usage should include 'veryfront' for ${key}`,
      );
    }
  });

  it("should have examples for each command", () => {
    for (const [key, cmd] of Object.entries(COMMANDS)) {
      assertEquals((cmd.examples ?? []).length > 0, true, `No examples for ${key}`);
    }
  });

  it("should have valid option flags", () => {
    for (const [key, cmd] of Object.entries(COMMANDS)) {
      for (const opt of cmd.options ?? []) {
        assertEquals(typeof opt.flag, "string", `Invalid flag in ${key}`);
        assertEquals(
          opt.flag.startsWith("-"),
          true,
          `Flag should start with - in ${key}: ${opt.flag}`,
        );
        assertEquals(typeof opt.description, "string", `Missing option description in ${key}`);
      }
    }
  });
});

describe("cli/router helpers", () => {
  it("bounds oversized protected-deletion error context with truncation metadata", () => {
    const context = safeJsonErrorContext({
      protectedDeleted: Array.from({ length: 1_025 }, (_, index) => `.env.secret-${index}`),
    });

    assertEquals((context?.protectedDeleted as string[]).length, 1_000);
    assertEquals(context?.protectedDeletedTruncated, true);
    assertEquals(context?.protectedDeletedOmitted, 25);
  });

  describe("classifyCliError", () => {
    it("uses typed exit metadata instead of message prefixes", () => {
      assertEquals(
        classifyCliError(UNKNOWN_ERROR.create({ detail: "Invalid runtime response" })),
        {
          code: "RUNTIME_ERROR",
          slug: "command-failed",
          exitCode: 1,
        },
      );
      assertEquals(
        classifyCliError(INVALID_ARGUMENT.create({ detail: "Check the supplied value" })),
        {
          code: "USAGE_ERROR",
          slug: "invalid-arguments",
          exitCode: 2,
        },
      );
    });
  });

  describe("resolveProjectDir pattern", () => {
    it("should return cwd when no matching key found", () => {
      assertEquals(resolveProjectDir({}, ["dir", "d"], "/home/user"), "/home/user");
    });

    it("should return absolute path as-is", () => {
      assertEquals(
        resolveProjectDir({ dir: "/absolute/path" }, ["dir", "d"], "/home/user"),
        "/absolute/path",
      );
    });

    it("should resolve relative path from cwd", () => {
      assertEquals(
        resolveProjectDir({ dir: "my-project" }, ["dir", "d"], "/home/user"),
        "/home/user/my-project",
      );
    });

    it("should prefer first matching key", () => {
      assertEquals(
        resolveProjectDir(
          { "project-dir": "/first", dir: "/second" },
          ["project-dir", "dir", "d"],
          "/home/user",
        ),
        "/first",
      );
    });

    it("should skip null/undefined keys", () => {
      assertEquals(
        resolveProjectDir(
          { "project-dir": undefined, dir: "resolved" },
          ["project-dir", "dir"],
          "/home/user",
        ),
        "/home/user/resolved",
      );
    });
  });

  describe("parseCsvArg pattern", () => {
    it("should return undefined for falsy value", () => {
      assertEquals(parseCsvArg(undefined), undefined);
      assertEquals(parseCsvArg(null), undefined);
      assertEquals(parseCsvArg(""), undefined);
      assertEquals(parseCsvArg(0), undefined);
    });

    it("should parse single value", () => {
      assertEquals(parseCsvArg("project1"), ["project1"]);
    });

    it("should parse multiple values", () => {
      assertEquals(parseCsvArg("a,b,c"), ["a", "b", "c"]);
    });

    it("should trim whitespace", () => {
      assertEquals(parseCsvArg(" a , b , c "), ["a", "b", "c"]);
    });

    it("should filter empty segments", () => {
      assertEquals(parseCsvArg("a,,b,"), ["a", "b"]);
    });

    it("should handle number input", () => {
      assertEquals(parseCsvArg(42), ["42"]);
    });
  });

  describe("parseLoginMethod (real implementation)", () => {
    const args = (overrides: Record<string, unknown>): ParsedArgs =>
      ({ _: [], ...overrides }) as ParsedArgs;

    it("should return undefined when no method specified", () => {
      assertEquals(parseLoginMethod(args({})), undefined);
    });

    it("should detect google", () => {
      assertEquals(parseLoginMethod(args({ google: true })), "google");
    });

    it("should detect github", () => {
      assertEquals(parseLoginMethod(args({ github: true })), "github");
    });

    it("should detect microsoft", () => {
      assertEquals(parseLoginMethod(args({ microsoft: true })), "microsoft");
    });

    it("should detect token", () => {
      assertEquals(parseLoginMethod(args({ token: true })), "token");
    });

    it("should prioritize google over others", () => {
      assertEquals(parseLoginMethod(args({ google: true, github: true })), "google");
    });

    it("should prioritize github over microsoft", () => {
      assertEquals(parseLoginMethod(args({ github: true, microsoft: true })), "github");
    });

    it("should skip false values", () => {
      assertEquals(
        parseLoginMethod(args({ google: false, github: false, token: true })),
        "token",
      );
    });
  });

  describe("handleValidationError pattern", () => {
    it("should format zod issues into string", () => {
      const issues = [
        { path: ["branch"], message: "Required" },
        { path: ["env"], message: "Invalid enum value" },
      ];
      const formatted = formatIssues(issues);

      assertEquals(formatted.includes("branch: Required"), true);
      assertEquals(formatted.includes("env: Invalid enum value"), true);
    });

    it("should handle nested paths", () => {
      const issues = [{ path: ["config", "port"], message: "Expected number" }];
      const formatted = formatIssues(issues);

      assertEquals(formatted.includes("config.port: Expected number"), true);
    });

    it("should look up command usage from COMMANDS", () => {
      const command = COMMANDS["deploy"];
      assertEquals(typeof command?.usage, "string");
      assertEquals(command?.usage.includes("veryfront deploy"), true);
    });
  });

  describe("global flag handling patterns", () => {
    it("should recognize version flags", () => {
      const args = { version: true, v: undefined, _: [] };
      assertEquals(Boolean(args.version || args.v), true);
    });

    it("should recognize -v flag", () => {
      const args = { version: undefined, v: true, _: [] };
      assertEquals(Boolean(args.version || args.v), true);
    });

    it("should recognize help flags", () => {
      const args = { help: true, h: undefined, _: [] };
      assertEquals(Boolean(args.help || args.h), true);
    });

    it("should recognize -h flag", () => {
      const args = { help: undefined, h: true, _: [] };
      assertEquals(Boolean(args.help || args.h), true);
    });

    it("should detect no-color flag", () => {
      const args = { "no-color": true, _: [] };
      assertEquals(Boolean(args["no-color"]), true);
    });

    it("should detect color flag", () => {
      const args = { color: true, _: [] };
      assertEquals(Boolean(args.color), true);
    });

    it("should detect verbose flag", () => {
      const args = { verbose: true, _: [] };
      assertEquals(Boolean(args.verbose), true);
    });

    it("should detect quiet/q flags", () => {
      assertEquals(Boolean({ quiet: true }.quiet), true);
      assertEquals(Boolean({ q: true }.q), true);
    });
  });

  describe("version output", () => {
    /** Sentinel thrown by our Deno.exit stub so routeCommand stops without killing the process. */
    class ExitSentinel extends Error {
      code: number;
      constructor(code: number) {
        super(`exit(${code})`);
        this.code = code;
      }
    }

    const originalExit = Deno.exit;
    const originalInfo = cliLogger.info;
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    let infoMessages: string[];
    let consoleOutput: string[];
    let consoleErrorOutput: string[];

    function stubExit() {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = (code: number) => {
        throw new ExitSentinel(code ?? 0);
      };
    }

    function stubLogger() {
      infoMessages = [];
      cliLogger.info = (...args: unknown[]) => {
        infoMessages.push(args.map(String).join(" "));
      };
    }

    function stubConsole() {
      consoleOutput = [];
      consoleErrorOutput = [];
      console.log = (...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(" "));
      };
      console.error = (...args: unknown[]) => {
        consoleErrorOutput.push(args.map(String).join(" "));
      };
    }

    function restoreAll() {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = originalExit;
      cliLogger.info = originalInfo;
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      setJsonMode(false);
      resetInteractiveMode();
    }

    async function runAndCaptureExit(args: ParsedArgs): Promise<number> {
      try {
        await routeCommand(args);
        throw new Error("routeCommand did not exit");
      } catch (e) {
        if (e instanceof ExitSentinel) return e.code;
        throw e;
      }
    }

    it("--version prints version string and exits 0", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit({ version: true, _: [] } as ParsedArgs);
        assertEquals(code, 0);
        assertEquals(infoMessages.length, 1);
        assertEquals(infoMessages[0], `Veryfront CLI v${VERSION}`);
      } finally {
        restoreAll();
      }
    });

    it("-v short form prints version string", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit({ v: true, _: [] } as ParsedArgs);
        assertEquals(code, 0);
        assertEquals(infoMessages[0], `Veryfront CLI v${VERSION}`);
      } finally {
        restoreAll();
      }
    });

    it("--yes enables non-interactive confirmation before routing", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit({ version: true, yes: true, _: [] } as ParsedArgs);
        assertEquals(code, 0);
        assertEquals(isInteractive(), false);
      } finally {
        restoreAll();
      }
    });

    it("--no-input disables prompts without auto-confirming", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit({
          version: true,
          "no-input": true,
          _: [],
        } as ParsedArgs);
        assertEquals(code, 0);
        assertEquals(isInteractive(), false);
      } finally {
        restoreAll();
      }
    });

    it("--version --verbose prints runtime and OS details", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(
          { version: true, verbose: true, _: [] } as ParsedArgs,
        );
        assertEquals(code, 0);
        assertEquals(infoMessages.length, 3);
        assertEquals(infoMessages[0], `Veryfront CLI v${VERSION}`);
        assertEquals(
          infoMessages[1],
          `Deno ${Deno.version.deno} (V8 ${Deno.version.v8}, TypeScript ${Deno.version.typescript})`,
        );
        assertEquals(infoMessages[2], `OS: ${Deno.build.os} ${Deno.build.arch}`);
      } finally {
        restoreAll();
      }
    });

    it("--version --json outputs structured JSON envelope", async () => {
      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        const code = await runAndCaptureExit(
          { version: true, json: true, _: [] } as ParsedArgs,
        );
        assertEquals(code, 0);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0]!);
        assertEquals(parsed.success, true);
        assertEquals(parsed.command, "version");
        assertEquals(parsed.data.version, VERSION);
        assertEquals(parsed.data.deno, Deno.version.deno);
        assertEquals(parsed.data.v8, Deno.version.v8);
        assertEquals(parsed.data.typescript, Deno.version.typescript);
        assertEquals(parsed.data.os, Deno.build.os);
        assertEquals(parsed.data.arch, Deno.build.arch);
        assertEquals(typeof parsed.data.standalone, "boolean");
      } finally {
        restoreAll();
      }
    });

    it("unknown command with --json outputs a JSON error envelope", async () => {
      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        const code = await runAndCaptureExit(
          { _: ["nosuch"], json: true } as ParsedArgs,
        );
        assertEquals(code, 2);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0]!);
        assertEquals(parsed.success, false);
        assertEquals(parsed.command, "nosuch");
        assertEquals(parsed.error.code, "USAGE_ERROR");
        assertEquals(parsed.error.slug, "unknown-command");
        assertEquals(parsed.error.message, "Unknown command: nosuch");
      } finally {
        restoreAll();
      }
    });

    it("routes env to its subcommand handler", async () => {
      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        const code = await runAndCaptureExit({ _: ["env"], json: true } as ParsedArgs);
        assertEquals(code, 2);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0]!);
        assertEquals(parsed.command, "env");
        assertEquals(parsed.error.registrySlug, "invalid-argument");
        assertEquals(
          parsed.error.message,
          "Environment subcommand is required. Usage: veryfront env token --env <name>",
        );
      } finally {
        restoreAll();
      }
    });

    const DUPLICATED_BINARY_MESSAGE =
      '  You already included "veryfront". Remove the extra "veryfront" argument and run the command again.';

    it("a duplicated binary name explains how to remove it", async () => {
      stubExit();
      stubLogger();
      stubConsole();
      try {
        const code = await runAndCaptureExit({ _: ["veryfront", "dev"] } as ParsedArgs);
        assertEquals(code, 2);
        assertEquals(infoMessages, [DUPLICATED_BINARY_MESSAGE]);
      } finally {
        restoreAll();
      }
    });

    it("a duplicated binary name is explained rather than shadowed by --help", async () => {
      stubExit();
      stubLogger();
      stubConsole();
      try {
        const code = await runAndCaptureExit(
          { _: ["veryfront", "login"], help: true } as ParsedArgs,
        );
        assertEquals(code, 2);
        assertEquals(infoMessages, [DUPLICATED_BINARY_MESSAGE]);
      } finally {
        restoreAll();
      }
    });

    it("a duplicated binary name followed by an unknown command falls through", async () => {
      stubExit();
      stubLogger();
      stubConsole();
      try {
        const code = await runAndCaptureExit({ _: ["veryfront", "nosuch"] } as ParsedArgs);
        assertEquals(code, 2);
        assertEquals(infoMessages.includes(DUPLICATED_BINARY_MESSAGE), false);
      } finally {
        restoreAll();
      }
    });

    it("a duplicated binary name with --json suggests the intended command", async () => {
      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        const code = await runAndCaptureExit(
          { _: ["veryfront", "login"], json: true } as ParsedArgs,
        );
        assertEquals(code, 2);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0]!);
        assertEquals(parsed.success, false);
        assertEquals(parsed.command, "veryfront");
        assertEquals(parsed.error.code, "USAGE_ERROR");
        assertEquals(parsed.error.slug, "unknown-command");
        assertEquals(parsed.error.message, "Unknown command: veryfront");
        assertEquals(parsed.error.context.suggestions, ["login"]);
      } finally {
        restoreAll();
      }
    });

    it("command validation failure with --json outputs a JSON error envelope", async () => {
      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        const code = await runAndCaptureExit(
          parsedArgsWithRawMode({ _: ["serve"], json: true }, "invalid"),
        );
        assertEquals(code, 2);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0]!);
        assertEquals(parsed.success, false);
        assertEquals(parsed.command, "serve");
        assertEquals(parsed.error.code, "USAGE_ERROR");
        assertEquals(parsed.error.slug, "invalid-arguments");
        assertEquals(parsed.error.registrySlug, "invalid-argument");
      } finally {
        restoreAll();
      }
    });

    it("writes human command failures to stderr", async () => {
      stubExit();
      stubLogger();
      stubConsole();
      const previousUpdateCheck = Deno.env.get("VERYFRONT_NO_UPDATE_CHECK");
      Deno.env.set("VERYFRONT_NO_UPDATE_CHECK", "1");
      try {
        const code = await runAndCaptureExit(
          parsedArgsWithRawMode({ _: ["serve"] }, "invalid"),
        );
        assertEquals(code, 2);
        assertEquals(consoleErrorOutput.some((line) => line.includes("✗")), true);
      } finally {
        if (previousUpdateCheck === undefined) Deno.env.delete("VERYFRONT_NO_UPDATE_CHECK");
        else Deno.env.set("VERYFRONT_NO_UPDATE_CHECK", previousUpdateCheck);
        restoreAll();
      }
    });

    it("reports incompatible remote schedule input as a usage error", async () => {
      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        const code = await runAndCaptureExit({
          _: ["schedule", "run", "process-job-submissions"],
          remote: true,
          input: "input.json",
          json: true,
        } as ParsedArgs);
        assertEquals(code, 2);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0]!);
        assertEquals(parsed.success, false);
        assertEquals(parsed.command, "schedule");
        assertEquals(parsed.error.code, "USAGE_ERROR");
        assertEquals(parsed.error.slug, "invalid-arguments");
        assertEquals(parsed.error.registrySlug, "invalid-argument");
      } finally {
        restoreAll();
      }
    });

    it("reports missing credentials for schedule remote JSON runs as JSON command failure", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-schedule-json-auth-" });
      const configHome = await Deno.makeTempDir({ prefix: "vf-schedule-json-auth-config-" });
      const environmentNames = [
        "VERYFRONT_API_URL",
        "VERYFRONT_API_TOKEN",
        "VERYFRONT_PROJECT_SLUG",
        "XDG_CONFIG_HOME",
      ] as const;
      const originalEnvironment = Object.fromEntries(
        environmentNames.map((name) => [name, Deno.env.get(name)]),
      ) as Record<(typeof environmentNames)[number], string | undefined>;

      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ projectSlug: "json-auth-project" }),
        );
        Deno.env.delete("VERYFRONT_API_URL");
        Deno.env.delete("VERYFRONT_API_TOKEN");
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
        Deno.env.set("XDG_CONFIG_HOME", configHome);
        _resetEnvironmentConfig();

        const code = await runAndCaptureExit({
          _: ["schedule", "run", "process-job-submissions"],
          "project-dir": projectDir,
          remote: true,
          json: true,
        } as ParsedArgs);
        assertEquals(code, 1);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0] ?? "{}");
        assertEquals(parsed.success, false);
        assertEquals(parsed.command, "schedule");
        assertEquals(parsed.error.code, "RUNTIME_ERROR");
        assertEquals(parsed.error.slug, "command-failed");
        assertEquals(parsed.error.registrySlug, "unknown-error");
        assertEquals(parsed.error.message, "Authentication required for this operation.");
        assertEquals(consoleErrorOutput, []);
      } finally {
        for (const name of environmentNames) {
          const value = originalEnvironment[name];
          if (value === undefined) Deno.env.delete(name);
          else Deno.env.set(name, value);
        }
        _resetEnvironmentConfig();
        restoreAll();
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(configHome, { recursive: true });
      }
    });
  });

  describe("command extraction from args", () => {
    it("should extract first positional as command", () => {
      assertEquals(({ _: ["dev"] } as const)._[0], "dev");
    });

    it("should handle undefined command", () => {
      assertEquals(({ _: [] } as { _: string[] })._[0], undefined);
    });

    it("should extract subcommand as second positional", () => {
      const args = { _: ["issues", "create"] };
      assertEquals(args._[0], "issues");
      assertEquals(args._[1], "create");
    });
  });
});
