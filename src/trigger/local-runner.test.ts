import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertLess,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createMockAdapter } from "#veryfront/platform";
import { runTriggerTarget } from "./local-runner.ts";

async function writePingWorkflow(adapter: ReturnType<typeof createMockAdapter>): Promise<void> {
  await adapter.fs.mkdir("/project/workflows", { recursive: true });
  await adapter.fs.writeFile(
    "/project/workflows/ping.ts",
    [
      'import { defineSchema } from "veryfront/schemas";',
      'import { tool } from "veryfront/tool";',
      'import { step, workflow } from "veryfront/workflow";',
      "const ping = tool({",
      '  id: "ping-tool",',
      '  description: "Return a stable result.",',
      "  inputSchema: defineSchema((v) => v.object({}).passthrough())(),",
      '  execute: async () => ({ value: "pong" }),',
      "});",
      "export default workflow({",
      '  id: "ping",',
      '  steps: [step("respond", { tool: ping })],',
      "});",
    ].join("\n"),
  );
}

async function writeEchoWorkflow(adapter: ReturnType<typeof createMockAdapter>): Promise<void> {
  await adapter.fs.mkdir("/project/workflows", { recursive: true });
  await adapter.fs.writeFile(
    "/project/workflows/echo.ts",
    [
      'import { defineSchema } from "veryfront/schemas";',
      'import { tool } from "veryfront/tool";',
      'import { step, workflow } from "veryfront/workflow";',
      "const echo = tool({",
      '  id: "echo-tool",',
      '  description: "Return the workflow input.",',
      "  inputSchema: defineSchema((v) => v.any())(),",
      "  execute: async (input) => input,",
      "});",
      "export default workflow({",
      '  id: "echo",',
      '  steps: [step("respond", { tool: echo })],',
      "});",
    ].join("\n"),
  );
}

describe(
  "local trigger runner",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it("snapshots task input before asynchronous discovery", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/tasks", { recursive: true });
      await adapter.fs.writeFile(
        "/project/tasks/echo.ts",
        [
          "export default {",
          '  name: "Echo",',
          "  run({ config }) { return config; },",
          "};",
        ].join("\n"),
      );
      const nested = { value: "original" };

      const pending = runTriggerTarget({
        projectDir: "/project",
        adapter,
        target: { kind: "task", id: "echo" },
        input: { nested },
      });
      nested.value = "changed";

      const result = await pending;
      assertEquals(result.output, { nested: { value: "original" } });
    });

    it("rejects malformed targets without invoking accessors", async () => {
      const adapter = createMockAdapter();
      let reads = 0;
      const target = { id: "echo" };
      Object.defineProperty(target, "kind", {
        enumerable: true,
        get() {
          reads += 1;
          return "task";
        },
      });

      const error = await assertRejects(
        () =>
          runTriggerTarget({
            projectDir: "/project",
            adapter,
            target: target as never,
          }),
        VeryfrontError,
      );
      assertEquals(error.slug, "trigger-config-invalid");
      assertEquals(reads, 0);
    });

    it("rejects cyclic input before target discovery", async () => {
      const adapter = createMockAdapter();
      const input: Record<string, unknown> = {};
      input.self = input;

      const error = await assertRejects(
        () =>
          runTriggerTarget({
            projectDir: "/project",
            adapter,
            target: { kind: "task", id: "echo" },
            input,
          }),
        VeryfrontError,
      );
      assertEquals(error.slug, "trigger-config-invalid");
      assertStringIncludes(error.message, "JSON-serializable");
    });

    it("does not expose raw task failure messages", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/tasks", { recursive: true });
      await adapter.fs.writeFile(
        "/project/tasks/fail.ts",
        [
          "export default {",
          '  name: "Fail",',
          '  run() { throw new Error("sensitive-canary"); },',
          "};",
        ].join("\n"),
      );

      const error = await assertRejects(
        () =>
          runTriggerTarget({
            projectDir: "/project",
            adapter,
            target: { kind: "task", id: "fail" },
          }),
        VeryfrontError,
      );
      assertEquals(error.slug, "trigger-execution-failed");
      assertEquals(error.detail, 'Task target "fail" failed.');
    });

    it("wraps scalar task input in a payload field", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/tasks", { recursive: true });
      await adapter.fs.writeFile(
        "/project/tasks/echo.ts",
        [
          "export default {",
          '  name: "Echo",',
          "  run({ config }) { return config; },",
          "};",
        ].join("\n"),
      );

      const result = await runTriggerTarget({
        projectDir: "/project",
        adapter,
        target: { kind: "task", id: "echo" },
        input: "hello",
      });

      assertEquals(result.output, { payload: "hello" });
    });

    it("reports missing targets with stable typed errors", async () => {
      const adapter = createMockAdapter();

      for (
        const target of [
          { kind: "task", id: "missing-task" },
          { kind: "workflow", id: "missing-workflow" },
        ] as const
      ) {
        const error = await assertRejects(
          () =>
            runTriggerTarget({
              projectDir: "/project",
              adapter,
              target,
            }),
          VeryfrontError,
        );
        assertEquals(error.slug, "trigger-target-not-found");
        assertStringIncludes(error.detail ?? "", target.id);
      }
    });

    it("rejects local agent targets before runtime discovery", async () => {
      const adapter = createMockAdapter();

      const error = await assertRejects(
        () =>
          runTriggerTarget({
            projectDir: "/does-not-exist",
            adapter,
            target: { kind: "agent", id: "assistant" },
          }),
        VeryfrontError,
      );

      assertEquals(error.slug, "trigger-not-supported");
    });

    it("rejects malformed run options before runtime discovery", async () => {
      const adapter = createMockAdapter();
      let filesystemReads = 0;
      adapter.fs.exists = () => {
        filesystemReads += 1;
        return Promise.resolve(false);
      };

      for (
        const options of [
          { projectDir: "", adapter, target: { kind: "task", id: "echo" } },
          { projectDir: "/project", adapter: null, target: { kind: "task", id: "echo" } },
          {
            projectDir: "/project",
            adapter,
            target: { kind: "task", id: "echo" },
            debug: "yes",
          },
          {
            projectDir: "/project",
            adapter,
            target: { kind: "task", id: "echo" },
            cacheKey: "",
          },
        ]
      ) {
        const error = await assertRejects(
          () => runTriggerTarget(options as never),
          VeryfrontError,
        );
        assertEquals(error.slug, "trigger-config-invalid");
      }
      assertEquals(filesystemReads, 0);
    });

    it("runs a discovered workflow with project-scoped tools", async () => {
      const adapter = createMockAdapter();
      await writePingWorkflow(adapter);

      const result = await runTriggerTarget({
        projectDir: "/project",
        adapter,
        target: { kind: "workflow", id: "ping" },
        input: { message: "hello" },
      });

      assertEquals(result.kind, "workflow");
      assertEquals(result.id, "ping");
      assertEquals(result.output, { respond: { value: "pong" } });
      assertEquals(Number.isFinite(result.durationMs), true);
      assertEquals(result.durationMs >= 0, true);
    });

    it("preserves explicit null workflow input without result polling delay", async () => {
      const adapter = createMockAdapter();
      await writeEchoWorkflow(adapter);

      const result = await runTriggerTarget({
        projectDir: "/project",
        adapter,
        target: { kind: "workflow", id: "echo" },
        input: null,
      });

      assertEquals(result.output, { respond: null });
      assertLess(
        result.durationMs,
        900,
        "in-process workflow completion must not wait for the one-second result polling interval",
      );
    });

    it("reports workflow execution duration without discovery time", async () => {
      const adapter = createMockAdapter();
      await writePingWorkflow(adapter);
      const exists = adapter.fs.exists;
      let delayed = false;
      adapter.fs.exists = async (path) => {
        if (!delayed) {
          delayed = true;
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return await exists.call(adapter.fs, path);
      };

      const startedAt = performance.now();
      const result = await runTriggerTarget({
        projectDir: "/project",
        adapter,
        target: { kind: "workflow", id: "ping" },
      });
      const elapsedMs = performance.now() - startedAt;

      assertEquals(elapsedMs - result.durationMs >= 60, true);
    });

    it("contains workflow failures behind a stable trigger error", async () => {
      const adapter = createMockAdapter();
      await adapter.fs.mkdir("/project/workflows", { recursive: true });
      await adapter.fs.writeFile(
        "/project/workflows/broken.ts",
        [
          'import { workflow } from "veryfront/workflow";',
          'export default workflow({ id: "broken", steps: [] });',
        ].join("\n"),
      );

      const error = await assertRejects(
        () =>
          runTriggerTarget({
            projectDir: "/project",
            adapter,
            target: { kind: "workflow", id: "broken" },
          }),
        VeryfrontError,
      );

      assertEquals(error.slug, "trigger-execution-failed");
      assertEquals(error.detail, 'Workflow target "broken" failed.');
    });
  },
);
