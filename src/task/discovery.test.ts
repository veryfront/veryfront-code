import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { stop as stopEsbuild } from "esbuild";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { deriveTaskId, discoverTasks, findTaskById } from "./discovery.ts";
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

// Discovery uses the shared esbuild service under the hood, which outlives
// individual test cases until stopEsbuild() runs in afterAll.
describe("task/discovery", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterEach(() => {
    clearTranspileCache();
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
});
