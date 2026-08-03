import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { dynamicTool, tool } from "./factory.ts";

describe("tool factory", () => {
  describe("tool()", () => {
    it("should create a tool with explicit id", () => {
      const t = tool({
        id: "my-tool",
        description: "A test tool",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: async () => "result",
      });
      assertEquals(t.id, "my-tool");
      assertEquals(t.type, "function");
      assertEquals(t.description, "A test tool");
    });

    it("should preserve delegated integration tool dependencies", () => {
      const t = tool({
        id: "github-list-issues",
        description: "List GitHub issues through a bounded wrapper",
        delegatedIntegrationTools: ["github__list_issues"],
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => [],
      });

      assertEquals(t.delegatedIntegrationTools, ["github__list_issues"]);
    });

    it("should auto-generate id when not provided", () => {
      const t = tool({
        description: "auto-id",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });
      assertStringIncludes(t.id, "tool_");
      assertEquals(t.__veryfrontGeneratedId, t.id);
    });

    it("should not mark explicit ids that happen to match the generated-id pattern", () => {
      const t = tool({
        id: "tool_2024_01",
        description: "explicit generated-looking id",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });
      assertEquals(t.id, "tool_2024_01");
      assertEquals(t.__veryfrontGeneratedId, undefined);
    });

    it("should preserve an explicit id assigned after creation", () => {
      const generated = tool({
        description: "auto-id",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
      });
      const overridden = { ...generated, id: "my-tool" };
      assertEquals(overridden.id, "my-tool");
      assertStringIncludes(generated.id, "tool_");
      assertEquals(overridden.__veryfrontGeneratedId, generated.id);
    });

    it("should convert Veryfront schema to JSON schema", () => {
      const t = tool({
        id: "schema-test",
        description: "desc",
        inputSchema: defineSchema((v) =>
          v.object({
            name: v.string(),
            age: v.number(),
          })
        )(),
        execute: async () => null,
      });
      assertEquals(t.inputSchemaJson?.type, "object");
      assertEquals(t.inputSchemaJson?.properties?.name, { type: "string" });
      assertEquals(t.inputSchemaJson?.properties?.age, { type: "number" });
      assertEquals(t.inputSchemaJson?.required?.includes("name"), true);
      assertEquals(t.inputSchemaJson?.required?.includes("age"), true);
    });

    it("should preserve raw JSON input and output schemas", async () => {
      const inputSchema: JsonSchema = {
        type: "object",
        properties: {
          min: { type: "number" },
          max: { type: "number" },
        },
        required: ["min", "max"],
        additionalProperties: false,
      } as const;
      const outputSchema = {
        type: "object",
        properties: {
          randomNumber: { type: "number" },
        },
        required: ["randomNumber"],
        additionalProperties: false,
      } as const;

      const t = tool({
        id: "number-generator",
        description: "Generates a random number within a specified range.",
        inputSchema,
        outputSchema,
        execute: async (input) => {
          const args = input as { min: number; max: number };
          return { randomNumber: args.min + args.max };
        },
      });

      assertEquals(t.inputSchemaJson, inputSchema);
      assertEquals(t.outputSchemaJson, outputSchema);
      assertEquals(await t.execute({ min: 3, max: 9 }), { randomNumber: 12 });
    });

    it("should preserve an output schema and converted JSON schema", () => {
      const t = tool({
        id: "output-schema-test",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        outputSchema: defineSchema((v) => v.object({ result: v.string() }))(),
        execute: async () => ({ result: "ok" }),
      });

      assertEquals(t.outputSchemaJson?.type, "object");
      assertEquals(t.outputSchemaJson?.properties?.result, { type: "string" });
    });

    it("should accept valid raw JSON schemas that omit the type keyword", () => {
      const t = tool({
        id: "union-schema",
        description: "desc",
        inputSchema: {
          anyOf: [
            { type: "object", required: ["query"] },
            { $ref: "#/$defs/defaultQuery" },
          ],
          $defs: {
            defaultQuery: { type: "object" },
          },
        },
        execute: async () => null,
      });

      assertEquals(t.inputSchemaJson, {
        anyOf: [
          { type: "object", required: ["query"] },
          { $ref: "#/$defs/defaultQuery" },
        ],
        $defs: {
          defaultQuery: { type: "object" },
        },
      });
    });

    it("should accept raw JSON schemas whose only keyword is a constraint", () => {
      // Each of these is a valid schema carrying no structural keyword, so an
      // allowlist limited to the structural vocabulary rejects them outright.
      const constraintSchemas = [
        { pattern: "^[a-z]+$" },
        { minimum: 0 },
        { maxItems: 10 },
        { propertyNames: { pattern: "^x-" } },
      ];

      for (const inputSchema of constraintSchemas) {
        const t = tool({
          id: "constraint-schema",
          description: "desc",
          inputSchema,
          execute: async () => null,
        });

        assertEquals(t.inputSchemaJson, inputSchema);
      }
    });

    it("should reject schema-like raw objects by default", () => {
      assertThrows(
        () =>
          tool({
            id: "shape-test",
            description: "desc",
            inputSchema: {
              _def: {
                shape: {
                  name: {},
                  age: {},
                },
              },
            } as unknown as Schema<unknown>,
            execute: async () => null,
          }),
        Error,
        "input schema is not a valid Veryfront schema",
      );
    });

    it("should reject invalid unknown schemas when permissive fallback is disabled", () => {
      for (
        const inputSchema of [{}, new Date(), { _def: { shape: {} } }] as unknown as Schema<
          unknown
        >[]
      ) {
        assertThrows(
          () =>
            tool({
              id: "invalid-schema",
              description: "desc",
              inputSchema,
              execute: async () => null,
            }),
          Error,
          "input schema is not a valid Veryfront schema",
        );
      }
    });

    it("should fall back to permissive schema with allowUnknownSchema", () => {
      const t = tool({
        id: "permissive-tool",
        description: "desc",
        inputSchema: {} as Schema<unknown>,
        execute: async () => null,
        allowUnknownSchema: true,
      });
      assertEquals(t.inputSchemaJson?.type, "object");
      assertEquals(t.inputSchemaJson?.additionalProperties, true);
    });

    it("should preserve mcp config", () => {
      const t = tool({
        id: "mcp-tool",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
        mcp: { enabled: true, requiresAuth: false, cachePolicy: "cache" },
      });
      assertEquals(t.mcp?.enabled, true);
      assertEquals(t.mcp?.cachePolicy, "cache");
    });

    it("rejects MCP config descriptor traps with a framework schema error", () => {
      const mcp = new Proxy({ enabled: true }, {
        ownKeys: () => ["enabled"],
        getOwnPropertyDescriptor: () => {
          throw new Error("descriptor trap must not escape");
        },
      });

      assertThrows(
        () =>
          tool({
            id: "hostile-mcp-config",
            description: "desc",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: async () => null,
            mcp,
          }),
        Error,
        "MCP configuration must contain only data properties",
      );
    });

    it("rejects transparent MCP config proxies before descriptor inspection", () => {
      const mcp = new Proxy({ enabled: true }, {});

      assertThrows(
        () =>
          tool({
            id: "proxied-mcp-config",
            description: "desc",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: async () => null,
            mcp,
          }),
        Error,
        "MCP configuration must contain only data properties",
      );
    });

    it("rejects MCP accessors despite descriptor prototype pollution", () => {
      const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let accessorCalls = 0;
      const mcp = Object.defineProperty({}, "enabled", {
        enumerable: true,
        get() {
          accessorCalls += 1;
          throw new Error("MCP accessors must not run");
        },
      });
      let thrown: unknown;

      try {
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          value: true,
          writable: true,
        });

        try {
          tool({
            id: "accessor-mcp-config",
            description: "desc",
            inputSchema: { type: "object" },
            execute: async () => null,
            mcp,
          });
        } catch (error) {
          thrown = error;
        }
      } finally {
        if (originalValue) {
          Object.defineProperty(Object.prototype, "value", originalValue);
        } else {
          Reflect.deleteProperty(Object.prototype, "value");
        }
      }

      assertEquals(thrown instanceof Error, true);
      assertEquals(accessorCalls, 0);
    });

    it("copies special MCP property names without changing object prototypes", () => {
      const mcp = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(mcp, "__proto__", {
        enumerable: true,
        value: { polluted: true },
      });
      Object.defineProperty(mcp, "enabled", {
        enumerable: true,
        value: true,
      });

      const result = tool({
        id: "special-key-mcp-config",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => null,
        mcp,
      }).mcp as Record<string, unknown>;

      assertEquals(Object.getPrototypeOf(result), Object.prototype);
      assertEquals(Object.getOwnPropertyDescriptor(result, "__proto__")?.value, {
        polluted: true,
      });
      assertEquals(({} as { polluted?: boolean }).polluted, undefined);
    });

    it("loads MCP config through structured clone when proxy detection is unavailable", async () => {
      const script = `
        Object.defineProperty(globalThis, "caches", {
          configurable: true,
          value: {},
        });
        Object.defineProperty(globalThis, "WebSocketPair", {
          configurable: true,
          value: function WebSocketPair() {},
        });

        const {
          canIdentifyProxyWithoutHooks,
        } = await import("./src/platform/compat/error-introspection.ts");
        const { tool } = await import("./src/tool/factory.ts");

        let trapCalls = 0;
        const plainMcp = {
          enabled: true,
          title: "Edge tool",
          annotations: { readOnlyHint: true },
        };
        const proxiedMcp = new Proxy({ enabled: true }, {
          ownKeys() {
            trapCalls += 1;
            throw new Error("ownKeys trap must not escape");
          },
          getOwnPropertyDescriptor() {
            trapCalls += 1;
            throw new Error("descriptor trap must not escape");
          },
        });
        const result = {
          canIdentifyProxyWithoutHooks,
          trapCalls,
          plainMcp: undefined,
          proxyMessage: "",
        };
        result.plainMcp = tool({
          id: "edge-mcp-config",
          description: "desc",
          inputSchema: { type: "object" },
          execute: async () => null,
          mcp: plainMcp,
        }).mcp;
        try {
          tool({
            id: "edge-mcp-config-proxy",
            description: "desc",
            inputSchema: { type: "object" },
            execute: async () => null,
            mcp: proxiedMcp,
          });
        } catch (error) {
          result.proxyMessage = error instanceof Error ? error.message : String(error);
          result.trapCalls = trapCalls;
        }
        console.log(JSON.stringify(result));
      `;
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["eval", "--config=deno.json", script],
        cwd: new URL("../../", import.meta.url),
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stderr = new TextDecoder().decode(output.stderr);
      assertEquals(output.code, 0, stderr);

      const result = JSON.parse(new TextDecoder().decode(output.stdout));
      assertEquals(result, {
        canIdentifyProxyWithoutHooks: false,
        trapCalls: 0,
        plainMcp: {
          enabled: true,
          title: "Edge tool",
          annotations: { readOnlyHint: true },
        },
        proxyMessage:
          'Tool "edge-mcp-config-proxy" MCP configuration must contain only data properties',
      });
    });

    it("snapshots raw schemas and metadata at construction", () => {
      const inputSchema: JsonSchema = {
        type: "object",
        properties: { query: { type: "string" } },
      };
      const delegatedIntegrationTools = ["github__search"];
      const mcp = {
        title: "Search",
        annotations: { readOnlyHint: true },
      };
      const t = tool({
        id: "snapshot-tool",
        description: "desc",
        inputSchema,
        delegatedIntegrationTools,
        mcp,
        execute: async () => null,
      });

      inputSchema.properties!.query!.type = "number";
      delegatedIntegrationTools[0] = "github__delete";
      mcp.title = "Mutated";
      mcp.annotations.readOnlyHint = false;

      assertEquals(t.inputSchemaJson, {
        type: "object",
        properties: { query: { type: "string" } },
      });
      assertEquals(t.delegatedIntegrationTools, ["github__search"]);
      assertEquals(t.mcp, {
        title: "Search",
        annotations: { readOnlyHint: true },
      });
    });
  });

  describe("tool execute()", () => {
    it("should validate input and execute", async () => {
      const t = tool({
        id: "exec-test",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({ value: v.string() }))(),
        execute: async ({ value }) => `Got: ${value}`,
      });
      const result = await t.execute({ value: "hello" });
      assertEquals(result, "Got: hello");
    });

    it("should throw on invalid input", async () => {
      const t = tool({
        id: "validate-test",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({ value: v.string() }))(),
        execute: async () => "ok",
      });
      await assertRejects(
        () => t.execute({ value: 123 } as unknown as { value: string }),
        Error,
        "input validation failed",
      );
    });

    it("should pass execution context to handler", async () => {
      let receivedCtx: unknown;
      const t = tool({
        id: "ctx-test",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async (_input, ctx) => {
          receivedCtx = ctx;
          return null;
        },
      });
      const ctx = { agentId: "agent-1", projectId: "proj-1" };
      await t.execute({}, ctx);
      assertEquals((receivedCtx as Record<string, unknown>).agentId, "agent-1");
    });

    it("should support sync execute functions", async () => {
      const t = tool({
        id: "sync-exec",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({ x: v.number() }))(),
        execute: ({ x }) => x * 2,
      });
      const result = await t.execute({ x: 5 });
      assertEquals(result, 10);
    });

    it("should forward parsed defaults and transforms to execute", async () => {
      let received: unknown;
      const t = tool({
        id: "parsed-forward",
        description: "desc",
        inputSchema: defineSchema((v) =>
          v.object({
            limit: v.number().default(10),
            tag: v.string().transform((s) => `tag:${s}`),
          })
        )(),
        execute: (input) => {
          received = input;
          return input;
        },
      });
      const result = await t.execute({ tag: "foo" } as unknown as {
        limit: number;
        tag: string;
      });
      assertEquals(received, { limit: 10, tag: "tag:foo" });
      assertEquals(result, { limit: 10, tag: "tag:foo" });
    });

    it("uses the parser and handler admitted at construction", async () => {
      const originalSchema = defineSchema((v) => v.object({ value: v.string() }))();
      const config = {
        id: "stable-contract",
        description: "desc",
        inputSchema: originalSchema,
        execute: ({ value }: { value: string }) => `original:${value}`,
      };
      const t = tool(config);

      config.inputSchema = defineSchema((v) =>
        v.object({ value: v.string().transform((value) => `mutated:${value}`) })
      )();
      config.execute = ({ value }) => `replacement:${value}`;

      assertEquals(await t.execute({ value: "input" }), "original:input");
    });
  });

  describe("dynamicTool()", () => {
    it("should create a dynamic tool with permissive schema", () => {
      const t = dynamicTool({
        id: "dynamic",
        description: "A dynamic tool",
        inputSchema: {},
        execute: async () => "done",
      });
      assertEquals(t.id, "dynamic");
      assertEquals(t.type, "dynamic");
      assertEquals(t.inputSchemaJson?.additionalProperties, true);
    });

    it("should apply toModelOutput transform in execute return value", async () => {
      const t = dynamicTool({
        id: "transform",
        description: "desc",
        inputSchema: {},
        execute: async () => ({ raw: "data" }),
        toModelOutput: (output) => `transformed: ${JSON.stringify(output)}`,
      });
      const result = await t.execute({});
      assertEquals(result, 'transformed: {"raw":"data"}');
    });

    it("should pass through output when no toModelOutput", async () => {
      const t = dynamicTool({
        id: "passthrough",
        description: "desc",
        inputSchema: {},
        execute: async () => ({ value: 42 }),
      });
      const result = await t.execute({});
      assertEquals(result, { value: 42 });
    });

    it("should auto-generate id when not provided", () => {
      const t = dynamicTool({
        description: "auto-id",
        inputSchema: {},
        execute: async () => null,
      });
      assertStringIncludes(t.id, "tool_");
    });

    it("should preserve an explicit JSON schema override", () => {
      const t = dynamicTool({
        id: "remote-dynamic",
        description: "Remote dynamic tool",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        inputSchemaJson: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        execute: async () => null,
      });
      assertEquals(t.inputSchemaJson, {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      });
    });

    it("snapshots explicit schemas and execution callbacks at construction", async () => {
      const inputSchemaJson: JsonSchema = {
        type: "object",
        properties: { query: { type: "string" } },
      };
      const config = {
        id: "stable-dynamic",
        description: "desc",
        inputSchema: {},
        inputSchemaJson,
        execute: async () => "original",
        toModelOutput: (output: unknown) => `model:${String(output)}`,
      };
      const t = dynamicTool(config);

      inputSchemaJson.properties!.query!.type = "number";
      config.execute = async () => "replacement";
      config.toModelOutput = () => "replacement-output";

      assertEquals(t.inputSchemaJson, {
        type: "object",
        properties: { query: { type: "string" } },
      });
      assertEquals(await t.execute({}), "model:original");
    });
  });

  describe("dynamicTool input validation", () => {
    it("should validate input with a Veryfront schema", async () => {
      const t = dynamicTool({
        id: "zod-validate",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: async (input) => input,
      });
      const result = await t.execute({ query: "test" });
      assertEquals(result, { query: "test" });
    });

    it("should reject invalid input when a Veryfront schema is provided", async () => {
      const t = dynamicTool({
        id: "zod-reject",
        description: "desc",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: async () => "ok",
      });
      await assertRejects(
        () => t.execute({ query: 123 }),
        Error,
      );
    });

    it("should forward parsed defaults and transforms to execute", async () => {
      let received: unknown;
      const t = dynamicTool({
        id: "dyn-parsed-forward",
        description: "desc",
        inputSchema: defineSchema((v) =>
          v.object({
            limit: v.number().default(10),
            tag: v.string().transform((s) => `tag:${s}`),
          })
        )(),
        execute: (input) => {
          received = input;
          return input;
        },
      });
      const result = await t.execute({ tag: "foo" });
      assertEquals(received, { limit: 10, tag: "tag:foo" });
      assertEquals(result, { limit: 10, tag: "tag:foo" });
    });

    it("should accept valid object input without a schema", async () => {
      const t = dynamicTool({
        id: "no-schema-obj",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      const result = await t.execute({ foo: "bar" });
      assertEquals(result, { foo: "bar" });
    });

    it("should reject null input without schema", async () => {
      const t = dynamicTool({
        id: "no-schema-null",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      await assertRejects(
        () => t.execute(null),
        Error,
        "input must be a non-null object",
      );
    });

    it("should coerce undefined input to empty object for zero-input tools", async () => {
      const t = dynamicTool({
        id: "no-schema-undef",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      const result = await t.execute(undefined);
      assertEquals(result, {});
    });

    it("should reject primitive input without schema", async () => {
      const t = dynamicTool({
        id: "no-schema-prim",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      await assertRejects(
        () => t.execute("string-input"),
        Error,
        "input must be a non-null object",
      );
    });
  });
});
