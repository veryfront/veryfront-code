import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { clearConfigCache } from "#veryfront/config";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { discoverAll, type DiscoveryResult } from "#veryfront/discovery";
import { taskHandler } from "#veryfront/discovery/handlers/task-handler.ts";
import { makeTempDir, mkdir, remove, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/index.ts";
import { runTriggerTarget } from "../trigger/local-runner.ts";
import {
  deriveTaskId,
  discoverTasks as discoverTasksRaw,
  findTaskById as findTaskByIdRaw,
} from "./discovery.ts";
import {
  discoverProjectTaskRuntime as discoverProjectTaskRuntimeRaw,
  listProjectRuntimeTasks,
} from "./project-runtime.ts";
import { isTaskDefinition, type TaskDefinition } from "./types.ts";

const discoverTasks: typeof discoverTasksRaw = (options) =>
  discoverTasksRaw({ ...options, allowHostProjectCodeExecution: true });
const findTaskById: typeof findTaskByIdRaw = (taskId, options) =>
  findTaskByIdRaw(taskId, { ...options, allowHostProjectCodeExecution: true });
const discoverProjectTaskRuntime: typeof discoverProjectTaskRuntimeRaw = (options) =>
  discoverProjectTaskRuntimeRaw({
    ...options,
    allowHostProjectCodeExecution: true,
  });

function createMockAdapter(files: Record<string, string>): FileSystemAdapter {
  const normalize = (path: string): string => path.replace(/^\/project\/?/, "").replace(/^\/+/, "");
  const normalizedFiles = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [normalize(path), content]),
  );

  return {
    async readFile(path: string): Promise<string> {
      const content = normalizedFiles[normalize(path)];
      if (content === undefined) {
        throw new Deno.errors.NotFound(`File not found: ${path}`);
      }
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

/** Present the adapter as the trusted single-project virtual filesystem used by discovery. */
function markAdapterAsSingleProjectVirtual(adapter: RuntimeAdapter): void {
  Object.assign(adapter.fs, {
    getUnderlyingAdapter: () => adapter.fs,
    getAdapterType: () => "VeryfrontFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => false,
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

    it("normalizes Windows separators and file URLs", () => {
      assertEquals(
        deriveTaskId(
          String.raw`C:\project\tasks\reports\daily.ts`,
          String.raw`C:\project\tasks`,
        ),
        "reports/daily",
      );
      assertEquals(
        deriveTaskId(
          "file:///C:/project/tasks/reports/daily.ts",
          String.raw`C:\project\tasks`,
        ),
        "reports/daily",
      );
      assertEquals(
        deriveTaskId(
          "file:///project/tasks/report%20daily.ts",
          "/project/tasks",
        ),
        "report daily",
      );
    });

    it("returns the input path when the prefix does not match", () => {
      assertEquals(deriveTaskId("other/cleanup.ts", "tasks"), "other/cleanup");
    });
  });

  describe("isTaskDefinition", () => {
    it("accepts objects with a runnable export", () => {
      assertEquals(isTaskDefinition({ run: () => {} }), true);
      assertEquals(
        isTaskDefinition(Object.defineProperty({}, "run", { value() {} })),
        true,
      );
      assertEquals(
        isTaskDefinition({
          name: "My Task",
          description: "Does things",
          run: async () => ({ ok: true }),
        }),
        true,
      );
    });

    it("keeps class-instance task definitions structurally valid", () => {
      class StatefulTask {
        private readonly _prefix = "stateful";

        run(): string {
          return this._prefix;
        }
      }

      const task = new StatefulTask();
      Object.defineProperties(StatefulTask.prototype, {
        name: { value: "Stateful task" },
        schedulable: { value: true },
        inputSchema: {
          value: { type: "object", properties: { id: { type: "string" } } },
        },
        integrationRequirements: {
          value: [{ integration: "slack", requiredScopes: ["channels:read"] }],
        },
      });
      assertEquals(isTaskDefinition(task), true);
      const registered = taskHandler.register("stateful", task, "tasks/stateful.ts", "tasks");
      assertEquals(
        registered.run({
          env: {},
          config: {},
        }),
        "stateful",
      );
      assertEquals(registered.name, "Stateful task");
      assertEquals(registered.schedulable, true);
      assertEquals(registered.inputSchema, {
        type: "object",
        properties: { id: { type: "string" } },
      });
      assertEquals(registered.integrationRequirements, [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [],
      }]);
    });

    it("rejects inherited metadata accessors without invoking them", () => {
      let reads = 0;
      const prototype = Object.defineProperties({}, {
        run: { value() {} },
        integrationRequirements: {
          get() {
            reads++;
            return [{ integration: "slack" }];
          },
        },
      });

      assertEquals(isTaskDefinition(Object.create(prototype)), false);
      assertEquals(reads, 0);
    });

    it("uses captured reflection primitives after module initialization", () => {
      const originalApply = Reflect.apply;
      const originalGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
      const originalGetPrototypeOf = Reflect.getPrototypeOf;
      const originalOwnKeys = Reflect.ownKeys;
      const originalDefineProperty = Object.defineProperty;
      const originalHasOwn = Object.hasOwn;
      const originalFreeze = Object.freeze;
      const originalValues = Object.values;
      let poisonCalls = 0;
      let freezePoisonCalls = 0;
      const poison = (): never => {
        poisonCalls++;
        throw new Error("ambient reflection primitive must not run");
      };
      const freezePoison = (<T>(value: T): Readonly<T> => {
        freezePoisonCalls++;
        return value;
      }) as typeof Object.freeze;
      let output: unknown;
      let inputSchema: TaskDefinition["inputSchema"];
      let requirements: TaskDefinition["integrationRequirements"];
      const sourceInputSchema = {
        type: "object",
        properties: { name: { type: "string" } },
      };

      try {
        Reflect.apply = poison;
        Reflect.getOwnPropertyDescriptor = poison;
        Reflect.getPrototypeOf = poison;
        Reflect.ownKeys = poison;
        Object.defineProperty = poison;
        Object.hasOwn = poison;
        Object.freeze = freezePoison;
        Object.values = poison;

        const registered = taskHandler.register(
          "stable",
          {
            run() {
              return "stable";
            },
            inputSchema: sourceInputSchema,
            integrationRequirements: [{
              integration: "slack",
              requiredScopes: ["channels:read"],
              resources: [{
                kind: "channel",
                id: "C012345",
                parent: { kind: "workspace", id: "T012345" },
              }],
            }],
          },
          "tasks/stable.ts",
          "tasks",
        );
        output = registered.run({ env: {}, config: {} });
        inputSchema = registered.inputSchema;
        requirements = registered.integrationRequirements;
      } finally {
        Reflect.apply = originalApply;
        Reflect.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
        Reflect.getPrototypeOf = originalGetPrototypeOf;
        Reflect.ownKeys = originalOwnKeys;
        Object.defineProperty = originalDefineProperty;
        Object.hasOwn = originalHasOwn;
        Object.freeze = originalFreeze;
        Object.values = originalValues;
      }

      sourceInputSchema.properties.name.type = "number";
      assertEquals(output, "stable");
      assertEquals(poisonCalls, 0);
      assertEquals(freezePoisonCalls, 0);
      assertEquals(inputSchema, {
        type: "object",
        properties: { name: { type: "string" } },
      });
      assertEquals(inputSchema === sourceInputSchema, false);
      assertEquals(Object.isFrozen(inputSchema), true);
      assertEquals(Object.isFrozen(inputSchema?.properties), true);
      assertEquals(Object.isFrozen(requirements), true);
      assertEquals(Object.isFrozen(requirements?.[0]), true);
      assertEquals(Object.isFrozen(requirements?.[0]?.requiredScopes), true);
      assertEquals(Object.isFrozen(requirements?.[0]?.resources), true);
      assertEquals(Object.isFrozen(requirements?.[0]?.resources?.[0]), true);
      assertEquals(Object.isFrozen(requirements?.[0]?.resources?.[0]?.parent), true);
    });

    it("rejects non-task values", () => {
      assertEquals(isTaskDefinition(null), false);
      assertEquals(isTaskDefinition(undefined), false);
      assertEquals(isTaskDefinition("not a task"), false);
      assertEquals(isTaskDefinition(42), false);
      assertEquals(isTaskDefinition({ name: "no run" }), false);
      assertEquals(isTaskDefinition({ run: "not a function" }), false);
    });

    it("rejects malformed optional metadata instead of poisoning typed consumers", () => {
      assertEquals(isTaskDefinition({ run() {}, name: 42 }), false);
      assertEquals(isTaskDefinition({ run() {}, description: false }), false);
      assertEquals(isTaskDefinition({ run() {}, inputSchema: [] }), false);
      assertEquals(isTaskDefinition({ run() {}, outputSchema: null }), false);
      assertEquals(isTaskDefinition({ run() {}, schedulable: "true" }), false);
      assertEquals(isTaskDefinition({ run() {}, integrationRequirements: {} }), false);
      assertEquals(
        isTaskDefinition({ run() {}, integrationRequirements: [{ integration: 42 }] }),
        false,
      );
      assertEquals(
        isTaskDefinition({
          run() {},
          integrationRequirements: [{ integration: "slack", requiredScopes: "channels:read" }],
        }),
        false,
      );
      assertEquals(
        isTaskDefinition({
          run() {},
          name: "Valid task",
          description: "Valid metadata",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          schedulable: true,
          integrationRequirements: [{
            integration: "slack",
            requiredScopes: ["channels:read"],
            resources: [{ kind: "channel", id: "C012345" }],
          }],
        }),
        true,
      );
    });

    it("does not evaluate integration requirement accessors", () => {
      let reads = 0;
      const task = Object.defineProperties({}, {
        run: { enumerable: true, value() {} },
        integrationRequirements: {
          enumerable: true,
          get() {
            reads++;
            return [{ integration: "slack" }];
          },
        },
      });

      assertEquals(isTaskDefinition(task), false);
      assertEquals(reads, 0);
    });

    it("rejects non-canonical integration requirement metadata", () => {
      for (
        const integrationRequirements of [
          [{ integration: "Slack" }],
          [{ integration: "slack" }, { integration: "slack" }],
          [{ integration: "slack", requiredScopes: ["channels:read", "channels:read"] }],
          [{ integration: "slack", resources: [{ kind: "Channel", id: "C012345" }] }],
          [{
            integration: "slack",
            resources: [
              { kind: "channel", id: "C012345" },
              { kind: "channel", id: "C012345" },
            ],
          }],
        ]
      ) {
        assertEquals(isTaskDefinition({ run() {}, integrationRequirements }), false);
      }

      assertThrows(
        () =>
          taskHandler.register(
            "invalid",
            { run() {}, integrationRequirements: [{ integration: "Slack" }] },
            "tasks/invalid.ts",
            "tasks",
          ),
        Error,
        "Task integrationRequirements[0].integration",
      );
    });

    it("registers detached immutable schema metadata", () => {
      const inputSchema = {
        type: "object",
        properties: { name: { type: "string" } },
      };
      const outputSchema = {
        type: "object",
        properties: { ok: { type: "boolean" } },
      };

      const registered = taskHandler.register(
        "schema-task",
        { run() {}, inputSchema, outputSchema },
        "tasks/schema-task.ts",
        "tasks",
      );

      inputSchema.properties.name.type = "number";
      outputSchema.properties.ok.type = "string";

      assertEquals(registered.inputSchema, {
        type: "object",
        properties: { name: { type: "string" } },
      });
      assertEquals(registered.outputSchema, {
        type: "object",
        properties: { ok: { type: "boolean" } },
      });
      assertEquals(Object.isFrozen(registered.inputSchema), true);
      assertEquals(Object.isFrozen(registered.inputSchema?.properties), true);
      assertEquals(Object.isFrozen(registered.outputSchema), true);
      assertEquals(Object.isFrozen(registered.outputSchema?.properties), true);
    });

    it("preserves record-compatible schemas with callbacks and non-enumerable fields", () => {
      const parse = (value: unknown) => value;
      const inputSchema = { parse } as Record<string, unknown>;
      Object.defineProperty(inputSchema, "schemaVersion", {
        value: 7,
        enumerable: false,
      });

      const task = { run() {}, inputSchema };
      assertEquals(isTaskDefinition(task), true);
      const registered = taskHandler.register(
        "compatible-schema",
        task,
        "tasks/compatible-schema.ts",
        "tasks",
      );

      assertEquals(registered.inputSchema === inputSchema, true);
      assertEquals(registered.inputSchema?.parse === parse, true);
      assertEquals(
        Object.getOwnPropertyDescriptor(registered.inputSchema, "schemaVersion")?.value,
        7,
      );
    });

    it("preserves the receiver of record-compatible schema methods", () => {
      const states = new WeakMap<object, string>();
      const inputSchema = {
        parse(this: object) {
          return states.get(this);
        },
      };
      states.set(inputSchema, "original receiver");

      const registered = taskHandler.register(
        "stateful-schema",
        { run() {}, inputSchema },
        "tasks/stateful-schema.ts",
        "tasks",
      );

      const parse = registered.inputSchema?.parse as () => unknown;
      assertEquals(parse.call(registered.inputSchema), "original receiver");
    });

    it("preserves inherited callback schema receivers", () => {
      const parserState = new WeakMap<object, string>();
      class StatefulSchema {
        parse(value: unknown): string {
          return `${parserState.get(this)}:${String(value)}`;
        }
      }
      const inputSchema = new StatefulSchema();
      parserState.set(inputSchema, "ready");

      const registered = taskHandler.register(
        "inherited-receiver-schema",
        { run() {}, inputSchema },
        "tasks/inherited-receiver-schema.ts",
        "tasks",
      );

      const registeredInputSchema = registered.inputSchema;
      if (!registeredInputSchema) throw new Error("Expected captured input schema");
      const parse = registeredInputSchema.parse as (
        this: Record<string, unknown>,
        value: unknown,
      ) => string;
      assertEquals(parse.call(registeredInputSchema, "value"), "ready:value");
    });

    it("preserves inherited schema methods with private receiver state", () => {
      class StatefulSchema {
        #state = "private receiver";

        parse() {
          return this.#state;
        }
      }

      const inputSchema = new StatefulSchema();
      const schemaRecord = inputSchema as unknown as Record<string, unknown>;
      const registered = taskHandler.register(
        "class-schema",
        { run() {}, inputSchema: schemaRecord },
        "tasks/class-schema.ts",
        "tasks",
      );

      assertEquals(registered.inputSchema === schemaRecord, true);
      const parse = registered.inputSchema?.parse as () => unknown;
      assertEquals(parse.call(registered.inputSchema), "private receiver");
    });

    it("registers detached immutable integration requirement metadata", () => {
      const integrationRequirements = [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }];
      const task = { run() {}, integrationRequirements };

      const registered = taskHandler.register("sync", task, "tasks/sync.ts", "tasks");

      integrationRequirements[0]!.requiredScopes[0] = "mutated";
      integrationRequirements[0]!.resources[0]!.id = "mutated";

      assertEquals(registered.integrationRequirements, [{
        integration: "slack",
        requiredScopes: ["channels:read"],
        resources: [{ kind: "channel", id: "C012345" }],
      }]);
      assertEquals(Object.isFrozen(registered), true);
      assertEquals(Object.isFrozen(registered.integrationRequirements), true);
      assertEquals(Object.isFrozen(registered.integrationRequirements![0]), true);
      assertEquals(Object.isFrozen(registered.integrationRequirements![0]!.requiredScopes), true);
      assertEquals(Object.isFrozen(registered.integrationRequirements![0]!.resources), true);
      assertThrows(
        () => registered.integrationRequirements!.push({ integration: "github" }),
        TypeError,
      );
    });
  });

  it("returns legacy discovery results in deterministic id order", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/z-last.ts": makeTaskSource("Last"),
      "/project/tasks/a-first.ts": makeTaskSource("First"),
    });

    const result = await discoverTasks({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(result.errors, []);
    assertEquals(result.tasks.map((task) => task.id), ["a-first", "z-last"]);
  });

  it("reports invalid integration requirement metadata during legacy discovery", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/invalid.ts": [
        "export default {",
        "  run() {},",
        '  integrationRequirements: [{ integration: "Slack" }],',
        "};",
      ].join("\n"),
    });

    const result = await discoverTasks({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(result.tasks, []);
    assertEquals(result.errors.length, 1);
    assertEquals(
      result.errors[0]?.error.includes("must use a lowercase integration identifier"),
      true,
    );
  });

  it("keeps valid sibling tasks after malformed legacy candidates", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/default-first.ts": [
        "export default {",
        "  run() {},",
        '  integrationRequirements: [{ integration: "Slack" }],',
        "};",
        'export const validDefaultSibling = { run() { return "default sibling"; } };',
      ].join("\n"),
      "/project/tasks/named-first.ts": [
        "export const aBroken = {",
        "  run() {},",
        '  integrationRequirements: [{ integration: "Slack" }],',
        "};",
        'export const zValidNamedSibling = { run() { return "named sibling"; } };',
      ].join("\n"),
    });

    const result = await discoverTasks({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(result.tasks.map((task) => [task.id, task.exportName]), [
      ["default-first", "validDefaultSibling"],
      ["named-first", "zValidNamedSibling"],
    ]);
    assertEquals(result.errors.length, 2);
    assertEquals(
      result.errors.every((entry) =>
        entry.error.includes("must use a lowercase integration identifier")
      ),
      true,
    );
  });

  it("reports invalid integration requirement metadata during unified discovery", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-task-invalid-requirements-" });

    try {
      await Deno.mkdir(`${tempDir}/tasks`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/tasks/sync.ts`,
        [
          "export default {",
          "  run() {},",
          '  integrationRequirements: [{ integration: "Slack" }],',
          "};",
        ].join("\n"),
      );

      const result = await discoverAll({
        baseDir: tempDir,
        allowHostProjectCodeExecution: true,
      });

      assertEquals(result.tasks.size, 0);
      assertEquals(result.errors.length, 1);
      assertEquals(
        result.errors[0]?.error.message.includes(
          "must use a lowercase integration identifier",
        ),
        true,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("keeps valid sibling tasks after malformed unified candidates", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-task-invalid-sibling-" });

    try {
      await Deno.mkdir(`${tempDir}/tasks`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/tasks/default-first.ts`,
        [
          "export default {",
          "  run() {},",
          '  integrationRequirements: [{ integration: "Slack" }],',
          "};",
          'export const validDefaultSibling = { run() { return "default sibling"; } };',
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${tempDir}/tasks/named-first.ts`,
        [
          "export const aBroken = {",
          "  run() {},",
          '  integrationRequirements: [{ integration: "Slack" }],',
          "};",
          'export const zValidNamedSibling = { run() { return "named sibling"; } };',
        ].join("\n"),
      );

      const result = await discoverAll({
        baseDir: tempDir,
        allowHostProjectCodeExecution: true,
      });

      assertEquals([...result.tasks.keys()].sort(), [
        "default-first",
        "named-first",
      ]);
      assertEquals(result.errors.length, 2);
      assertEquals(
        result.errors.every((entry) =>
          entry.error.message.includes("must use a lowercase integration identifier")
        ),
        true,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("keeps the file-derived ID when malformed named candidates are rejected", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-task-invalid-id-sibling-" });

    try {
      await mkdir(`${tempDir}/tasks`, { recursive: true });
      await writeTextFile(
        `${tempDir}/tasks/sync.ts`,
        [
          'export const aBroken = { run: "not a function" };',
          'export const zValid = { run() { return "valid sibling"; } };',
        ].join("\n"),
      );

      const result = await discoverAll({
        baseDir: tempDir,
        allowHostProjectCodeExecution: true,
      });

      assertEquals([...result.tasks.keys()], ["sync"]);
      assertEquals(result.tasks.get("sync")?.run({ env: {}, config: {} }), "valid sibling");
      assertEquals(result.errors.map((entry) => entry.error.message), [
        "Task definition run must be a function.",
      ]);
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("reports accessor-backed task metadata without invoking the accessor", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-task-accessor-metadata-" });

    try {
      await Deno.mkdir(`${tempDir}/tasks`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/tasks/sync.ts`,
        [
          "export default {",
          "  run() {},",
          "  get integrationRequirements() {",
          '    throw new Error("integrationRequirements accessor executed");',
          "  },",
          "};",
        ].join("\n"),
      );

      const result = await discoverAll({
        baseDir: tempDir,
        allowHostProjectCodeExecution: true,
      });

      assertEquals(result.tasks.size, 0);
      assertEquals(result.errors.length, 1);
      assertEquals(
        result.errors[0]?.error.message.includes(
          "integrationRequirements must be a data property",
        ),
        true,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("discovers class-instance tasks and preserves their run receiver", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-task-class-instance-" });

    try {
      await Deno.mkdir(`${tempDir}/tasks`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/tasks/stateful.ts`,
        [
          "class StatefulTask {",
          '  prefix = "stateful";',
          "  run() { return this.prefix; }",
          "}",
          "export default new StatefulTask();",
        ].join("\n"),
      );

      const result = await discoverAll({
        baseDir: tempDir,
        allowHostProjectCodeExecution: true,
      });

      assertEquals(result.errors, []);
      assertEquals([...result.tasks.keys()], ["stateful"]);
      assertEquals(result.tasks.get("stateful")?.run({ env: {}, config: {} }), "stateful");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("does not treat Object.prototype.run pollution as a task export", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-task-prototype-pollution-" });
    Object.defineProperty(Object.prototype, "run", {
      configurable: true,
      value: () => "polluted",
    });

    try {
      assertEquals(isTaskDefinition({}), false);
      await Deno.mkdir(`${tempDir}/tasks`, { recursive: true });
      await Deno.writeTextFile(
        `${tempDir}/tasks/config.ts`,
        [
          'export const config = { mode: "safe" };',
          "export const helper = {};",
        ].join("\n"),
      );

      const result = await discoverAll({
        baseDir: tempDir,
        allowHostProjectCodeExecution: true,
      });

      assertEquals(result.errors, []);
      assertEquals([...result.tasks.keys()], []);
    } finally {
      delete (Object.prototype as Record<string, unknown>).run;
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects ambiguous legacy task ids across supported extensions", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/sync.js": makeTaskSource("JavaScript sync"),
      "/project/tasks/sync.ts": makeTaskSource("TypeScript sync"),
    });

    const result = await discoverTasks({
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });
    const found = await findTaskById("sync", {
      projectDir: "/project",
      adapter,
      config: { fs: { type: "veryfront-api" } } as never,
    });

    assertEquals(result.tasks, []);
    assertEquals(result.errors.length, 2);
    assertEquals(
      result.errors.every((error) => error.error.includes('Duplicate task id "sync"')),
      true,
    );
    assertEquals(found, null);
  });

  it("sorts project runtime task listings independently of map insertion order", () => {
    const first = { name: "First", run() {} };
    const last = { name: "Last", run() {} };
    const discovery = {
      tasks: new Map([
        ["z-last", last],
        ["a-first", first],
      ]),
    } as Pick<DiscoveryResult, "tasks"> as DiscoveryResult;

    assertEquals(
      listProjectRuntimeTasks(discovery).map((task) => task.id),
      ["a-first", "z-last"],
    );
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

  it("logs malformed task candidates while finding by id in debug mode", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/invalid.ts": [
        "export default {",
        "  run() {},",
        '  integrationRequirements: [{ integration: "Slack" }],',
        "};",
      ].join("\n"),
    });
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));

    let task;
    try {
      task = await findTaskById("invalid", {
        projectDir: "/project",
        adapter,
        config: { fs: { type: "veryfront-api" } } as never,
        debug: true,
      });
    } finally {
      unsubscribe();
    }

    assertEquals(task, null);
    assertEquals(
      records.some((entry) =>
        entry.component === "task-discovery" &&
        entry.level === "warn" &&
        entry.message.includes("must use a lowercase integration identifier")
      ),
      true,
    );
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

  it("isolates single-project virtual runtime config by cache key", async () => {
    const firstAdapter = createRuntimeAdapter({
      "/veryfront.config.ts": [
        "export default {",
        '  fs: { type: "veryfront-api", veryfront: { projectSlug: "project-a" } },',
        '  ai: { tasks: { discovery: { paths: ["first-tasks"] } } },',
        "};",
        "",
      ].join("\n"),
      "/project/first-tasks/first.ts": makeTaskSource("First"),
    });
    markAdapterAsSingleProjectVirtual(firstAdapter);

    const first = await discoverProjectTaskRuntime({
      projectDir: "/project",
      adapter: firstAdapter,
      fsAdapter: firstAdapter.fs,
      cacheKey: "project-a",
    });
    assertEquals([...first.tasks.keys()], ["first"]);

    const secondAdapter = createRuntimeAdapter({
      "/veryfront.config.ts": [
        "export default {",
        '  fs: { type: "veryfront-api", veryfront: { projectSlug: "project-b" } },',
        '  ai: { tasks: { discovery: { paths: ["second-tasks"] } } },',
        "};",
        "",
      ].join("\n"),
      "/project/second-tasks/second.ts": makeTaskSource("Second"),
    });
    markAdapterAsSingleProjectVirtual(secondAdapter);

    const second = await discoverProjectTaskRuntime({
      projectDir: "/project",
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

  it("propagates trigger cancellation into task execution", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/cancelled.ts": makeTaskSource("Cancelled"),
    });
    const controller = new AbortController();
    controller.abort(new Error("cancelled trigger execution"));

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
      "cancelled trigger execution",
    );
  });

  it("runs agent targets after project runtime discovery", async () => {
    const adapter = createRuntimeAdapter({
      "/project/agents/scheduled-agent.ts": [
        "export default {",
        '  id: "scheduled-agent",',
        '  config: { id: "scheduled-agent", model: "auto" },',
        "  async generate({ input, context }) {",
        '    return { text: `ran:${input}:${context.schedule_name}`, status: "completed", toolCalls: [] };',
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
        '  config: { id: "failing-agent", model: "auto" },',
        "  async generate() {",
        '    return { text: "failure", status: "error", toolCalls: [] };',
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
          target: { kind: "agent", id: "failing-agent" },
          agentInput: "Run the fixture.",
        }),
      Error,
      'Agent target "failing-agent" failed.',
    );
  });
});
