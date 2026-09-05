import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import {
  type FetchCall,
  installMockFetch as createSandboxFetchMock,
  jsonResponse,
  type MockResponseEntry,
  ndjsonResponse,
  textResponse,
} from "../sandbox/sandbox.test-helpers.ts";
import {
  installMockFetch as installHostMockFetch,
  restoreMockFetch as restoreHostMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { detectRuntime, getSkillScriptExecutor, LocalScriptExecutor } from "./executor.ts";

const SKILL_ENV_KEYS = [
  "SANDBOX_AUTH_TOKEN",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
] as const;

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
  installHostMockFetch(createSandboxFetchMock({ calls: fetchCalls, responses: fetchResponses }));
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
    restoreHostMockFetch();
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
      if (isDeno) {
        assertEquals(result.command, "deno", "TypeScript runs under deno");
        assertEquals(
          result.args,
          ["run", "--allow-read", "--allow-env", "--allow-net", "--allow-write", "scripts/run.ts"],
          "deno runs the script with the bounded permission set",
        );
        return;
      }
      assertEquals(result.command, "npx", "TypeScript runs under npx outside Deno");
      assertEquals(result.args, ["tsx", "scripts/run.ts"], "npx runs the script through tsx");
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

    it("executes supplied adapter content instead of the host script path", async () => {
      const hostRoot = await Deno.makeTempDir({ prefix: "vf-skill-host-script-" });
      const hostScriptPath = `${hostRoot}/run.sh`;
      try {
        await Deno.writeTextFile(hostScriptPath, "echo host-content");

        const result = await new LocalScriptExecutor().execute({
          scriptPath: hostScriptPath,
          scriptContent: "echo adapter-content",
        });

        assertEquals(result.exitCode, 0);
        assertEquals(result.stderr, "");
        assertEquals(result.stdout.trim(), "adapter-content");
      } finally {
        await Deno.remove(hostRoot, { recursive: true });
      }
    });

    it("executes supplied adapter content when its path is not on the host", async () => {
      const result = await new LocalScriptExecutor().execute({
        scriptPath: "skills/adapter-only/scripts/run.sh",
        scriptContent: 'printf "adapter-only:%s" "$PWD"',
      });

      assertEquals(result.exitCode, 0);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.startsWith("adapter-only:"), true);
      assertEquals(result.stdout.includes("veryfront-skill-script-"), true);
    });

    it("preserves the TypeScript media type for materialized adapter content", async () => {
      const result = await new LocalScriptExecutor().execute({
        scriptPath: "skills/adapter-only/scripts/run.ts",
        scriptContent: 'const value: string = "adapter-typescript";\nconsole.log(value);',
      });

      assertEquals(result.exitCode, 0);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.trim(), "adapter-typescript");
    });

    it("materializes sibling modules from the validated script snapshot", async () => {
      const result = await new LocalScriptExecutor().execute({
        scriptPath: "skills/adapter-only/scripts/run.ts",
        scriptContent: 'import { message } from "./helper.ts";\nconsole.log(message);',
        scriptSnapshot: {
          entryPath: "scripts/jobs/run.ts",
          files: [
            {
              path: "scripts/jobs/helper.ts",
              content: 'export const message = "snapshot-import";',
            },
            {
              path: "scripts/jobs/run.ts",
              content: 'import { message } from "./helper.ts";\nconsole.log(message);',
            },
          ],
        },
      });

      assertEquals(result.exitCode, 0);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.trim(), "snapshot-import");
    });

    it("rejects duplicate and non-canonical script snapshot paths", async () => {
      await assertRejects(
        () =>
          new LocalScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "echo run",
            scriptSnapshot: {
              entryPath: "scripts/run.sh",
              files: [
                { path: "scripts/run.sh", content: "echo run" },
                { path: "scripts/run.sh", content: "echo duplicate" },
              ],
            },
          }),
        TypeError,
        "duplicate path",
      );
      await assertRejects(
        () =>
          new LocalScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "echo run",
            scriptSnapshot: {
              entryPath: "scripts/run.sh",
              files: [{ path: "scripts/../run.sh", content: "echo run" }],
            },
          }),
        TypeError,
        "canonical scripts/ paths",
      );
    });

    it("rejects a script snapshot entry that does not match scriptContent", async () => {
      await assertRejects(
        () =>
          new LocalScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "echo validated",
            scriptSnapshot: {
              entryPath: "scripts/run.sh",
              files: [{ path: "scripts/run.sh", content: "echo tampered" }],
            },
          }),
        TypeError,
        "does not match scriptContent",
      );
    });

    it("rejects accessor-backed script snapshots without invoking them", async () => {
      let getterCalls = 0;
      await assertRejects(
        () =>
          new LocalScriptExecutor().execute({
            scriptPath: "scripts/run.sh",
            scriptContent: "echo run",
            scriptSnapshot: {
              entryPath: "scripts/run.sh",
              get files() {
                getterCalls += 1;
                return [{ path: "scripts/run.sh", content: "echo run" }];
              },
            },
          }),
        TypeError,
        "files must be an own data property",
      );
      assertEquals(getterCalls, 0);
    });

    it("rejects a native script changed after framework validation", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-skill-executor-" });
      const scriptPath = `${root}/run.sh`;
      try {
        await Deno.writeTextFile(scriptPath, "echo changed");

        await assertRejects(
          () =>
            new LocalScriptExecutor().execute({
              scriptPath,
              scriptContent: "echo validated",
              validatedSourceRoot: root,
            }),
          TypeError,
          "changed after validation",
        );
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("rejects a native script outside the validated source root", async () => {
      const root = await Deno.makeTempDir({ prefix: "vf-skill-root-" });
      const outside = await Deno.makeTempFile({ prefix: "vf-skill-outside-", suffix: ".sh" });
      try {
        await Deno.writeTextFile(outside, "echo outside");

        await assertRejects(
          () =>
            new LocalScriptExecutor().execute({
              scriptPath: outside,
              scriptContent: "echo outside",
              validatedSourceRoot: root,
            }),
          Error,
        );
      } finally {
        await Deno.remove(root, { recursive: true });
        await Deno.remove(outside);
      }
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

    it("rejects changed native content before creating a cloud sandbox", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      const root = await Deno.makeTempDir({ prefix: "vf-cloud-skill-executor-" });
      const scriptPath = `${root}/run.sh`;
      try {
        await Deno.writeTextFile(scriptPath, "echo changed");

        await assertRejects(
          () =>
            getSkillScriptExecutor().execute({
              scriptPath,
              scriptContent: "echo validated",
              validatedSourceRoot: root,
            }),
          TypeError,
          "changed after validation",
        );
        assertEquals(fetchCalls.length, 0);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("uploads a bounded script tree and executes from its private root", async () => {
      setEnv("SANDBOX_AUTH_TOKEN", "sandbox-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-snapshot",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        textResponse(""),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
        ndjsonResponse([
          { type: "stdout", data: "cloud-snapshot\n" },
          { type: "exit", exitCode: 0 },
        ]),
        textResponse(""),
      ]);

      const result = await getSkillScriptExecutor().execute({
        scriptPath: "scripts/run.ts",
        scriptContent: 'import "./helper.ts";',
        scriptSnapshot: {
          entryPath: "scripts/jobs/run.ts",
          files: [
            { path: "scripts/jobs/helper.ts", content: "export {};" },
            { path: "scripts/jobs/run.ts", content: 'import "./helper.ts";' },
          ],
        },
      });

      assertEquals(result, { stdout: "cloud-snapshot\n", stderr: "", exitCode: 0 });
      const body = JSON.parse(fetchCalls[1]!.init?.body?.toString() ?? "{}") as {
        files: Array<{ path: string; content: string }>;
      };
      assertEquals(body.files.length, 2);
      assertEquals(body.files[0]!.path.endsWith("/scripts/jobs/helper.ts"), true);
      assertEquals(body.files[1]!.path.endsWith("/scripts/jobs/run.ts"), true);
      assertStringIncludes(fetchCalls[3]!.init?.body?.toString() ?? "", "cd '/tmp/");
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
