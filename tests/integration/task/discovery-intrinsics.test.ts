import "#veryfront/schemas/_test-setup.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { discoverAll } from "#veryfront/discovery";
import { taskHandler } from "#veryfront/discovery/handlers/task-handler.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { isTaskDefinition, type TaskDefinition } from "#veryfront/task/types.ts";

function createMockAdapter(files: Record<string, string>): FileSystemAdapter {
  const normalize = (path: string): string => path.replace(/^\/project\/?/, "").replace(/^\/+/, "");
  const normalizedFiles = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [normalize(path), content]),
  );

  return {
    async readFile(path: string): Promise<string> {
      const content = normalizedFiles[normalize(path)];
      if (content === undefined) {
        throw Object.assign(new Error(`File not found: ${path}`), { code: "ENOENT" });
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

describe("task discovery with hostile ambient intrinsics", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  it("uses captured reflection primitives after module initialization", () => {
    const originalApply = Reflect.apply;
    const originalGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
    const originalGetPrototypeOf = Reflect.getPrototypeOf;
    const originalOwnKeys = Reflect.ownKeys;
    const originalDefineProperty = Object.defineProperty;
    const originalArrayIterator = Array.prototype[Symbol.iterator];
    const originalIsArray = Array.isArray;
    const originalMapGet = Map.prototype.get;
    const originalMapHas = Map.prototype.has;
    const originalMapSet = Map.prototype.set;
    const originalHasOwn = Object.hasOwn;
    const originalFreeze = Object.freeze;
    const originalValues = Object.values;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
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
      required: ["name"],
      properties: { name: { type: "string" } },
    };

    try {
      Reflect.apply = poison;
      Reflect.getOwnPropertyDescriptor = poison;
      Reflect.getPrototypeOf = poison;
      Reflect.ownKeys = poison;
      Object.defineProperty = poison;
      Array.prototype[Symbol.iterator] = poison as typeof originalArrayIterator;
      Array.isArray = poison as unknown as typeof Array.isArray;
      Map.prototype.get = poison as typeof Map.prototype.get;
      Map.prototype.has = poison as typeof Map.prototype.has;
      Map.prototype.set = poison as typeof Map.prototype.set;
      Object.hasOwn = poison;
      Object.freeze = freezePoison;
      Object.values = poison;
      Set.prototype.add = poison as typeof Set.prototype.add;
      Set.prototype.has = poison as typeof Set.prototype.has;

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
      Array.prototype[Symbol.iterator] = originalArrayIterator;
      Array.isArray = originalIsArray;
      Map.prototype.get = originalMapGet;
      Map.prototype.has = originalMapHas;
      Map.prototype.set = originalMapSet;
      Object.hasOwn = originalHasOwn;
      Object.freeze = originalFreeze;
      Object.values = originalValues;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
    }

    sourceInputSchema.properties.name.type = "number";
    sourceInputSchema.required[0] = "mutated";
    assertEquals(output, "stable");
    assertEquals(poisonCalls, 0);
    assertEquals(freezePoisonCalls, 0);
    assertEquals(inputSchema, {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    });
    assertEquals(inputSchema === sourceInputSchema, false);
    assertEquals(Object.isFrozen(inputSchema), true);
    assertEquals(Object.isFrozen(inputSchema?.required), true);
    assertEquals(Object.isFrozen(inputSchema?.properties), true);
    assertEquals(Object.isFrozen(requirements), true);
    assertEquals(Object.isFrozen(requirements?.[0]), true);
    assertEquals(Object.isFrozen(requirements?.[0]?.requiredScopes), true);
    assertEquals(Object.isFrozen(requirements?.[0]?.resources), true);
    assertEquals(Object.isFrozen(requirements?.[0]?.resources?.[0]), true);
    assertEquals(Object.isFrozen(requirements?.[0]?.resources?.[0]?.parent), true);
  });

  it("keeps JSON schemas detached after serialization primordial poisoning", () => {
    const originalStringify = JSON.stringify;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient JSON.stringify must not run");
    };
    const sourceInputSchema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    let inputSchema: TaskDefinition["inputSchema"];

    try {
      JSON.stringify = poison;
      inputSchema = taskHandler.register(
        "stable-json-schema",
        { run() {}, inputSchema: sourceInputSchema },
        "tasks/stable-json-schema.ts",
        "tasks",
      ).inputSchema;
    } finally {
      JSON.stringify = originalStringify;
    }

    sourceInputSchema.properties.name.type = "number";
    assertEquals(poisonCalls, 0);
    assertEquals(inputSchema, {
      type: "object",
      properties: { name: { type: "string" } },
    });
    assertEquals(inputSchema === sourceInputSchema, false);
    assertEquals(Object.isFrozen(inputSchema), true);
    assertEquals(Object.isFrozen(inputSchema?.properties), true);
  });

  it("deeply freezes JSON schemas without ambient array iteration", () => {
    const originalIterator = Array.prototype[Symbol.iterator];
    const sourceInputSchema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    let inputSchema: TaskDefinition["inputSchema"];

    try {
      Array.prototype[Symbol.iterator] = function (this: unknown[]) {
        if (this.length === 2 && this[0] === "object" && typeof this[1] === "object") {
          return Reflect.apply(originalIterator, [], []);
        }
        return Reflect.apply(originalIterator, this, []);
      };
      inputSchema = taskHandler.register(
        "stable-json-schema-iteration",
        { run() {}, inputSchema: sourceInputSchema },
        "tasks/stable-json-schema-iteration.ts",
        "tasks",
      ).inputSchema;
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    assertEquals(Object.isFrozen(inputSchema), true);
    assertEquals(Object.isFrozen(inputSchema?.properties), true);
    assertEquals(
      Object.isFrozen((inputSchema?.properties as { name: { type: string } }).name),
      true,
    );
  });

  it("rejects duplicate integration resources after JSON primordial poisoning", () => {
    const originalStringify = JSON.stringify;
    let poisonCalls = 0;
    try {
      JSON.stringify = (() => `poison-${++poisonCalls}`) as typeof JSON.stringify;
      assertThrows(
        () =>
          taskHandler.register(
            "duplicate-resources",
            {
              run() {},
              integrationRequirements: [{
                integration: "slack",
                resources: [
                  { kind: "channel", id: "C012345" },
                  { kind: "channel", id: "C012345" },
                ],
              }],
            },
            "tasks/duplicate-resources.ts",
            "tasks",
          ),
        Error,
        "integrationRequirements[0].resources contains a duplicate resource identity",
        "duplicate integration resources are rejected with the registry validation error",
      );
    } finally {
      JSON.stringify = originalStringify;
    }
    assertEquals(poisonCalls, 0);
  });

  it("does not treat Object.prototype.run pollution as a task export", async () => {
    const adapter = createRuntimeAdapter({
      "/project/tasks/config.ts": [
        'export const config = { mode: "safe" };',
        "export const helper = {};",
      ].join("\n"),
    });
    Object.defineProperty(Object.prototype, "run", {
      configurable: true,
      value: () => "polluted",
    });

    try {
      assertEquals(isTaskDefinition({}), false);
      const result = await discoverAll({
        baseDir: "/project",
        fsAdapter: adapter.fs,
        allowHostProjectCodeExecution: true,
      });
      assertEquals(result.errors, []);
      assertEquals([...result.tasks.keys()], []);
    } finally {
      delete (Object.prototype as Record<string, unknown>).run;
    }
  });
});
