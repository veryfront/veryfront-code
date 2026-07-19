import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { clearConfigCache } from "#veryfront/config";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { deriveTaskId, discoverTasks, findTaskById } from "./discovery.ts";
import { discoverProjectTaskRuntime } from "./project-runtime.ts";
import { runTriggerTarget } from "../trigger/local-runner.ts";
import { isTaskDefinition } from "./types.ts";

function createMockAdapter(files: Record<string, string>): FileSystemAdapter {
  const normalize = (path: string): string => path.replace(/^\/project\/?/, "").replace(/^\/+/, "");
  const normalizedFiles = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [normalize(path), content]),
  );

  return {
    async readFile(path: string): Promise<string> {
      const content = normalizedFiles[normalize(path)];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    async exists(path: string): Promise<boolean> {
      const normalizedPath = normalize(path);
      return (
        normalizedPath in normalizedFiles ||
        Object.keys(normalizedFiles).some((key) => key.startsWith(`${normalizedPath}/`))
      );
    },
    async *readDir(path: string) {
      const normalizedPath = normalize(path);
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
      const normalizedPath = normalize(path);
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
      return "/tmp/mock";
    },
    watch() {
      return null as never;
    },
  } satisfies FileSystemAdapter;
}

function createRuntimeAdapter(files: Record<string, string>): RuntimeAdapter {
  return {
    id: "memory",
    name: "Memory",
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
    fs: createMockAdapter(files),
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

function makeTaskSource(name: string): string {
  return [
    "export default {",
    `  name: "${name}",`,
    "  run: () => ({ ok: true }),",
    "};",
    "",
  ].join("\n");
}

function markAdapterAsVirtual(adapter: RuntimeAdapter): void {
  Object.assign(adapter.fs, {
    getUnderlyingAdapter: () => adapter.fs,
    getAdapterType: () => "VeryfrontFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
  });
}

// Discovery uses the shared esbuild service under the hood, which outlives
// individual test cases until stopEsbuild() runs in afterAll.
describe("task/discovery", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterEach(() => {
    clearTranspileCache();
    clearConfigCache();
    toolRegistry.clear();
  });

  afterAll(async () => {
    await stopEsbuild();
  });

  describe("deriveTaskId", () => {
    it("strips the tasks directory prefix and extension", () => {
      assertEquals(deriveTaskId("tasks/sync-data.ts", "tasks"), "sync-data");
    });

    it("handles a trailing slash in the tasks directory", () => {
      assertEquals(deriveTaskId("tasks/sync-data.ts", "tasks/"), "sync-data");
    });

    it("handles nested file paths", () => {
      assertEquals(deriveTaskId("tasks/reports/daily.ts", "tasks"), "reports/daily");
    });

    it("handles alternate script extensions", () => {
      assertEquals(deriveTaskId("tasks/render.tsx", "tasks"), "render");
      assertEquals(deriveTaskId("tasks/legacy.js", "tasks"), "legacy");
      assertEquals(deriveTaskId("tasks/component.jsx", "tasks"), "component");
    });

    it("handles absolute project paths", () => {
      assertEquals(deriveTaskId("/project/tasks/cleanup.ts", "/project/tasks"), "cleanup");
    });

    it("returns the input path when the prefix does not match", () => {
      assertEquals(deriveTaskId("other/cleanup.ts", "tasks"), "other/cleanup");
    });
  });

  describe("isTaskDefinition", () => {
    it("accepts objects with a runnable export", () => {
      assertEquals(isTaskDefinition({ run: () => {} }), true);
      assertEquals(
        isTaskDefinition({
          name: "My Task",
          description: "Does things",
          run: async () => ({ ok: true }),
        }),
        true,
      );
    });

    it("rejects non-task values", () => {
      assertEquals(isTaskDefinition(null), false);
      assertEquals(isTaskDefinition(undefined), false);
      assertEquals(isTaskDefinition("not a task"), false);
      assertEquals(isTaskDefinition(42), false);
      assertEquals(isTaskDefinition({ name: "no run" }), false);
      assertEquals(isTaskDefinition({ run: "not a function" }), false);
    });
  });

  it("discovers default-exported tasks through the discovery module loader", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/ping.ts": [
        'import { label } from "./shared.ts";',
        "export default {",
        "  name: label,",
        "  schedulable: true,",
        "  run() {",
        "    return { ok: true };",
        "  },",
        "};",
      ].join("\n"),
      "/project/tasks/shared.ts": 'export const label = "Ping task";',
    });

    const result = await discoverTasks({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(result.errors, []);
    assertEquals(result.tasks.map((task) => task.id), ["ping"]);
    assertEquals(result.tasks[0]?.name, "Ping task");
  });

  it("prefers a default-exported task over named task exports in the same file", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/ping.ts": [
        "export const namedTask = {",
        '  name: "Named task",',
        "  run() {",
        "    return { ok: true };",
        "  },",
        "};",
        "",
        "export default {",
        '  name: "Default task",',
        "  run() {",
        "    return { ok: true };",
        "  },",
        "};",
      ].join("\n"),
    });

    const result = await discoverTasks({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(result.errors, []);
    assertEquals(result.tasks.map((task) => task.id), ["ping"]);
    assertEquals(result.tasks[0]?.name, "Default task");
    assertEquals(result.tasks[0]?.exportName, "default");
  });

  it("continues discovering other tasks after a module load failure", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/broken.ts": 'import "./missing.ts"; export default { run() {} };',
      "/project/tasks/ping.ts": [
        "export default {",
        '  name: "Ping task",',
        "  run() {",
        "    return { ok: true };",
        "  },",
        "};",
      ].join("\n"),
    });

    const result = await discoverTasks({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(result.tasks.map((task) => task.id), ["ping"]);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.filePath, "tasks/broken.ts");
  });

  it("finds a task by id through the discovery module loader", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/ping.ts": [
        "export const pingTask = {",
        '  name: "Ping task",',
        "  run() {",
        "    return { ok: true };",
        "  },",
        "};",
      ].join("\n"),
    });

    const task = await findTaskById("ping", {
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(task?.id, "ping");
    assertEquals(task?.name, "Ping task");
    assertEquals(task?.exportName, "pingTask");
  });

  it("finds a task by id even if another task file fails to load", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/broken.ts": 'import "./missing.ts"; export default { run() {} };',
      "/project/tasks/ping.ts": [
        "export const pingTask = {",
        '  name: "Ping task",',
        "  run() {",
        "    return { ok: true };",
        "  },",
        "};",
      ].join("\n"),
    });

    const task = await findTaskById("ping", {
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(task?.id, "ping");
    assertEquals(task?.name, "Ping task");
    assertEquals(task?.exportName, "pingTask");
  });

  it("discovers runtime tasks through adapter-backed project paths", async () => {
    const adapter = createRuntimeAdapter({
      "/project/remote-tasks/sync.ts": makeTaskSource("Remote Sync"),
    });

    const discovery = await discoverProjectTaskRuntime({
      projectDir: "/local-checkout",
      adapter,
      config: {
        fs: { type: "veryfront-api" },
        ai: { tasks: { discovery: { paths: ["remote-tasks"] } } },
      },
      fsAdapter: adapter.fs,
    });

    assertEquals([...discovery.tasks.keys()], ["sync"]);
  });

  it("isolates virtual project runtime config by cache key", async () => {
    const firstAdapter = createRuntimeAdapter({
      "/veryfront.config.ts": [
        "export default {",
        '  fs: { type: "veryfront-api" },',
        '  ai: { tasks: { discovery: { paths: ["first-tasks"] } } },',
        "};",
        "",
      ].join("\n"),
      "/project/first-tasks/first.ts": makeTaskSource("First"),
    });
    markAdapterAsVirtual(firstAdapter);

    const first = await discoverProjectTaskRuntime({
      projectDir: "/same-local-dir",
      adapter: firstAdapter,
      fsAdapter: firstAdapter.fs,
      cacheKey: "project-a",
    });
    assertEquals([...first.tasks.keys()], ["first"]);

    const secondAdapter = createRuntimeAdapter({
      "/veryfront.config.ts": [
        "export default {",
        '  fs: { type: "veryfront-api" },',
        '  ai: { tasks: { discovery: { paths: ["second-tasks"] } } },',
        "};",
        "",
      ].join("\n"),
      "/project/second-tasks/second.ts": makeTaskSource("Second"),
    });
    markAdapterAsVirtual(secondAdapter);

    const second = await discoverProjectTaskRuntime({
      projectDir: "/same-local-dir",
      adapter: secondAdapter,
      fsAdapter: secondAdapter.fs,
      cacheKey: "project-b",
    });

    assertEquals([...second.tasks.keys()], ["second"]);
  });

  it("returns runtime tasks alongside unrelated discovery errors by default", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/sync.ts": makeTaskSource("Sync"),
      "/project/tools/broken.ts": 'import "./missing.ts"; export default {};\n',
    });

    const discovery = await discoverProjectTaskRuntime({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      fsAdapter: adapter.fs,
    });

    assertEquals([...discovery.tasks.keys()], ["sync"]);
    assertEquals(discovery.errors.length, 1);
  });

  it("reports all runtime discovery errors in strict mode", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tools/first.ts": 'import "./missing-one.ts";\n',
      "/project/tools/second.ts": 'import "./missing-two.ts";\n',
    });

    await assertRejects(
      () =>
        discoverProjectTaskRuntime({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          fsAdapter: adapter.fs,
          throwOnErrors: true,
        }),
      Error,
      "Runtime discovery failed with 2 errors",
    );
  });

  it("runs task targets after project runtime discovery", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tools/runtime-marker.ts": [
        'import { tool } from "veryfront/tool";',
        'import { defineSchema } from "veryfront/schemas";',
        "",
        "export default tool({",
        '  id: "runtime_marker",',
        '  description: "Marks project runtime discovery.",',
        "  inputSchema: defineSchema((v) => v.object({}))(),",
        "  execute: () => ({ ok: true }),",
        "});",
        "",
      ].join("\n"),
      "/project/tasks/probe-runtime.ts": [
        'import { toolRegistry } from "veryfront/tool";',
        "",
        "export default {",
        '  name: "Probe runtime",',
        "  run() {",
        '    return { hasRuntimeTool: toolRegistry.has("runtime_marker") };',
        "  },",
        "};",
        "",
      ].join("\n"),
    });

    const result = await runTriggerTarget({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      target: { kind: "task", id: "probe-runtime" },
    });

    assertEquals(result.kind, "task");
    assertEquals(result.id, "probe-runtime");
    assertEquals(result.output, { hasRuntimeTool: true });
  });

  it("runs agent targets after project runtime discovery", async () => {
    const adapter = createRuntimeAdapter({
      "/project/agents/scheduled-agent.ts": [
        "export default {",
        '  id: "scheduled-agent",',
        '  config: { id: "scheduled-agent" },',
        "  async generate({ input, context }) {",
        '    return { text: `ran:${input}:${context.schedule_name}`, status: "completed", toolCalls: [] };',
        "  },",
        "};",
        "",
      ].join("\n"),
    });

    const result = await runTriggerTarget({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      target: { kind: "agent", id: "scheduled-agent" },
      agentInput: "Run the fixture.",
      agentContext: { schedule_name: "Fixture schedule" },
    });

    assertEquals(result.kind, "agent");
    assertEquals(result.id, "scheduled-agent");
    assertEquals(result.output, {
      text: "ran:Run the fixture.:Fixture schedule",
      status: "completed",
      toolCalls: 0,
    });

    await assertRejects(
      () =>
        runTriggerTarget({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          target: { kind: "agent", id: "scheduled-agent" },
        }),
      Error,
      "Local agent trigger runs require an explicit agent input.",
    );

    await assertRejects(
      () =>
        runTriggerTarget({
          projectDir: "/project",
          adapter,
          config: { fs: { type: "veryfront-api" } },
          target: { kind: "agent", id: "missing-agent" },
          agentInput: "Run the fixture.",
        }),
      Error,
      'Agent target "missing-agent" not found.',
    );
  });

  it("fails when an agent target returns an error status", async () => {
    const adapter = createRuntimeAdapter({
      "/project/agents/failing-agent.ts": [
        "export default {",
        '  id: "failing-agent",',
        '  config: { id: "failing-agent" },',
        "  async generate() {",
        '    return { text: "failure", status: "error", toolCalls: [] };',
        "  },",
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
          target: { kind: "agent", id: "failing-agent" },
          agentInput: "Run the fixture.",
        }),
      Error,
      'Agent target "failing-agent" failed.',
    );
  });
});
