import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { taskHandler } from "#veryfront/discovery/handlers/task-handler.ts";
import { deriveTaskId } from "#veryfront/task/discovery.ts";
import { isTaskDefinition } from "#veryfront/task/types.ts";

describe("task/discovery pure contracts", () => {
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
});
