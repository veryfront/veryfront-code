import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import {
  type FetchCall,
  installMockFetch,
  jsonResponse,
  type MockResponseEntry,
  ndjsonResponse,
  textResponse,
} from "../sandbox/sandbox.test-helpers.ts";
import { detectRuntime, getSkillScriptExecutor, LocalScriptExecutor } from "./executor.ts";

const SKILL_ENV_KEYS = [
  "SANDBOX_AUTH_TOKEN",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
] as const;

const originalFetch = globalThis.fetch;
let fetchCalls: FetchCall[] = [];
let fetchResponses: MockResponseEntry[] = [];

function clearSkillEnv(): void {
  for (const key of SKILL_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

function mockFetch(responses: MockResponseEntry[]): void {
  fetchCalls = [];
  fetchResponses = [...responses];
  globalThis.fetch = installMockFetch({ calls: fetchCalls, responses: fetchResponses });
}

function pendingErrorNdjsonResponse(error: Error): {
  response: Response;
  reject: () => void;
} {
  let rejectBody!: (reason: Error) => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      rejectBody = (reason) => controller.error(reason);
    },
  });

  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    }),
    reject: () => rejectBody(error),
  };
}

describe("src/skill/executor", () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

    it("handles a late sandbox command rejection after timeout", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const pendingCommand = pendingErrorNdjsonResponse(new Error("sandbox process killed"));
      mockFetch([
        jsonResponse({
          id: "session-timeout",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        pendingCommand.response,
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      const executor = getSkillScriptExecutor();
      const result = await executor.execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "sleep 10",
        timeoutMs: 1,
      });

      pendingCommand.reject();
      await Promise.resolve();

      assertEquals(result.exitCode, 124);
      assertStringIncludes(result.stderr, "timed out");
      assertEquals(fetchCalls.length, 6);
      assertStringIncludes(fetchCalls[4]!.init?.body?.toString() ?? "", "kill -9 -1");
    });

    it("falls back to local execution without cloud credentials", () => {
      const executor = getSkillScriptExecutor();
      assertEquals(executor instanceof LocalScriptExecutor, true);
    });
  });
});
