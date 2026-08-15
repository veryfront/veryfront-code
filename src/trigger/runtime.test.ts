import "#veryfront/schemas/_test-setup.ts";
import { clearConfigCache } from "#veryfront/config";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { discoverSourceTriggers as discoverSourceTriggersRaw } from "./discovery.ts";
import { runTriggerTarget } from "./local-runner.ts";

interface FixtureTrigger {
  id: string;
  marker: string;
}

const discoverSourceTriggers: typeof discoverSourceTriggersRaw = (options) =>
  discoverSourceTriggersRaw({
    ...options,
    allowHostProjectCodeExecution: true,
  });

function normalizePath(path: string): string {
  return path.replace(/^\/project\/?/, "").replace(/^\/+/, "");
}

function createMockAdapter(
  files: Record<string, string>,
  onExists?: () => void,
): FileSystemAdapter {
  const normalizedFiles = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [normalizePath(path), content]),
  );

  return {
    async readFile(path: string): Promise<string> {
      const content = normalizedFiles[normalizePath(path)];
      if (content === undefined) {
        throw new Deno.errors.NotFound(`File not found: ${path}`);
      }
      return content;
    },
    async exists(path: string): Promise<boolean> {
      onExists?.();
      const normalizedPath = normalizePath(path);
      return normalizedPath in normalizedFiles ||
        Object.keys(normalizedFiles).some((key) => key.startsWith(`${normalizedPath}/`));
    },
    async *readDir(path: string) {
      const normalizedPath = normalizePath(path);
      const prefix = normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;
      const seen = new Set<string>();

      for (const key of Object.keys(normalizedFiles)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest) continue;

        const name = rest.split("/")[0]!;
        if (seen.has(name)) continue;
        seen.add(name);
        const isFile = !rest.includes("/");
        yield { name, isFile, isDirectory: !isFile, isSymlink: false };
      }
    },
    async stat(path: string) {
      const normalizedPath = normalizePath(path);
      const isFile = normalizedPath in normalizedFiles;
      return {
        size: isFile ? normalizedFiles[normalizedPath]!.length : 0,
        isFile,
        isDirectory: !isFile,
        isSymlink: false,
        mtime: new Date(),
      };
    },
    async writeFile() {},
    async mkdir() {},
    async remove() {},
    async makeTempDir() {
      return "/tmp/trigger-test";
    },
    watch() {
      return null as never;
    },
  } satisfies FileSystemAdapter;
}

function createRuntimeAdapter(
  files: Record<string, string>,
  onExists?: () => void,
): RuntimeAdapter {
  return {
    id: "memory",
    name: "Trigger test memory adapter",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: false,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    fs: createMockAdapter(files, onExists),
    env: {
      get: () => undefined,
      set: () => {},
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    async serve() {
      return {
        addr: { hostname: "127.0.0.1", port: 0 },
        async stop() {},
      };
    },
  };
}

function isFixtureTrigger(value: unknown): value is FixtureTrigger {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.marker === "string";
}

describe("trigger runtime", () => {
  afterEach(() => {
    clearTranspileCache();
    clearConfigCache();
    toolRegistry.clear();
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  it("discovers source triggers in deterministic id order", async () => {
    const adapter = createRuntimeAdapter({
      "/project/schedules/z-last.ts": 'export default { id: "z-last", marker: "last" };\n',
      "/project/schedules/a-first.ts": 'export default { id: "a-first", marker: "first" };\n',
    });

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isFixtureTrigger,
    });

    assertEquals(result.errors, []);
    assertEquals(result.items.map((item) => item.id), ["a-first", "z-last"]);
  });

  it("treats multiple source directories as one duplicate-safe namespace", async () => {
    const adapter = createRuntimeAdapter({
      "/project/hooks/first.ts": 'export default { id: "shared", marker: "first" };\n',
      "/project/hooks/unique.ts": 'export default { id: "alpha", marker: "unique" };\n',
      "/project/other-hooks/second.ts": 'export default { id: "shared", marker: "second" };\n',
      "/project/other-hooks/last.ts": 'export default { id: "zeta", marker: "last" };\n',
    });

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      triggerDirs: ["hooks", "other-hooks", "hooks"],
      sourceKind: "webhook",
      validate: isFixtureTrigger,
    });

    assertEquals(result.items.map((item) => item.id), ["alpha", "zeta"]);
    assertEquals(
      result.errors.map((error) => ({
        path: error.sourcePath,
        code: error.code,
        sourceId: error.sourceId,
        paths: error.details?.sourcePaths,
      })),
      [
        {
          path: "hooks/first.ts",
          code: "duplicate_source_id",
          sourceId: "shared",
          paths: ["hooks/first.ts", "other-hooks/second.ts"],
        },
        {
          path: "other-hooks/second.ts",
          code: "duplicate_source_id",
          sourceId: "shared",
          paths: ["hooks/first.ts", "other-hooks/second.ts"],
        },
      ],
    );
  });

  it("loads files beneath overlapping source directories only once", async () => {
    const adapter = createRuntimeAdapter({
      "/project/hooks/root.ts": 'export default { id: "root", marker: "root" };\n',
      "/project/hooks/nested/child.ts": 'export default { id: "child", marker: "child" };\n',
    });

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      triggerDirs: ["hooks", "hooks/nested"],
      sourceKind: "webhook",
      validate: isFixtureTrigger,
    });

    assertEquals(result.items.map((item) => item.id), ["child", "root"]);
    assertEquals(result.errors, []);
  });

  it("rejects distinct definitions in one file but accepts aliases", async () => {
    const adapter = createRuntimeAdapter({
      "/project/schedules/aliased.ts": [
        'const definition = { id: "aliased", marker: "shared" };',
        "export { definition as named };",
        "export default definition;",
        "",
      ].join("\n"),
      "/project/schedules/ambiguous.ts": [
        'export const first = { id: "first", marker: "one" };',
        'export const second = { id: "second", marker: "two" };',
        "",
      ].join("\n"),
    });

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isFixtureTrigger,
    });

    assertEquals(result.items, [{ id: "aliased", marker: "shared" }]);
    assertEquals(result.errors, [{
      kind: "source_trigger_discovery_error",
      sourceKind: "schedule",
      sourcePath: "schedules/ambiguous.ts",
      code: "invalid_definition",
      message:
        "File exports multiple distinct schedule definitions: first, second. Export exactly one definition.",
      details: { exportNames: ["first", "second"] },
    }]);
  });

  it("rejects unsafe discovery directories before adapter access", async () => {
    let existsCalls = 0;
    const adapter = createRuntimeAdapter({}, () => existsCalls++);

    for (
      const triggerDir of [
        "",
        ".",
        "../schedules",
        "schedules/../webhooks",
        "schedules//nested",
        "/absolute/schedules",
        String.raw`C:\absolute\schedules`,
        "file:///absolute/schedules",
      ]
    ) {
      await assertRejects(
        () =>
          discoverSourceTriggers({
            projectDir: "/project",
            adapter,
            config: { fs: { type: "veryfront-api" } },
            triggerDir,
            sourceKind: "schedule",
            validate: isFixtureTrigger,
          }),
        Error,
        "Trigger source directory",
      );
    }
    assertEquals(existsCalls, 0);
  });

  it("rejects ambiguous and non-data directory collections before adapter access", async () => {
    let existsCalls = 0;
    const adapter = createRuntimeAdapter({}, () => existsCalls++);
    const sparseDirectories = Array(1);
    const customDirectories = ["webhooks"];
    Object.defineProperty(customDirectories, "extra", {
      enumerable: true,
      value: "other",
    });

    for (const triggerDirs of [sparseDirectories, customDirectories]) {
      await assertRejects(
        () =>
          discoverSourceTriggers({
            projectDir: "/project",
            adapter,
            config: { fs: { type: "veryfront-api" } },
            triggerDirs,
            sourceKind: "webhook",
            validate: isFixtureTrigger,
          }),
        Error,
        "Trigger source directories",
      );
    }
    await assertRejects(
      () =>
        discoverSourceTriggers({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          triggerDir: "webhooks",
          triggerDirs: ["other-webhooks"],
          sourceKind: "webhook",
          validate: isFixtureTrigger,
        } as never),
      Error,
      "either triggerDir or triggerDirs",
    );
    assertEquals(existsCalls, 0);
  });

  it("rejects every source involved in an ambiguous trigger id", async () => {
    const adapter = createRuntimeAdapter({
      "/project/schedules/sync.ts": 'export default { id: "sync", marker: "typescript" };\n',
      "/project/schedules/sync.js": 'export default { id: "sync", marker: "javascript" };\n',
    });

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isFixtureTrigger,
    });

    assertEquals(result.items, []);
    assertEquals(
      result.errors.map((error) => ({
        path: error.sourcePath,
        code: error.code,
        details: error.details,
      })),
      [
        {
          path: "schedules/sync.js",
          code: "duplicate_source_id",
          details: {
            sourcePaths: ["schedules/sync.js", "schedules/sync.ts"],
          },
        },
        {
          path: "schedules/sync.ts",
          code: "duplicate_source_id",
          details: {
            sourcePaths: ["schedules/sync.js", "schedules/sync.ts"],
          },
        },
      ],
    );
  });

  it("continues after invalid exports and module load failures", async () => {
    const adapter = createRuntimeAdapter({
      "/project/schedules/a-broken.ts":
        'import "./missing.ts"; export default { id: "broken", marker: "broken" };\n',
      "/project/schedules/b-invalid.ts": "export default 42;\n",
      "/project/schedules/z-valid.ts": 'export default { id: "valid", marker: "valid" };\n',
    });

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      triggerDir: "schedules",
      sourceKind: "schedule",
      validate: isFixtureTrigger,
    });

    assertEquals(result.items, [{ id: "valid", marker: "valid" }]);
    assertEquals(
      result.errors.map((error) => [error.sourcePath, error.code]),
      [
        ["schedules/a-broken.ts", "parse_error"],
        ["schedules/b-invalid.ts", "invalid_definition"],
      ],
    );
  });

  it("bounds and redacts module failure diagnostics", async () => {
    const adapter = createRuntimeAdapter({
      "/project/webhooks/failing.ts":
        'throw new Error("failed https://user:secret@example.com/private");\n',
    });

    const result = await discoverSourceTriggers({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      triggerDir: "webhooks",
      sourceKind: "webhook",
      validate: isFixtureTrigger,
    });

    assertEquals(result.items, []);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.code, "parse_error");
    assertEquals(result.errors[0]?.message.includes("secret"), false);
    assertEquals(result.errors[0]?.message.includes("[REDACTED]"), true);
  });

  it("rejects invalid and pre-aborted runs before project discovery", async () => {
    let existsCalls = 0;
    const adapter = createRuntimeAdapter({}, () => existsCalls++);

    await assertRejects(
      () =>
        runTriggerTarget({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          target: { kind: "queue", id: "invalid" } as never,
        }),
      Error,
      "Trigger target must specify a canonical task, workflow, or agent id.",
    );
    await assertRejects(
      () =>
        runTriggerTarget({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          target: { kind: "agent", id: "triage", conversationmode: "create_new" } as never,
        }),
      Error,
      "Trigger target.conversationmode is not supported.",
    );
    await assertRejects(
      () =>
        runTriggerTarget({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          target: {
            kind: "agent",
            id: "triage",
            conversationMode: "existing",
            conversationId: "11111111-1111-4111-8111-111111111111",
          },
        }),
      Error,
      "Local agent trigger runs cannot attach to an existing cloud conversation.",
    );
    assertEquals(existsCalls, 0);

    const controller = new AbortController();
    controller.abort(new Error("trigger cancelled before discovery"));
    await assertRejects(
      () =>
        runTriggerTarget({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          target: { kind: "task", id: "cancelled" },
          signal: controller.signal,
        }),
      Error,
      "trigger cancelled before discovery",
    );
    assertEquals(existsCalls, 0);
  });

  it("executes from an input snapshot captured before discovery yields", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/echo-input.ts": [
        "export default {",
        '  name: "Echo input",',
        "  run({ config }) { return config; },",
        "};",
        "",
      ].join("\n"),
    });
    const input = { nested: { value: "captured" } };

    const run = runTriggerTarget({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      target: { kind: "task", id: "echo-input" },
      input,
    });
    input.nested.value = "mutated";

    const result = await run;
    assertEquals(result.output, { nested: { value: "captured" } });
  });

  it("propagates cooperative cancellation into agent generation", async () => {
    const adapter = createRuntimeAdapter({
      "/project/agents/signal-aware.ts": [
        "export default {",
        '  id: "signal-aware",',
        '  config: { id: "signal-aware", model: "auto" },',
        "  async generate({ abortSignal }) {",
        "    return {",
        '      text: abortSignal ? "signal-present" : "signal-missing",',
        '      status: "completed",',
        "      toolCalls: [],",
        "    };",
        "  },",
        '  async stream() { throw new Error("not used"); },',
        '  async respond() { throw new Error("not used"); },',
        '  getMemory() { throw new Error("not used"); },',
        '  async getMemoryStats() { return { totalMessages: 0, estimatedTokens: 0, type: "test" }; },',
        "  async clearMemory() {},",
        "};",
        "",
      ].join("\n"),
    });
    const controller = new AbortController();

    const result = await runTriggerTarget({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      target: { kind: "agent", id: "signal-aware" },
      agentInput: "Check the signal.",
      signal: controller.signal,
    });

    assertEquals(result.output, {
      text: "signal-present",
      status: "completed",
      toolCalls: 0,
    });
    assertEquals(Number.isInteger(result.durationMs), true);
    assertEquals(result.durationMs >= 0, true);
  });

  it("rejects malformed non-terminal agent responses", async () => {
    const adapter = createRuntimeAdapter({
      "/project/agents/malformed.ts": [
        "export default {",
        '  id: "malformed",',
        '  config: { id: "malformed", model: "auto" },',
        "  async generate() {",
        '    return { text: "still running", status: "thinking", toolCalls: [] };',
        "  },",
        '  async stream() { throw new Error("not used"); },',
        '  async respond() { throw new Error("not used"); },',
        '  getMemory() { throw new Error("not used"); },',
        '  async getMemoryStats() { return { totalMessages: 0, estimatedTokens: 0, type: "test" }; },',
        "  async clearMemory() {},",
        "};",
        "",
      ].join("\n"),
    });

    await assertRejects(
      () =>
        runTriggerTarget({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          target: { kind: "agent", id: "malformed" },
          agentInput: "Run once.",
        }),
      Error,
      'Agent target "malformed" returned an invalid response.',
    );
  });

  it("cancels an active workflow when the trigger signal aborts", async () => {
    const adapter = createRuntimeAdapter({
      "/project/workflows/cancellable.ts": [
        'import { defineSchema } from "veryfront/schemas";',
        'import { tool } from "veryfront/tool";',
        'import { step, workflow } from "veryfront/workflow";',
        "",
        "const waitForCancellation = tool({",
        '  id: "wait_for_trigger_cancellation",',
        '  description: "Wait for trigger cancellation.",',
        "  inputSchema: defineSchema((v) => v.object({}).passthrough())(),",
        "  async execute(_input, context) {",
        "    const signal = context?.abortSignal;",
        '    if (!signal) throw new Error("workflow step did not receive a signal");',
        "    await new Promise((resolve, reject) => {",
        "      const timeout = setTimeout(",
        '        () => reject(new Error("trigger cancellation did not reach the workflow")),',
        "        500,",
        "      );",
        "      signal.addEventListener(",
        '        "abort",',
        "        () => { clearTimeout(timeout); resolve(undefined); },",
        "        { once: true },",
        "      );",
        "    });",
        "    signal.throwIfAborted();",
        "  },",
        "});",
        "",
        "export default workflow({",
        '  id: "cancellable",',
        '  steps: [step("wait", { tool: waitForCancellation })],',
        "});",
        "",
      ].join("\n"),
    });
    const controller = new AbortController();
    const run = runTriggerTarget({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      target: { kind: "workflow", id: "cancellable" },
      signal: controller.signal,
    });
    const abortTimer = setTimeout(
      () => controller.abort(new Error("workflow trigger cancelled")),
      100,
    );

    try {
      await assertRejects(
        () => run,
        Error,
        "workflow trigger cancelled",
      );
    } finally {
      clearTimeout(abortTimer);
    }
  });
});
