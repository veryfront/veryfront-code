import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { detectRuntime, getSkillScriptExecutor, LocalScriptExecutor } from "./executor.ts";

const SKILL_ENV_KEYS = [
  "SANDBOX_AUTH_TOKEN",
  "VERYFRONT_API_TOKEN",
] as const;

function clearSkillEnv(): void {
  for (const key of SKILL_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

describe("src/skill/executor", () => {
  afterEach(() => {
    clearSkillEnv();
  });

  describe("detectRuntime", () => {
    it("should detect Python scripts", () => {
      const { command, args } = detectRuntime("scripts/setup.py");
      assertEquals(command, "python3");
      assertEquals(args, ["scripts/setup.py"]);
    });

    it("should detect Bash scripts", () => {
      const { command, args } = detectRuntime("scripts/setup.sh");
      assertEquals(command, "bash");
      assertEquals(args, ["scripts/setup.sh"]);
    });

    it("should detect JavaScript files", () => {
      const { command, args } = detectRuntime("scripts/run.js");
      assertEquals(command, "node");
      assertEquals(args, ["scripts/run.js"]);
    });

    it("should detect TypeScript files", () => {
      const result = detectRuntime("scripts/run.ts");
      // Either deno or npx tsx depending on runtime
      assertEquals(result.args.includes("scripts/run.ts"), true);
    });

    it("should use direct execution for unknown extensions", () => {
      const { command, args } = detectRuntime("scripts/run.rb");
      assertEquals(command, "scripts/run.rb");
      assertEquals(args, []);
    });
  });

  describe("LocalScriptExecutor", () => {
    it("should execute a simple echo command", async () => {
      const executor = new LocalScriptExecutor();
      const result = await executor.execute({
        scriptPath: "echo",
        args: ["hello"],
      });
      // echo won't be detected as any known extension, so it runs directly
      assertEquals(result.stdout.trim(), "hello");
      assertEquals(result.exitCode, 0);
    });

    it("should return timeout exit code when command exceeds timeout", async () => {
      const executor = new LocalScriptExecutor();
      const result = await executor.execute({
        scriptPath: "deno",
        args: ["eval", "await new Promise((r) => setTimeout(r, 1000));"],
        timeoutMs: 50,
      });

      assertEquals(result.exitCode, 124);
      assertEquals(result.stderr.includes("timed out"), true);
    });
  });

  describe("getSkillScriptExecutor", () => {
    it("uses cloud execution when VERYFRONT_API_TOKEN is set", () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_test_skill");

      const executor = getSkillScriptExecutor();
      assertEquals(executor.constructor.name, "CloudScriptExecutor");
    });

    it("uses cloud execution when request-scoped credentials are available", async () => {
      const executorType = await runWithRequestContext(
        {
          projectSlug: "skill-test",
          token: "vf_request_token",
        },
        async () => getSkillScriptExecutor().constructor.name,
      );

      assertEquals(executorType, "CloudScriptExecutor");
    });

    it("keeps SANDBOX_AUTH_TOKEN as an explicit cloud override", () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");

      const executor = getSkillScriptExecutor();
      assertEquals(executor.constructor.name, "CloudScriptExecutor");
    });

    it("falls back to local execution without cloud credentials", () => {
      const executor = getSkillScriptExecutor();
      assertEquals(executor instanceof LocalScriptExecutor, true);
    });
  });
});
