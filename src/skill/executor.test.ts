import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import {
  type FetchCall,
  installMockFetch,
  jsonResponse,
  type MockResponseEntry,
  ndjsonResponse,
  textResponse,
} from "../sandbox/sandbox.test-helpers.ts";
import {
  detectRuntime,
  getIsolatedSkillScriptExecutor,
  getSkillScriptExecutor,
  LocalScriptExecutor,
} from "./executor.ts";

const SKILL_ENV_KEYS = [
  "SANDBOX_AUTH_TOKEN",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
  "VERYFRONT_SERVICE_LAYER",
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

function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitForFetchCallCount(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && fetchCalls.length < expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assertEquals(fetchCalls.length >= expected, true);
}

type ObservedSettlement<T> =
  | { settled: true; value: T }
  | { settled: true; error: unknown }
  | { settled: false };

async function observePromptSettlement<T>(promise: Promise<T>): Promise<ObservedSettlement<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value): ObservedSettlement<T> => ({ settled: true, value }),
        (error): ObservedSettlement<T> => ({ settled: true, error }),
      ),
      new Promise<ObservedSettlement<T>>((resolve) => {
        timeoutId = setTimeout(() => resolve({ settled: false }), 750);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

type HangingCloudStage = "creation" | "upload" | "chmod";

function mockHangingCloudStage(stage: HangingCloudStage, pending: Promise<Response>): void {
  const create = jsonResponse({
    id: `session-hanging-${stage}`,
    endpoint: "https://sandbox.example.com",
    status: "running",
  });
  const upload = textResponse("");
  const command = ndjsonResponse([{ type: "exit", exitCode: 0 }]);
  const responses: MockResponseEntry[] = stage === "creation"
    ? [() => pending, upload, command, command, textResponse("")]
    : stage === "upload"
    ? [create, () => pending, command, command, textResponse("")]
    : [create, upload, () => pending, command, textResponse("")];
  mockFetch(responses);
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

    it("should run portable JavaScript module extensions through Node", () => {
      assertEquals(detectRuntime("scripts/run.mjs"), {
        command: "node",
        args: ["scripts/run.mjs"],
      });
      assertEquals(detectRuntime("scripts/run.cjs"), {
        command: "node",
        args: ["scripts/run.cjs"],
      });
    });

    it("should detect TypeScript files", () => {
      const result = detectRuntime("scripts/run.ts");
      // Deno and Node use their native TypeScript-capable entrypoints.
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

    it("should reject invalid timeouts instead of silently defaulting or clamping", async () => {
      const executor = new LocalScriptExecutor();

      await assertRejects(
        () => executor.execute({ scriptPath: "echo", timeoutMs: Number.NaN }),
        Error,
        "timeout must be an integer",
      );
      await assertRejects(
        () => executor.execute({ scriptPath: "echo", timeoutMs: 300_001 }),
        Error,
        "timeout must be an integer",
      );
    });

    it("should reject an already aborted execution before spawning a command", async () => {
      const executor = new LocalScriptExecutor();
      const controller = new AbortController();
      controller.abort(new Error("executor canceled"));

      await assertRejects(
        () => executor.execute({ scriptPath: "echo", abortSignal: controller.signal }),
        Error,
        "executor canceled",
      );
    });

    it("should terminate a running local command and preserve its abort reason", async () => {
      const executor = new LocalScriptExecutor();
      const controller = new AbortController();
      const reason = new Error("cancel running local script");
      const abortTimer = setTimeout(() => controller.abort(reason), 25);
      const startedAt = Date.now();
      let thrown: unknown;

      try {
        await executor.execute({
          scriptPath: "deno",
          args: ["eval", "setInterval(() => {}, 1_000);"],
          abortSignal: controller.signal,
          timeoutMs: 2_000,
        });
      } catch (error) {
        thrown = error;
      } finally {
        clearTimeout(abortTimer);
      }

      assertStrictEquals(thrown, reason);
      assertEquals(Date.now() - startedAt < 1_000, true);
    });

    it("should reject accessor-backed environment entries", async () => {
      const executor = new LocalScriptExecutor();
      const env = Object.defineProperty({}, "TOKEN", {
        enumerable: true,
        get() {
          throw new Error("must not execute");
        },
      });

      await assertRejects(
        () => executor.execute({ scriptPath: "echo", env }),
        Error,
        "data properties",
      );
    });

    it("should reject accessor-backed top-level input before execution", async () => {
      const executor = new LocalScriptExecutor();
      let pathReads = 0;
      const input = Object.defineProperty({ args: ["must-not-run"] }, "scriptPath", {
        enumerable: true,
        get() {
          pathReads++;
          return pathReads === 1 ? "echo" : "printf";
        },
      });

      await assertRejects(
        () => executor.execute(input as { scriptPath: string; args: string[] }),
        Error,
        "data properties",
      );
      assertEquals(pathReads, 0);
    });

    it("should not inherit arbitrary parent secrets", async () => {
      const key = "VF_SKILL_EXECUTOR_PARENT_SECRET";
      const previous = getEnv(key);
      setEnv(key, "must-not-leak");
      try {
        const result = await new LocalScriptExecutor().execute({
          scriptPath: "deno",
          args: ["eval", `console.log(Deno.env.get("${key}"))`],
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stdout.trim(), "undefined");
      } finally {
        if (previous === undefined) deleteEnv(key);
        else setEnv(key, previous);
      }
    });

    it("should pass explicitly provided environment values", async () => {
      const result = await new LocalScriptExecutor().execute({
        scriptPath: "deno",
        args: ["eval", 'console.log(Deno.env.get("VF_SKILL_EXPLICIT"))'],
        env: { VF_SKILL_EXPLICIT: "available" },
      });

      assertEquals(result.exitCode, 0);
      assertEquals(result.stdout.trim(), "available");
    });

    it("should reject malformed and unbounded execution inputs", async () => {
      const executor = new LocalScriptExecutor();
      const oversizedEnvironment = Object.fromEntries(
        Array.from({ length: 17 }, (_, index) => [`KEY_${index}`, "x".repeat(65_536)]),
      );
      const symbolEnvironment = { VALUE: "ok", [Symbol("hidden")]: "no" };
      const revoked = Proxy.revocable({ VALUE: "ok" }, {});
      revoked.revoke();

      await assertRejects(
        () => executor.execute({ scriptPath: "" }),
        Error,
        "path is invalid",
      );
      await assertRejects(
        () => executor.execute({ scriptPath: "echo", cwd: "bad\0cwd" }),
        Error,
        "working directory is invalid",
      );
      await assertRejects(
        () =>
          executor.execute({
            scriptPath: "echo",
            scriptContent: "x".repeat(4 * 1_048_576 + 1),
          }),
        Error,
        "content exceeds",
      );
      await assertRejects(
        () => executor.execute({ scriptPath: "echo", args: Array<string>(1) }),
        Error,
        "dense array",
      );
      await assertRejects(
        () => executor.execute({ scriptPath: "echo", args: ["bad\0argument"] }),
        Error,
        "invalid argument",
      );
      await assertRejects(
        () => executor.execute({ scriptPath: "echo", env: { "INVALID-KEY": "value" } }),
        Error,
        "invalid variable name",
      );
      await assertRejects(
        () => executor.execute({ scriptPath: "echo", env: { VALUE: "bad\0value" } }),
        Error,
        "invalid value",
      );
      await assertRejects(
        () => executor.execute({ scriptPath: "echo", env: oversizedEnvironment }),
        Error,
        "environment is too large",
      );
      await assertRejects(
        () =>
          executor.execute({
            scriptPath: "echo",
            env: symbolEnvironment as Record<string, string>,
          }),
        Error,
        "string keys",
      );
      await assertRejects(
        () =>
          executor.execute({
            scriptPath: "echo",
            env: revoked.proxy,
          }),
        Error,
        "environment must be readable",
      );
      await assertRejects(
        () =>
          executor.execute({
            scriptPath: "echo",
            abortSignal: {} as AbortSignal,
          }),
        Error,
        "abort signal is invalid",
      );
    });
  });

  describe("getSkillScriptExecutor", () => {
    it("uses cloud execution when VERYFRONT_API_TOKEN is set", () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_test_skill");
      setEnv("VERYFRONT_SERVICE_LAYER", "cloud");

      const executor = getSkillScriptExecutor();
      assertEquals(executor.constructor.name, "CloudScriptExecutor");
    });

    it("keeps local execution when the service layer is explicitly local", () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_test_skill");
      setEnv("VERYFRONT_SERVICE_LAYER", "local");

      assertEquals(getSkillScriptExecutor().constructor.name, "LocalScriptExecutor");
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

    it("does not use host credentials for adapter-backed script isolation", () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_host_token");
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-host-token");

      assertThrows(
        () => getIsolatedSkillScriptExecutor(),
        Error,
        "request-scoped auth token",
      );
      assertEquals(
        getIsolatedSkillScriptExecutor("vf_request_token").constructor.name,
        "CloudScriptExecutor",
      );
    });

    for (const stage of ["creation", "upload", "chmod"] as const) {
      it(`bounds a hanging sandbox ${stage} stage with the execution timeout`, async () => {
        setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
        setEnv("VERYFRONT_API_URL", "https://api.test.com");
        const pending = deferredResponse();
        mockHangingCloudStage(stage, pending.promise);

        const execution = getSkillScriptExecutor().execute({
          scriptPath: "scripts/run.sh",
          scriptContent: "echo done",
          timeoutMs: 100,
        });
        const observed = await observePromptSettlement(execution);

        if (stage !== "creation" && observed.settled) {
          const closeCallIndex = stage === "upload" ? 2 : 3;
          await waitForFetchCallCount(closeCallIndex + 1);
          assertStringIncludes(
            fetchCalls[closeCallIndex]!.url,
            `/sandbox-sessions/session-hanging-${stage}`,
          );
          assertEquals(fetchCalls[closeCallIndex]!.init?.method, "DELETE");
        }
        pending.resolve(
          stage === "creation"
            ? jsonResponse({
              id: "session-hanging-creation",
              endpoint: "https://sandbox.example.com",
              status: "running",
            })
            : stage === "upload"
            ? textResponse("")
            : ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        );
        const result = observed.settled && "value" in observed ? observed.value : await execution;

        assertEquals(observed.settled, true);
        assertEquals(result.exitCode, 124);
        assertStringIncludes(result.stderr, "timed out");
        if (stage === "creation") {
          await waitForFetchCallCount(2);
          assertStringIncludes(fetchCalls[1]!.url, "/sandbox-sessions/session-hanging-creation");
          assertEquals(fetchCalls[1]!.init?.method, "DELETE");
        }
      });

      it(`aborts promptly while sandbox ${stage} is hanging`, async () => {
        setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
        setEnv("VERYFRONT_API_URL", "https://api.test.com");
        const pending = deferredResponse();
        mockHangingCloudStage(stage, pending.promise);
        const controller = new AbortController();
        const reason = new Error(`abort hanging ${stage}`);
        const execution = getSkillScriptExecutor().execute({
          scriptPath: "scripts/run.sh",
          scriptContent: "echo done",
          timeoutMs: 2_000,
          abortSignal: controller.signal,
        });
        await waitForFetchCallCount(stage === "creation" ? 1 : stage === "upload" ? 2 : 3);
        controller.abort(reason);
        const observed = await observePromptSettlement(execution);

        if (stage !== "creation" && observed.settled) {
          const closeCallIndex = stage === "upload" ? 2 : 3;
          await waitForFetchCallCount(closeCallIndex + 1);
          assertStringIncludes(
            fetchCalls[closeCallIndex]!.url,
            `/sandbox-sessions/session-hanging-${stage}`,
          );
          assertEquals(fetchCalls[closeCallIndex]!.init?.method, "DELETE");
        }
        pending.resolve(
          stage === "creation"
            ? jsonResponse({
              id: "session-hanging-creation",
              endpoint: "https://sandbox.example.com",
              status: "running",
            })
            : stage === "upload"
            ? textResponse("")
            : ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        );
        if (!observed.settled) {
          await execution.catch(() => {});
        }

        assertEquals(observed.settled, true);
        assertStrictEquals(
          observed.settled && "error" in observed ? observed.error : undefined,
          reason,
        );
        if (stage === "creation") {
          await waitForFetchCallCount(2);
          assertStringIncludes(fetchCalls[1]!.url, "/sandbox-sessions/session-hanging-creation");
          assertEquals(fetchCalls[1]!.init?.method, "DELETE");
        }
      });
    }

    it("includes sandbox cleanup in the execution deadline", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const pendingClose = deferredResponse();
      mockFetch([
        jsonResponse({
          id: "session-hanging-cleanup",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        () => pendingClose.promise,
      ]);

      const execution = getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "echo done",
        timeoutMs: 100,
      });
      const observed = await observePromptSettlement(execution);
      pendingClose.resolve(textResponse(""));
      const result = observed.settled && "value" in observed ? observed.value : await execution;

      assertEquals(observed.settled, true);
      assertEquals(result.exitCode, 124);
    });

    it("aborts promptly while sandbox cleanup is hanging", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const pendingClose = deferredResponse();
      mockFetch([
        jsonResponse({
          id: "session-abort-cleanup",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        () => pendingClose.promise,
      ]);
      const controller = new AbortController();
      const reason = new Error("abort hanging cleanup");
      const execution = getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "echo done",
        timeoutMs: 2_000,
        abortSignal: controller.signal,
      });
      await waitForFetchCallCount(5);
      controller.abort(reason);
      const observed = await observePromptSettlement(execution);
      pendingClose.resolve(textResponse(""));
      if (!observed.settled) await execution.catch(() => {});

      assertEquals(observed.settled, true);
      assertStrictEquals(
        observed.settled && "error" in observed ? observed.error : undefined,
        reason,
      );
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

    it("reads a bounded local script and returns cloud command output", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-success",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "completed\n" },
          { type: "exit", exitCode: 0 },
        ]),
        textResponse(""),
      ]);
      const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-cloud-script-" });
      const scriptPath = `${tempDir}/run.sh`;
      try {
        await Deno.writeTextFile(scriptPath, "echo completed");
        const result = await getSkillScriptExecutor().execute({
          scriptPath,
          env: { VF_SKILL_MODE: "test" },
          timeoutMs: 2_000,
        });

        assertEquals(result, { stdout: "completed\n", stderr: "", exitCode: 0 });
        assertEquals(fetchCalls.length, 5);
        const executionBody = JSON.parse(fetchCalls[3]!.init?.body?.toString() ?? "{}");
        assertEquals(executionBody.env, { VF_SKILL_MODE: "test" });
        assertEquals(executionBody.cwd, "/tmp");
        assertEquals(
          typeof executionBody.timeout_seconds === "number" &&
            executionBody.timeout_seconds > 0 && executionBody.timeout_seconds <= 2,
          true,
        );
        assertEquals(String(executionBody.command).includes("VF_SKILL_MODE"), false);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("enforces the skill output budget for cloud execution", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-output-limit",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "x".repeat(4 * 1_048_576 + 1) },
          { type: "exit", exitCode: 0 },
        ]),
        textResponse(""),
      ]);

      await assertRejects(
        () =>
          getSkillScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "echo output",
          }),
        Error,
        "output exceeds",
      );
    });

    it("rejects a missing local cloud script before creating a sandbox", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");

      await assertRejects(
        () => getSkillScriptExecutor().execute({ scriptPath: "/missing/skill-script.sh" }),
        Error,
        "Unable to inspect the skill script",
      );
      assertEquals(fetchCalls, []);
    });

    it("aborts and cleans up a running sandbox command", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const pendingCommand = pendingErrorNdjsonResponse(new Error("sandbox process killed"));
      mockFetch([
        jsonResponse({
          id: "session-abort",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        pendingCommand.response,
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      const controller = new AbortController();
      const execution = getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "sleep 10",
        timeoutMs: 10_000,
        abortSignal: controller.signal,
      });
      for (let attempt = 0; attempt < 50 && fetchCalls.length < 4; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assertEquals(fetchCalls.length >= 4, true);
      controller.abort(new Error("cloud execution canceled"));

      await assertRejects(() => execution, Error, "cloud execution canceled");
      pendingCommand.reject();
      await Promise.resolve();

      assertEquals(fetchCalls.length, 6);
      assertStringIncludes(fetchCalls[4]!.init?.body?.toString() ?? "", "kill -9 -1");
    });

    it("falls back to local execution without cloud credentials", () => {
      const executor = getSkillScriptExecutor();
      assertEquals(executor instanceof LocalScriptExecutor, true);
    });
  });
});
