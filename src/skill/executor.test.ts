import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  exists,
  makeTempDir,
  mkdir,
  realPath,
  remove,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
import { deleteEnv, getOsType, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import {
  type FetchCall,
  installMockFetch,
  jsonBody,
  jsonResponse,
  type MockResponseEntry,
  ndjsonResponse,
  textResponse,
} from "../sandbox/sandbox.test-helpers.ts";
import { detectRuntime, getSkillScriptExecutor, LocalScriptExecutor } from "./executor.ts";

function withInheritedArrayIndexSetter<T>(
  index: number,
  operation: () => T,
): { result: T; setterCalls: number } {
  const key = String(index);
  const original = Object.getOwnPropertyDescriptor(Array.prototype, key);
  let setterCalls = 0;
  Object.defineProperty(Array.prototype, key, {
    configurable: true,
    set: () => {
      setterCalls += 1;
    },
  });
  try {
    return { result: operation(), setterCalls };
  } finally {
    if (original) {
      Object.defineProperty(Array.prototype, key, original);
    } else {
      Reflect.deleteProperty(Array.prototype, key);
    }
  }
}

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

function rejectWhenFetchIsAborted(): MockResponseEntry {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const rejectForAbort = () =>
        reject(signal?.reason ?? new DOMException("Request aborted", "AbortError"));
      if (signal?.aborted) {
        rejectForAbort();
        return;
      }
      signal?.addEventListener("abort", rejectForAbort, { once: true });
    });
}

async function waitForFetchCallCount(expected: number, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (fetchCalls.length < expected) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${expected} fetch calls; observed ${fetchCalls.length}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function settleExecutorWithin(
  execution: Promise<{ exitCode: number }>,
  timeoutMs = 50,
): Promise<{ exitCode: number } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execution,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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
    it("normalizes arguments without invoking inherited numeric array setters", async () => {
      const controller = new AbortController();
      controller.abort();
      const args = ["first"];

      const execution = withInheritedArrayIndexSetter(
        0,
        () =>
          new LocalScriptExecutor().execute({
            scriptPath: "unused.sh",
            scriptContent: "exit 0",
            args,
            abortSignal: controller.signal,
          }),
      );

      assertEquals(execution.setterCalls, 0);
      assertEquals((await execution.result).exitCode, 130);
    });

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

    it("executes the original validated path while preserving relative imports", async () => {
      const skillRoot = await makeTempDir({ prefix: "vf-skill-source-root-" });
      const scriptDirectory = `${skillRoot}/scripts`;
      const scriptPath = `${scriptDirectory}/main.js`;
      const scriptContent = [
        'const helper = require("./helper.js");',
        "process.stdout.write(JSON.stringify({",
        "  message: helper.message,",
        "  path: __filename,",
        "}));",
      ].join("\n");

      try {
        await mkdir(scriptDirectory);
        await writeTextFile(scriptPath, scriptContent);
        await writeTextFile(
          `${scriptDirectory}/helper.js`,
          'module.exports = { message: "relative-ok" };\n',
        );

        const result = await new LocalScriptExecutor().execute({
          scriptPath,
          scriptContent,
          cwd: skillRoot,
          validatedSourceRoot: skillRoot,
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stderr, "");
        const observed = JSON.parse(result.stdout) as {
          message: string;
          path: string;
        };
        assertEquals(observed.message, "relative-ok");
        assertEquals(await realPath(observed.path), await realPath(scriptPath));
        assertEquals(await exists(scriptPath), true);
      } finally {
        await remove(skillRoot, { recursive: true });
      }
    });

    it("executes the validated source-root path when a relative script conflicts with cwd", async () => {
      const root = await makeTempDir({ prefix: "vf-skill-relative-cwd-" });
      const skillRoot = `${root}/skill`;
      const workingDirectory = `${root}/other`;
      const scriptContent = 'process.stdout.write("validated");';

      try {
        await mkdir(skillRoot);
        await mkdir(workingDirectory);
        await writeTextFile(`${skillRoot}/run.js`, scriptContent);
        await writeTextFile(
          `${workingDirectory}/run.js`,
          'process.stdout.write("wrong-working-directory-script");',
        );

        const result = await new LocalScriptExecutor().execute({
          scriptPath: "run.js",
          scriptContent,
          cwd: workingDirectory,
          validatedSourceRoot: skillRoot,
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stderr, "");
        assertEquals(result.stdout, "validated");
      } finally {
        await remove(root, { recursive: true });
      }
    });

    it("executes a relative validated script from its source root when cwd is omitted", async () => {
      const skillRoot = await makeTempDir({ prefix: "vf-skill-relative-default-cwd-" });
      const scriptContent = 'process.stdout.write("validated-without-cwd");';

      try {
        await writeTextFile(`${skillRoot}/run.js`, scriptContent);

        const result = await new LocalScriptExecutor().execute({
          scriptPath: "run.js",
          scriptContent,
          validatedSourceRoot: skillRoot,
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stderr, "");
        assertEquals(result.stdout, "validated-without-cwd");
      } finally {
        await remove(skillRoot, { recursive: true });
      }
    });

    it("validates and executes source-root content when validated content is omitted", async () => {
      const root = await makeTempDir({ prefix: "vf-skill-relative-read-" });
      const skillRoot = `${root}/skill`;
      const workingDirectory = `${root}/other`;

      try {
        await mkdir(skillRoot);
        await mkdir(workingDirectory);
        await writeTextFile(
          `${skillRoot}/run.js`,
          'process.stdout.write("validated-source-root");',
        );
        await writeTextFile(
          `${workingDirectory}/run.js`,
          'process.stdout.write("wrong-working-directory-script");',
        );

        const result = await new LocalScriptExecutor().execute({
          scriptPath: "run.js",
          cwd: workingDirectory,
          validatedSourceRoot: skillRoot,
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stderr, "");
        assertEquals(result.stdout, "validated-source-root");
      } finally {
        await remove(root, { recursive: true });
      }
    });

    it("resolves a relative source-root script when validated content and cwd are omitted", async () => {
      const skillRoot = await makeTempDir({ prefix: "vf-skill-relative-read-default-cwd-" });

      try {
        await writeTextFile(
          `${skillRoot}/run.js`,
          'process.stdout.write("validated-source-root-without-cwd");',
        );

        const result = await new LocalScriptExecutor().execute({
          scriptPath: "run.js",
          validatedSourceRoot: skillRoot,
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stderr, "");
        assertEquals(result.stdout, "validated-source-root-without-cwd");
      } finally {
        await remove(skillRoot, { recursive: true });
      }
    });

    it("rejects an uncontained script when validated content is omitted", async () => {
      const root = await makeTempDir({ prefix: "vf-skill-uncontained-read-" });
      const skillRoot = `${root}/skill`;
      const outsideScript = `${root}/outside.js`;

      try {
        await mkdir(skillRoot);
        await writeTextFile(outsideScript, 'process.stdout.write("outside");');

        await assertRejects(
          () =>
            new LocalScriptExecutor().execute({
              scriptPath: outsideScript,
              validatedSourceRoot: skillRoot,
            }),
          TypeError,
          "must remain inside its working directory",
        );
      } finally {
        await remove(root, { recursive: true });
      }
    });

    it("rejects a validated script whose source bytes changed before launch", async () => {
      const skillRoot = await makeTempDir({ prefix: "vf-skill-source-change-" });
      const scriptPath = `${skillRoot}/run.js`;

      try {
        await writeTextFile(scriptPath, 'process.stdout.write("current");');

        await assertRejects(
          () =>
            new LocalScriptExecutor().execute({
              scriptPath,
              scriptContent: 'process.stdout.write("validated");',
              validatedSourceRoot: skillRoot,
            }),
          Error,
          "content changed while preparing execution",
        );
      } finally {
        await remove(skillRoot, { recursive: true });
      }
    });

    it("rejects a validated script outside its declared source root", async () => {
      const root = await makeTempDir({ prefix: "vf-skill-source-containment-" });
      const skillRoot = `${root}/skill`;
      const scriptPath = `${root}/outside.js`;
      const scriptContent = 'process.stdout.write("outside");';

      try {
        await mkdir(skillRoot);
        await writeTextFile(scriptPath, scriptContent);

        await assertRejects(
          () =>
            new LocalScriptExecutor().execute({
              scriptPath,
              scriptContent,
              validatedSourceRoot: skillRoot,
            }),
          TypeError,
          "must remain inside its working directory",
        );
      } finally {
        await remove(root, { recursive: true });
      }
    });

    it("keeps generic content execution cwd independent from source containment", async () => {
      const root = await makeTempDir({ prefix: "vf-skill-generic-cwd-" });
      const sourceDirectory = `${root}/source`;
      const workingDirectory = `${root}/work`;
      const scriptPath = `${sourceDirectory}/run.js`;

      try {
        await mkdir(sourceDirectory);
        await mkdir(workingDirectory);
        await writeTextFile(scriptPath, "process.stdout.write(process.cwd());");
        const result = await new LocalScriptExecutor().execute({
          scriptPath,
          // LocalScriptExecutor historically executes scriptPath for generic
          // direct calls unless a validated source root is also supplied.
          scriptContent: 'process.stdout.write("must-not-run");',
          cwd: workingDirectory,
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stderr, "");
        assertEquals(await realPath(result.stdout), await realPath(workingDirectory));
      } finally {
        await remove(root, { recursive: true });
      }
    });

    it("does not leave a successful validated tool script's background descendants running", async () => {
      if (getOsType() === "windows") return;
      const markerDirectory = await makeTempDir({ prefix: "vf-skill-descendant-" });
      const markerPath = `${markerDirectory}/descendant-survived`;
      const scriptPath = `${markerDirectory}/background.sh`;
      const scriptContent = [
        "#!/usr/bin/env bash",
        '(sleep 0.4; printf survived > "$1") >/dev/null 2>&1 &',
        "exit 0",
      ].join("\n");

      try {
        await writeTextFile(scriptPath, scriptContent);
        const result = await new LocalScriptExecutor().execute({
          scriptPath,
          scriptContent,
          args: [markerPath],
          timeoutMs: 2_000,
          validatedSourceRoot: markerDirectory,
        });

        assertEquals(result.exitCode, 0);
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        assertEquals(await exists(markerPath), false);
      } finally {
        await remove(markerDirectory, { recursive: true });
      }
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

    it("preserves public timeout defaulting, flooring, and clamping behavior", async () => {
      const executor = new LocalScriptExecutor();
      for (const timeoutMs of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = await executor.execute({
          scriptPath: "echo",
          args: ["compat"],
          timeoutMs,
        });
        assertEquals(result.exitCode, 0);
        assertEquals(result.stdout.trim(), "compat");
      }
    });

    it("bounds captured output for validated tool scripts without changing the public direct cap", async () => {
      const directResult = await new LocalScriptExecutor().execute({
        scriptPath: "deno",
        args: ["eval", 'console.log("x".repeat(2 * 1024 * 1024));'],
        timeoutMs: 5_000,
      });
      assertEquals(directResult.exitCode, 0);
      assertEquals(directResult.stdout.length > 1_048_576, true);

      const root = await makeTempDir({ prefix: "vf-skill-output-limit-" });
      const scriptPath = `${root}/output.js`;
      const scriptContent = 'console.log("x".repeat(2 * 1024 * 1024));';
      try {
        await writeTextFile(scriptPath, scriptContent);
        const toolResult = await new LocalScriptExecutor().execute({
          scriptPath,
          scriptContent,
          timeoutMs: 5_000,
          validatedSourceRoot: root,
        });

        assertEquals(toolResult.exitCode, 125);
        assertEquals(toolResult.stdout.length <= 1_048_576, true);
        assertStringIncludes(toolResult.stderr, "exceeded");
      } finally {
        await remove(root, { recursive: true });
      }
    });

    it("terminates local scripts when the caller aborts", async () => {
      const controller = new AbortController();
      controller.abort();
      const executor = new LocalScriptExecutor();
      const result = await executor.execute(
        {
          scriptPath: "deno",
          args: ["eval", "await new Promise((resolve) => setTimeout(resolve, 10_000));"],
          timeoutMs: 100,
          abortSignal: controller.signal,
        },
      );

      assertEquals(result.exitCode, 130);
      assertStringIncludes(result.stderr, "aborted");
    });

    it("applies caller cancellation while validating a local script source", async () => {
      const originalLstat = Deno.lstat;
      Deno.lstat = () => new Promise<Deno.FileInfo>(() => {});
      const controller = new AbortController();
      try {
        const execution = new LocalScriptExecutor().execute({
          scriptPath: "/project/skills/writer/scripts/run.sh",
          validatedSourceRoot: "/project/skills/writer",
          timeoutMs: 5_000,
          abortSignal: controller.signal,
        });
        controller.abort(new Error("cancel local validation"));

        const result = await settleExecutorWithin(execution);
        assertEquals(result?.exitCode, 130);
      } finally {
        Deno.lstat = originalLstat;
      }
    });

    it("applies the script timeout while validating a local script source", async () => {
      const originalLstat = Deno.lstat;
      Deno.lstat = () => new Promise<Deno.FileInfo>(() => {});
      try {
        const result = await settleExecutorWithin(
          new LocalScriptExecutor().execute({
            scriptPath: "/project/skills/writer/scripts/run.sh",
            validatedSourceRoot: "/project/skills/writer",
            timeoutMs: 10,
          }),
        );
        assertEquals(result?.exitCode, 124);
      } finally {
        Deno.lstat = originalLstat;
      }
    });

    it("keeps ordinary public args and env shapes outside tool-schema caps compatible", async () => {
      const executor = new LocalScriptExecutor();
      const argsResult = await executor.execute({
        scriptPath: "echo",
        args: Array.from({ length: 17 }, () => "x".repeat(4_096)),
      });
      assertEquals(argsResult.exitCode, 0);

      const envResult = await executor.execute({
        scriptPath: "sh",
        args: ["-c", '[ "$KEY_64" = value ] && [ "${#LARGE_8}" -eq 8192 ]'],
        env: {
          ...Object.fromEntries(
            Array.from({ length: 65 }, (_unused, index) => [`KEY_${index}`, "value"]),
          ),
          ...Object.fromEntries(
            Array.from({ length: 9 }, (_unused, index) => [
              `LARGE_${index}`,
              "x".repeat(8_192),
            ]),
          ),
        },
      });
      assertEquals(envResult.exitCode, 0);
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

    it("rejects oversized validated tool content before provisioning a sandbox", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([]);

      const executor = getSkillScriptExecutor();
      await assertRejects(
        () =>
          executor.execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "é".repeat(600_000),
            validatedSourceRoot: "/validated/skill",
          }),
        RangeError,
        "bytes",
      );
      assertEquals(fetchCalls.length, 0);
    });

    it("reads and uploads a contained source-root script when cloud content is omitted", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const skillRoot = await makeTempDir({ prefix: "vf-skill-cloud-contained-" });
      const scriptContent = "printf cloud-contained";
      mockFetch([
        jsonResponse({
          id: "session-contained-read",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "cloud-contained" },
          { type: "exit", exitCode: 0 },
        ]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      try {
        await writeTextFile(`${skillRoot}/run.sh`, scriptContent);

        const result = await getSkillScriptExecutor().execute({
          scriptPath: "run.sh",
          validatedSourceRoot: skillRoot,
        });

        assertEquals(result, { stdout: "cloud-contained", stderr: "", exitCode: 0 });
        const filesBody = jsonBody(fetchCalls, 2) as {
          files: Array<{ path: string; content: string }>;
        };
        assertEquals(filesBody.files[0]?.content, scriptContent);
      } finally {
        await remove(skillRoot, { recursive: true });
      }
    });

    it("rejects an uncontained cloud script before reading or provisioning", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const root = await makeTempDir({ prefix: "vf-skill-cloud-uncontained-" });
      const skillRoot = `${root}/skill`;
      const outsideScript = `${root}/outside.sh`;
      mockFetch([]);

      try {
        await mkdir(skillRoot);
        await writeTextFile(outsideScript, "printf outside");

        await assertRejects(
          () =>
            getSkillScriptExecutor().execute({
              scriptPath: outsideScript,
              validatedSourceRoot: skillRoot,
            }),
          TypeError,
          "must remain inside its working directory",
        );
        assertEquals(fetchCalls.length, 0);
      } finally {
        await remove(root, { recursive: true });
      }
    });

    it("bounds sandbox provisioning with the script timeout", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([rejectWhenFetchIsAborted()]);

      const result = await getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "printf unreachable",
        timeoutMs: 100,
      });

      assertEquals(result.exitCode, 124);
      assertStringIncludes(result.stderr, "timed out");
      assertEquals(fetchCalls.length, 1);
      assertEquals(typeof fetchCalls[0]!.init?.signal?.aborted, "boolean");
    });

    it("bounds an aborted provisioning request by its transport deadline", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([rejectWhenFetchIsAborted()]);

      const controller = new AbortController();
      const execution = getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "printf unreachable",
        timeoutMs: 30,
        abortSignal: controller.signal,
      });
      await waitForFetchCallCount(1);
      controller.abort();

      const result = await execution;
      assertEquals(result.exitCode, 130);
      assertStringIncludes(result.stderr, "aborted");
      assertEquals(fetchCalls.length, 1);
    });

    it("aborts sandbox preparation and directly terminates the session", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const pendingPreparation = pendingErrorNdjsonResponse(
        new Error("sandbox preparation killed"),
      );
      mockFetch([
        jsonResponse({
          id: "session-preparation-abort",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        pendingPreparation.response,
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      const controller = new AbortController();
      const execution = getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "printf unreachable",
        timeoutMs: 10_000,
        abortSignal: controller.signal,
      });
      await waitForFetchCallCount(2);
      controller.abort();

      const result = await execution;
      pendingPreparation.reject();
      await Promise.resolve();

      assertEquals(result.exitCode, 130);
      assertStringIncludes(result.stderr, "aborted");
      assertEquals(fetchCalls.length, 4);
      assertStringIncludes(
        fetchCalls[2]!.init?.body?.toString() ?? "",
        "builtin kill -KILL -1",
      );
    });

    it("times out sandbox preparation and directly terminates the session", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const pendingPreparation = pendingErrorNdjsonResponse(
        new Error("sandbox preparation timed out"),
      );
      mockFetch([
        jsonResponse({
          id: "session-preparation-timeout",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        pendingPreparation.response,
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      const result = await getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "printf unreachable",
        timeoutMs: 25,
      });
      pendingPreparation.reject();
      await Promise.resolve();

      assertEquals(result.exitCode, 124);
      assertStringIncludes(result.stderr, "timed out");
      assertEquals(fetchCalls.length, 4);
      assertStringIncludes(
        fetchCalls[2]!.init?.body?.toString() ?? "",
        "builtin kill -KILL -1",
      );
    });

    it("maps cloud output limits to the local exit-code contract", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-output-limit",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "x".repeat(600_000) },
          { type: "stderr", data: "y".repeat(600_000) },
          { type: "exit", exitCode: 0 },
        ]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      const result = await getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "printf output",
        validatedSourceRoot: "/validated/skill",
      });

      assertEquals(result.exitCode, 125);
      assertStringIncludes(result.stderr, "exceeded");
      assertEquals(fetchCalls.length, 7);
      const terminationBody = fetchCalls[5]!.init?.body?.toString() ?? "";
      assertStringIncludes(terminationBody, "builtin kill -KILL -1");
      assertEquals(terminationBody.includes("|| true"), false);
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
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
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
        timeoutMs: 25,
      });

      pendingCommand.reject();
      await Promise.resolve();

      assertEquals(result.exitCode, 124);
      assertStringIncludes(result.stderr, "timed out");
      assertEquals(fetchCalls.length, 7);
      assertStringIncludes(
        fetchCalls[5]!.init?.body?.toString() ?? "",
        "builtin kill -KILL -1",
      );
    });

    it("passes validated tool environment and cwd as structured sandbox options", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-structured-options",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      const result = await getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "printf ok",
        cwd: "/local/skill/root",
        env: { SECRET_TOKEN: "do-not-put-in-command" },
        validatedSourceRoot: "/validated/skill",
      });

      assertEquals(result, { stdout: "ok\n", stderr: "", exitCode: 0 });
      assertEquals(fetchCalls.length, 7);

      const commandBody = jsonBody(fetchCalls, 4) as {
        command: string;
        cwd: string;
        env: Record<string, string>;
        timeout_seconds: number;
      };
      assertEquals(commandBody.env, { SECRET_TOKEN: "do-not-put-in-command" });
      assertEquals(commandBody.command.includes("do-not-put-in-command"), false);
      assertEquals(commandBody.cwd.startsWith("/tmp/veryfront-skill-script-"), true);
      assertEquals(commandBody.cwd === "/local/skill/root", false);
      assertStringIncludes(commandBody.command, `${commandBody.cwd}/script.sh`);
      assertEquals(commandBody.timeout_seconds, 60);
      assertStringIncludes(
        fetchCalls[5]!.init?.body?.toString() ?? "",
        "builtin kill -KILL -1",
      );

      const filesBody = jsonBody(fetchCalls, 2) as {
        files: Array<{ path: string; content: string }>;
      };
      assertEquals(filesBody.files, [{
        path: `${commandBody.cwd}/script.sh`,
        content: "printf ok",
      }]);
    });

    it("preserves successful public cloud calls without the tool-only terminate-all step", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-public-success",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "public-ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        textResponse(""),
      ]);

      const result = await getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "printf public-ok",
      });

      assertEquals(result, { stdout: "public-ok\n", stderr: "", exitCode: 0 });
      assertEquals(fetchCalls.length, 6);
      assertEquals(
        fetchCalls.some((call) => call.init?.body?.toString().includes("builtin kill -KILL -1")),
        false,
      );
    });

    it("directly terminates after a non-zero cloud command settlement", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-non-zero",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stderr", data: "script failed\n" },
          { type: "exit", exitCode: 7 },
        ]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
      ]);

      const result = await getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.sh",
        scriptContent: "exit 7",
      });

      assertEquals(result, { stdout: "", stderr: "script failed\n", exitCode: 7 });
      assertEquals(fetchCalls.length, 7);
      assertStringIncludes(
        fetchCalls[5]!.init?.body?.toString() ?? "",
        "builtin kill -KILL -1",
      );
    });

    it("actively terminates and closes a cloud command when the caller aborts", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      const pendingCommand = pendingErrorNdjsonResponse(new Error("sandbox process killed"));
      mockFetch([
        jsonResponse({
          id: "session-abort",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
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
      await waitForFetchCallCount(5);
      controller.abort();

      const result = await execution;
      pendingCommand.reject();
      await Promise.resolve();

      assertEquals(result.exitCode, 130);
      assertStringIncludes(result.stderr, "aborted");
      assertEquals(fetchCalls.length, 7);
      assertStringIncludes(
        fetchCalls[5]!.init?.body?.toString() ?? "",
        "builtin kill -KILL -1",
      );
    });

    it("surfaces a sandbox close failure after successful execution", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-close-failure",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse("close denied", 503),
      ]);

      await assertRejects(
        () =>
          getSkillScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "exit 0",
            validatedSourceRoot: "/validated/skill",
          }),
        Error,
        "Close sandbox failed",
      );
      assertEquals(fetchCalls.length, 7);
    });

    it("surfaces a direct-termination failure even when session close succeeds", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-termination-failure",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([{ type: "exit", exitCode: 7 }]),
        ndjsonResponse([
          { type: "stderr", data: "kill denied" },
          { type: "exit", exitCode: 1 },
        ]),
        textResponse(""),
      ]);

      await assertRejects(
        () =>
          getSkillScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "exit 7",
          }),
        Error,
        "kill denied",
      );
      assertEquals(fetchCalls.length, 7);
    });

    it("surfaces cleanup failure when termination and session close both fail", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-cleanup-failure",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "x".repeat(600_000) },
          { type: "stderr", data: "y".repeat(600_000) },
          { type: "exit", exitCode: 0 },
        ]),
        ndjsonResponse([
          { type: "stderr", data: "kill denied" },
          { type: "exit", exitCode: 1 },
        ]),
        textResponse("close denied", 503),
      ]);

      const error = await assertRejects(
        () =>
          getSkillScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "printf output",
            validatedSourceRoot: "/validated/skill",
          }),
        AggregateError,
        "Sandbox skill execution and lifecycle cleanup failed",
      );

      assertEquals(fetchCalls.length, 7);
      assertEquals((error as AggregateError).errors.length, 2);
      assertStringIncludes(
        ((error as AggregateError).errors[0] as Error).message,
        "kill denied",
      );
    });

    it("aggregates execution, direct termination, and close failures", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-all-failures",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        textResponse("command transport failed", 503),
        ndjsonResponse([
          { type: "stderr", data: "kill denied" },
          { type: "exit", exitCode: 1 },
        ]),
        textResponse("close denied", 503),
      ]);

      const error = await assertRejects(
        () =>
          getSkillScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "printf unreachable",
          }),
        AggregateError,
        "Sandbox skill execution and lifecycle cleanup failed",
      );

      assertEquals(fetchCalls.length, 7);
      const errors = (error as AggregateError).errors as Error[];
      assertEquals(errors.length, 3);
      assertStringIncludes(errors[0]!.message, "Exec failed");
      assertStringIncludes(errors[1]!.message, "kill denied");
      assertStringIncludes(errors[2]!.message, "Close sandbox failed");
    });

    it("falls back to local execution for an explicitly unauthenticated request", async () => {
      // Mask both ambient credential sources so this assertion remains valid
      // when the repository suite initializes a process-wide cloud bootstrap.
      setEnv("SANDBOX_AUTH_TOKEN", "");
      const executor = await runWithRequestContext(
        {
          projectSlug: "skill-test",
          token: "",
        },
        async () => getSkillScriptExecutor(),
      );
      assertEquals(executor instanceof LocalScriptExecutor, true);
    });
  });
});
