import "#veryfront/schemas/_test-setup.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withCwd } from "#veryfront/testing/cwd.ts";
import { COMMANDS } from "./help/command-definitions.ts";
import { parseLoginMethod } from "./auth/utils.ts";
import { formatDuplicatedBinaryHint, routeCommand } from "./router.ts";
import { cliLogger, VERSION } from "./utils/index.ts";
import { setJsonMode } from "./shared/json-output.ts";
import { isInteractive, resetInteractiveMode } from "./shared/interactive.ts";
import { parseCliArgs } from "./shared/args.ts";
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

    it("explains how to remove a duplicated binary name", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit({
          _: ["veryfront", "login"],
        } as ParsedArgs);
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("explains how to remove a duplicated binary name before the help route", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "help",
          "login",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront help login",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves and safely renders positional arguments in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit({
          _: [
            "veryfront",
            "task",
            "sync data",
            "it's ready",
            "https://user:secret@example.test/path",
          ],
        } as ParsedArgs);
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront task 'sync data' 'it'\\''s ready' 'https://user:[REDACTED]@example.test/path'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves options in the correction without exposing sensitive values", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "deploy",
          "--dry-run",
          "--environment",
          "staging",
          "--token=top-secret",
          "file:///local/project",
          "unsafe\u0085value",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront deploy --dry-run --environment '<REDACTED>' --token='<REDACTED>' '<REDACTED>' '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves root-relative build route filters in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "build",
          "--ssg",
          "--include",
          "/docs",
          "--exclude=/api",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront build --ssg --include /docs --exclude=/api",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts local paths embedded after whitespace in option values", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "login",
          "--note",
          "see /home/alice/private",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login --note '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves public URLs embedded after whitespace", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "task",
          "see https://docs.example.test/guide",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront task 'see https://docs.example.test/guide'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts root-relative paths outside build route filters", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "login",
          "--include",
          "/private/route-config",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login --include '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts serve hostname option values in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "serve",
          "--hostname",
          "app.internal.example",
          "--host=preview.internal.example",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront serve --hostname '<REDACTED>' --host='<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts preview alias host option values in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "preview",
          "--host",
          "preview.internal.example",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront preview --host '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves documented preview alias option values in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "preview",
          "--port",
          "8080",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront preview --port 8080",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts deploy target identifiers in the correction", async () => {
      stubExit();
      stubLogger();
      const targetOptions = [
        "--project",
        "-p",
        "--environment",
        "--env",
        "-e",
        "--branch",
        "-b",
        "--release-name",
      ];
      try {
        for (const option of targetOptions) {
          infoMessages.length = 0;
          const code = await runAndCaptureExit(parseCliArgs([
            "veryfront",
            "deploy",
            option,
            "private-deployment-target",
          ]));
          assertEquals(code, 2);
          assertEquals(infoMessages, [
            '  You already included "veryfront". Use:',
            `    veryfront deploy ${option} '<REDACTED>'`,
          ]);
        }
      } finally {
        restoreAll();
      }
    });

    it("redacts pull target identifiers in the correction", async () => {
      stubExit();
      stubLogger();
      const targetOptions = [
        "--project",
        "-p",
        "--projects",
        "--env",
        "--branch",
        "-b",
        "--release",
      ];
      try {
        for (const option of targetOptions) {
          infoMessages.length = 0;
          const code = await runAndCaptureExit(parseCliArgs([
            "veryfront",
            "pull",
            option,
            "private-pull-target",
          ]));
          assertEquals(code, 2);
          assertEquals(infoMessages, [
            '  You already included "veryfront". Use:',
            `    veryfront pull ${option} '<REDACTED>'`,
          ]);
        }
      } finally {
        restoreAll();
      }
    });

    it("redacts push target identifiers in the correction", async () => {
      stubExit();
      stubLogger();
      const targetOptions = ["--project", "-p", "--branch", "-b"];
      try {
        for (const option of targetOptions) {
          infoMessages.length = 0;
          const code = await runAndCaptureExit(parseCliArgs([
            "veryfront",
            "push",
            option,
            "private-push-target",
          ]));
          assertEquals(code, 2);
          assertEquals(infoMessages, [
            '  You already included "veryfront". Use:',
            `    veryfront push ${option} '<REDACTED>'`,
          ]);
        }
      } finally {
        restoreAll();
      }
    });

    it("redacts open target identifiers in the correction", async () => {
      stubExit();
      stubLogger();
      const targetOptions = ["--project", "-p", "--env"];
      try {
        for (const option of targetOptions) {
          infoMessages.length = 0;
          const code = await runAndCaptureExit(parseCliArgs([
            "veryfront",
            "open",
            option,
            "private-open-target",
          ]));
          assertEquals(code, 2);
          assertEquals(infoMessages, [
            '  You already included "veryfront". Use:',
            `    veryfront open ${option} '<REDACTED>'`,
          ]);
        }
      } finally {
        restoreAll();
      }
    });

    it("redacts a positional pull project identifier in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "pull",
          "private-project-slug",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront pull '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts values attached to unknown options in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "login",
          "--note",
          "private customer details",
          "--context=another private customer detail",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login --note '<REDACTED>' --context='<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves positional operands after the option separator", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "task",
          "--",
          "sync-data",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront task -- sync-data",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts opaque payload option values in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "workflow",
          "run",
          "content-pipeline",
          "--input",
          '{"prompt":"private customer text"}',
          '--config={"token":"private configuration"}',
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront workflow run content-pipeline --input '<REDACTED>' --config='<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts Redis URLs in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "worker",
          "--redis-url",
          "redis://cache.internal.example:6379/customer",
          "--redis=redis://cache.internal.example:6379/secondary",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront worker --redis-url '<REDACTED>' --redis='<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts login base URLs in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "login",
          "--provider",
          "openai",
          "--base-url",
          "https://model-gateway.corp.example/v1",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login --provider '<REDACTED>' --base-url '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves schedule input file paths in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "schedule",
          "run",
          "daily-triage",
          "--input",
          "fixtures/priority-queue.json",
          "--input=fixtures/secondary.json",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront schedule run daily-triage --input fixtures/priority-queue.json --input=fixtures/secondary.json",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts issue title and body content in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "issues",
          "create",
          "--title",
          "private customer incident",
          "-t=another private title",
          "--body",
          "private customer details",
          "-b=more private details",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront issues create --title '<REDACTED>' -t='<REDACTED>' --body '<REDACTED>' -b='<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts issue assignee identifiers in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "issues",
          "create",
          "--assignees",
          "customer@example.com",
          "--assignee=account-42",
          "-a",
          "another@example.com",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront issues create --assignees '<REDACTED>' --assignee='<REDACTED>' -a '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts issue label identifiers in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "issues",
          "create",
          "--labels",
          "customer-acme",
          "-l=project-private",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront issues create --labels '<REDACTED>' -l='<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts each repeated opaque option value independently", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "issues",
          "create",
          "--body",
          "private customer details",
          "--body",
          "--help",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront issues create --body '<REDACTED>' --body --help",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts negative-leading opaque option values", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "issues",
          "create",
          "--body",
          "-1 private customer detail",
          "--body",
          "--help",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront issues create --body '<REDACTED>' --body --help",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts a positional issue title in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "--no-input",
          "veryfront",
          "issues",
          "create",
          "--body",
          "private customer details",
          "private customer incident",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront --no-input issues create --body '<REDACTED>' '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("redacts local paths embedded in positional arguments", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "task",
          "sync",
          "source=/local/project",
          "cache=file:///local/cache",
          "drive=C:\\project\\source",
          "share=\\\\server\\share",
          "prefix:/local/output",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront task sync '<REDACTED>' '<REDACTED>' '<REDACTED>' '<REDACTED>' '<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("explains the duplicated binary name before routing global help", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit({
          _: ["veryfront", "login"],
          help: true,
        } as ParsedArgs);
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves flags after a boolean sensitive option", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "login",
          "--token",
          "--help",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login --token --help",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves explicit false for a sensitive boolean option", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "login",
          "--token=false",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront login --token=false",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("shell-quotes equals-style option names in the correction", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "veryfront",
          "deploy",
          "--label;echo injected=x",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront deploy '--label;echo injected'='<REDACTED>'",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("preserves global flags before the duplicated binary name", async () => {
      stubExit();
      stubLogger();
      try {
        const code = await runAndCaptureExit(parseCliArgs([
          "--no-input",
          "veryfront",
          "login",
        ]));
        assertEquals(code, 2);
        assertEquals(infoMessages, [
          '  You already included "veryfront". Use:',
          "    veryfront --no-input login",
        ]);
      } finally {
        restoreAll();
      }
    });

    it("does not advertise a POSIX command hint on Windows", async () => {
      const hint = await formatDuplicatedBinaryHint(
        parseCliArgs(["veryfront", "task", "sync data"]),
        "windows",
      );

      assertEquals(hint, undefined);
    });

    it("command validation failure with --json outputs a JSON error envelope", async () => {
      stubExit();
      stubConsole();
      setJsonMode(true);
      try {
        const code = await runAndCaptureExit(
          { _: ["serve"], mode: "invalid", json: true } as ParsedArgs,
        );
        assertEquals(code, 2);
        assertEquals(consoleOutput.length, 1);
        const parsed = JSON.parse(consoleOutput[0]!);
        assertEquals(parsed.success, false);
        assertEquals(parsed.command, "serve");
        assertEquals(parsed.error.code, "USAGE_ERROR");
        assertEquals(parsed.error.slug, "invalid-arguments");
        assertEquals(parsed.error.registrySlug, "unknown-error");
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
          { _: ["serve"], mode: "invalid" } as ParsedArgs,
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

        // Scoped to the call that resolves veryfront.json from the cwd, rather
        // than held across the whole test.
        const code = await withCwd(projectDir, () =>
          runAndCaptureExit({
            _: ["schedule", "run", "process-job-submissions"],
            remote: true,
            json: true,
          } as ParsedArgs));
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
