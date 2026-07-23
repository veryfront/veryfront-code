import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FS_ADAPTER_KIND } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { clearConfigCache } from "#veryfront/config";
import { VeryfrontError } from "#veryfront/errors";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { deriveTaskId, discoverTasks, findTaskById } from "./discovery.ts";
import {
  discoverProjectTaskRuntime,
  findProjectRuntimeTask,
  formatProjectRuntimeDiscoveryErrors,
  listProjectRuntimeTasks,
} from "./project-runtime.ts";
import { runTriggerTarget } from "../trigger/local-runner.ts";
import { isTaskDefinition, type TaskDefinition } from "./types.ts";

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
    [FS_ADAPTER_KIND]: "veryfront-multi-project",
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
      assertEquals(deriveTaskId("tasks/native.mjs", "tasks"), "native");
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

    it("rejects accessor-backed and malformed known fields without invoking accessors", () => {
      let reads = 0;
      const accessorBacked = {};
      Object.defineProperty(accessorBacked, "run", {
        enumerable: true,
        get() {
          reads += 1;
          return () => null;
        },
      });
      const cyclicSchema: Record<string, unknown> = {};
      cyclicSchema.self = cyclicSchema;

      for (
        const value of [
          accessorBacked,
          { run() {}, name: 42 },
          { run() {}, name: "spoof\u202Etxt" },
          { run() {}, description: "x".repeat(4_097) },
          { run() {}, schedulable: "yes" },
          { run() {}, inputSchema: cyclicSchema },
          { run() {}, outputSchema: new Date() },
        ]
      ) {
        assertEquals(isTaskDefinition(value), false);
      }
      assertEquals(reads, 0);
    });
  });

  it("rejects task directories that escape the project root", async () => {
    const adapter = createRuntimeAdapter({});

    for (
      const tasksDir of [
        "../outside",
        "C:\\outside",
        "\\\\server\\share",
        "tasks\nforged",
        "tasks\u202Etxt",
        "tasks\u061Ctxt",
      ]
    ) {
      await assertRejects(
        () => discoverTasks({ projectDir: "/project", adapter, tasksDir }),
        Error,
        "tasksDir",
      );
    }
  });

  it("does not expose unsafe adapter-supplied paths in discovery results", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/bad\nname.ts": makeTaskSource("Unsafe path"),
    });

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(result.tasks, []);
    assertEquals(result.errors, [{
      filePath: "tasks",
      error: "Task file must resolve to a canonical lowercase id.",
    }]);
  });

  it("propagates cancellation before touching the filesystem", async () => {
    const adapter = createRuntimeAdapter({});
    let filesystemReads = 0;
    adapter.fs.exists = () => {
      filesystemReads += 1;
      return Promise.resolve(false);
    };
    const controller = new AbortController();
    controller.abort();

    await assertRejects(
      () =>
        discoverTasks({
          projectDir: "/project",
          adapter,
          signal: controller.signal,
        } as never),
      DOMException,
      "aborted",
    );
    assertEquals(filesystemReads, 0);
  });

  it("propagates cancellation during file enumeration before loading modules", async () => {
    const adapter = createRuntimeAdapter({});
    const controller = new AbortController();
    let enumerationStarted = false;
    let moduleReads = 0;
    adapter.fs.exists = () => Promise.resolve(true);
    adapter.fs.readDir = async function* () {
      enumerationStarted = true;
      controller.abort();
      yield { name: "first.ts", isFile: true, isDirectory: false, isSymlink: false };
    };
    adapter.fs.readFile = () => {
      moduleReads += 1;
      return Promise.resolve(makeTaskSource("Must not load"));
    };

    await assertRejects(
      () =>
        discoverTasks({
          projectDir: "/project",
          adapter,
          signal: controller.signal,
        }),
      DOMException,
      "aborted",
    );

    assertEquals(enumerationStarted, true);
    assertEquals(moduleReads, 0);
  });

  it("checks cancellation before loading a subsequent task module", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/cancel-first.ts": makeTaskSource("First"),
      "/project/tasks/cancel-second.ts": makeTaskSource("Second"),
    });
    const controller = new AbortController();
    const loadedTaskFiles: string[] = [];
    const readFile = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = async (path) => {
      if (path.endsWith("cancel-first.ts") || path.endsWith("cancel-second.ts")) {
        loadedTaskFiles.push(path.split("/").at(-1)!);
      }
      const source = await readFile(path);
      if (path.endsWith("cancel-first.ts")) controller.abort();
      return source;
    };

    await assertRejects(
      () =>
        discoverTasks({
          projectDir: "/project",
          adapter,
          signal: controller.signal,
        }),
      DOMException,
      "aborted",
    );

    assertEquals(loadedTaskFiles, ["cancel-first.ts"]);
  });

  it("contains filesystem failures without exposing their raw messages", async () => {
    const adapter = createRuntimeAdapter({});
    adapter.fs.exists = () => Promise.reject(new Error("sensitive-canary"));

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(result, {
      tasks: [],
      errors: [{
        filePath: "tasks",
        error: "Unable to discover task definitions.",
      }],
    });
  });

  it("contains malformed directory collections without exposing adapter details", async () => {
    const adapter = createRuntimeAdapter({});
    adapter.fs.exists = () => Promise.resolve(true);
    adapter.fs.readDir = (() => null) as never;

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(result, {
      tasks: [],
      errors: [{
        filePath: "tasks",
        error: "Unable to discover task definitions.",
      }],
    });
  });

  it("rejects a task directory that resolves outside the project root", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/ping.ts": makeTaskSource("Escaped task"),
    });
    adapter.fs.realPath = (path) =>
      Promise.resolve(path === "/project" ? "/project" : "/outside/tasks");

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(result, {
      tasks: [],
      errors: [{ filePath: "tasks", error: "Unable to discover task definitions." }],
    });
  });

  it("uses lstat to verify local task-directory containment when realPath is unavailable", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/ping.ts": makeTaskSource("Ping task"),
    });
    const inspectedPaths: string[] = [];
    adapter.fs.lstat = (path) => {
      inspectedPaths.push(path);
      return Promise.resolve({
        size: 0,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        mtime: null,
      });
    };

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(inspectedPaths.slice(0, 2), ["/project", "/project/tasks"]);
    assertEquals(result.errors, []);
    assertEquals(result.tasks.map((task) => task.id), ["ping"]);
  });

  it("rejects symlinks found by the lstat containment fallback", async () => {
    for (const symlinkPath of ["/project", "/project/tasks"]) {
      const adapter = createRuntimeAdapter({
        "/project/tasks/ping.ts": makeTaskSource("Ping task"),
      });
      let directoryReads = 0;
      const readDir = adapter.fs.readDir.bind(adapter.fs);
      adapter.fs.readDir = (path) => {
        directoryReads += 1;
        return readDir(path);
      };
      adapter.fs.lstat = (path) =>
        Promise.resolve({
          size: 0,
          isFile: false,
          isDirectory: true,
          isSymlink: path === symlinkPath,
          mtime: null,
        });

      const result = await discoverTasks({ projectDir: "/project", adapter });

      assertEquals(result, {
        tasks: [],
        errors: [{ filePath: "tasks", error: "Unable to discover task definitions." }],
      });
      assertEquals(directoryReads, 0);
    }
  });

  it("bounds task file enumeration before loading any module", async () => {
    const adapter = createRuntimeAdapter({});
    let yieldedEntries = 0;
    let moduleReads = 0;
    adapter.fs.exists = () => Promise.resolve(true);
    adapter.fs.readDir = async function* () {
      for (let index = 0; index <= 10_000; index++) {
        yieldedEntries += 1;
        yield {
          name: `task-${index}.ts`,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
        };
      }
    };
    adapter.fs.readFile = () => {
      moduleReads += 1;
      return Promise.resolve(makeTaskSource("Must not load"));
    };

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(yieldedEntries, 10_001);
    assertEquals(moduleReads, 0);
    assertEquals(result, {
      tasks: [],
      errors: [{ filePath: "tasks", error: "Unable to discover task definitions." }],
    });
  });

  it("keeps the first task deterministically and reports later duplicate ids", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/ping.ts": makeTaskSource("TypeScript ping"),
      "/project/tasks/ping.js": makeTaskSource("JavaScript ping"),
    });

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(result.tasks.length, 1);
    assertEquals(result.tasks[0]?.id, "ping");
    assertEquals(result.tasks[0]?.name, "JavaScript ping");
    assertEquals(result.errors, [{
      filePath: "tasks/ping.ts",
      error: 'Duplicate task id "ping".',
    }]);
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

  it("rejects task modules that exceed the export-count boundary", async () => {
    const source = Array.from(
      { length: 257 },
      (_, index) => `export const helper${index} = ${index};`,
    ).join("\n");
    const adapter = createRuntimeAdapter({
      "/project/tasks/too-many-exports.ts": source,
    });

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(result.tasks, []);
    assertEquals(result.errors, [{
      filePath: "tasks/too-many-exports.ts",
      error: "Unable to load task definition.",
    }]);
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

  it("reports malformed task-like exports instead of treating them as helpers", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/broken.ts": 'export default { run: "not-a-function" };',
    });

    const result = await discoverTasks({ projectDir: "/project", adapter });

    assertEquals(result.tasks, []);
    assertEquals(result.errors, [{
      filePath: "tasks/broken.ts",
      error: "Unable to load task definition.",
    }]);
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

  it("rejects ambiguous duplicate ids before loading either matching module", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/ping.ts": makeTaskSource("TypeScript ping"),
      "/project/tasks/ping.js": makeTaskSource("JavaScript ping"),
    });
    let moduleReads = 0;
    const readFile = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = (path) => {
      moduleReads += 1;
      return readFile(path);
    };

    const error = await assertRejects(
      () => findTaskById("ping", { projectDir: "/project", adapter }),
      VeryfrontError,
    );

    assertEquals(error.slug, "initialization-error");
    assertEquals(moduleReads, 0);
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

  it("rejects non-canonical task ids during project runtime discovery", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/Bad.ts": makeTaskSource("Invalid task id"),
    });

    const discovery = await discoverProjectTaskRuntime({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      fsAdapter: adapter.fs,
    });

    assertEquals([...discovery.tasks.keys()], []);
    assertEquals(discovery.errors.length, 1);
  });

  it("fails closed when runtime task collections contain invalid ids", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/good.ts": makeTaskSource("Good task"),
    });
    const discovery = await discoverProjectTaskRuntime({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } },
      fsAdapter: adapter.fs,
    });
    discovery.tasks.set("Bad", discovery.tasks.get("good")!);

    assertEquals(findProjectRuntimeTask(discovery, "Bad"), null);
    assertThrows(
      () => listProjectRuntimeTasks(discovery),
      VeryfrontError,
      "invalid task id",
    );
  });

  it("fails closed when runtime task definitions are malformed", () => {
    const tasks = new Map<string, TaskDefinition>([
      ["broken", { run: "not-a-function" } as unknown as TaskDefinition],
      ["missing", undefined as unknown as TaskDefinition],
    ]);

    assertThrows(
      () => findProjectRuntimeTask({ tasks }, "broken"),
      VeryfrontError,
      "invalid task definition",
    );
    assertThrows(
      () => findProjectRuntimeTask({ tasks }, "missing"),
      VeryfrontError,
      "invalid task definition",
    );
    assertThrows(
      () => listProjectRuntimeTasks({ tasks }),
      VeryfrontError,
      "invalid task definition",
    );
  });

  it("bounds runtime task listing work", () => {
    const tasks = new Map<string, TaskDefinition>();
    const definition: TaskDefinition = { run: () => null };
    for (let index = 0; index <= 10_000; index++) {
      tasks.set(`task-${index}`, definition);
    }

    assertThrows(
      () => listProjectRuntimeTasks({ tasks }),
      VeryfrontError,
      "more than 10000 tasks",
    );
  });

  it("bounds aggregate runtime task metadata work", () => {
    const tasks = new Map<string, TaskDefinition>();
    const inputSchema = { values: new Array(9_000).fill(null) };
    for (let index = 0; index < 12; index++) {
      tasks.set(`task-${index}`, { inputSchema, run: () => null });
    }

    assertThrows(
      () => listProjectRuntimeTasks({ tasks }),
      VeryfrontError,
      "aggregate size",
    );
  });

  it("rejects accessor-backed project runtime options without invoking them", async () => {
    const adapter = createRuntimeAdapter({});
    let reads = 0;
    const options = { adapter };
    Object.defineProperty(options, "projectDir", {
      enumerable: true,
      get() {
        reads += 1;
        return "/project";
      },
    });

    await assertRejects(
      () => discoverProjectTaskRuntime(options as never),
      Error,
      "options.projectDir",
    );
    assertEquals(reads, 0);
  });

  it("bounds and redacts formatted runtime discovery failures", () => {
    const format = formatProjectRuntimeDiscoveryErrors as (
      errors: Array<{ file: string; error: Error }>,
      projectDir?: string,
    ) => string[];

    assertEquals(
      format(
        [{
          file: "/secret/project/tasks/broken.ts",
          error: new Error("Request token=super-secret failed in /secret/project spoof\u202Etxt"),
        }],
        "/secret/project",
      ),
      ["tasks/broken.ts: Request token=[REDACTED] failed in <project> spooftxt"],
    );
    assertEquals(
      format([{ file: "", error: new Error("Contained failure") }]),
      ["<project>: Contained failure"],
    );
  });

  it("redacts unrelated local paths from runtime discovery failures", () => {
    const [line] = formatProjectRuntimeDiscoveryErrors(
      [{
        file: "/secret/project/tasks/broken.ts",
        error: new Error(
          String
            .raw`Failed beside /private/other/key.pem, C:\Users\dev\token.txt, \\server\share\private.txt, file:///private/other/config.ts, and file://private-host/share/runtime.ts via https://user:password@example.com/source`,
        ),
      }],
      "/secret/project",
    );

    assertEquals(
      line,
      "tasks/broken.ts: Failed beside <LOCAL_PATH>, <LOCAL_PATH> <LOCAL_PATH>, <LOCAL_PATH>, and <LOCAL_PATH> via https://user:[REDACTED]@example.com/source",
    );

    assertEquals(
      formatProjectRuntimeDiscoveryErrors([{
        file: "file://private-host/share/tasks/broken.ts",
        error: new Error("Contained failure"),
      }]),
      ["<project>: Contained failure"],
    );
  });

  it("bounds aggregate runtime discovery diagnostics in stable order", () => {
    const errors = Array.from({ length: 10_000 }, (_, index) => ({
      file: `tasks/${String(index).padStart(4, "0")}.ts`,
      error: new Error(`failure-${index}`),
    }));

    const lines = formatProjectRuntimeDiscoveryErrors(errors);
    const output = lines.join("\n");

    assertEquals(lines[0], "tasks/0000.ts: failure-0");
    assertEquals(lines.at(-1), "<project>: Additional discovery errors were omitted.");
    assertEquals(output.length <= 10_000, true);
    assertEquals(output.includes("tasks/9999.ts"), false);
  });

  it("rejects unsafe controls in project runtime path identities", async () => {
    const adapter = createRuntimeAdapter({});
    const cases = [
      ["projectDir", "/project\nspoof"],
      ["projectDir", "/project\u202Espoof"],
      ["projectDir", "/project\u061Cspoof"],
      ["cacheKey", "cache\tspoof"],
      ["cacheKey", "cache\u2066spoof"],
      ["cacheKey", "cache\u061Cspoof"],
    ] as const;

    for (const [key, value] of cases) {
      const options: Record<string, unknown> = {
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } },
        fsAdapter: adapter.fs,
      };
      options[key] = value;

      const error = await assertRejects(
        () => discoverProjectTaskRuntime(options as never),
        VeryfrontError,
      );
      assertEquals((error as VeryfrontError).slug, "invalid-argument");
    }
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

    const error = await assertRejects(
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
    assertStringIncludes(error.message, "tools/first.ts");
    assertStringIncludes(error.message, "tools/second.ts");
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
});
