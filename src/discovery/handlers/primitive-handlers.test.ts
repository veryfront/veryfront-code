import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type Resource, resource, resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import { agentHandler } from "./agent-handler.ts";
import { promptHandler } from "./prompt-handler.ts";
import { resourceHandler } from "./resource-handler.ts";
import { taskHandler } from "./task-handler.ts";
import { prepareDiscoveredTool, toolHandler } from "./tool-handler.ts";
import { workflowHandler } from "./workflow-handler.ts";

Deno.test("tool discovery validates the provider-facing runtime contract", () => {
  const valid = {
    type: "function",
    description: "Search project documents",
    inputSchema: { type: "object", properties: {} },
    execute: () => Promise.resolve([]),
  };

  assertEquals(toolHandler.validate(valid), true);
  assertEquals(toolHandler.validate({ ...valid, description: "" }), false);
  assertEquals(toolHandler.validate({ ...valid, inputSchema: undefined }), false);
  assertEquals(toolHandler.validate({ ...valid, type: "unknown" }), false);
  assertEquals(toolHandler.validate({ execute: valid.execute }), false);
});

Deno.test("tool discovery accepts valid JSON Schemas without a type keyword", () => {
  const literalSchema = {
    anyOf: [{ type: "string" }, { type: "number" }],
  };
  const literalSchemaTool = {
    type: "function",
    description: "Search by string or numeric identifier",
    inputSchema: literalSchema,
    execute: () => Promise.resolve([]),
  };
  const contractSchemaTool = {
    ...literalSchemaTool,
    inputSchema: defineSchema((v) => v.unknown())(),
    inputSchemaJson: {},
  };

  assertEquals(toolHandler.validate(literalSchemaTool), true);
  assertEquals(toolHandler.validate(contractSchemaTool), true);
  const prepared = prepareDiscoveredTool(literalSchemaTool as never, "search");
  literalSchema.anyOf[0]!.type = "boolean";
  assertEquals(prepared.inputSchemaJson, {
    anyOf: [{ type: "string" }, { type: "number" }],
  });
  assertEquals(
    toolHandler.validate({
      ...literalSchemaTool,
      inputSchema: { type: "not-a-json-schema-type" },
    }),
    false,
  );
  assertEquals(
    toolHandler.validate({
      ...literalSchemaTool,
      inputSchema: new Date(),
    }),
    false,
  );
});

Deno.test("tool discovery recognizes the public schema surface without private markers", () => {
  const contract = {} as Record<string, (...args: unknown[]) => unknown>;
  for (
    const method of [
      "optional",
      "nullable",
      "nullish",
      "default",
      "describe",
      "refine",
      "superRefine",
      "transform",
      "strict",
      "strip",
      "passthrough",
      "partial",
      "extend",
      "merge",
      "omit",
      "pick",
      "min",
      "max",
      "int",
      "positive",
      "nonnegative",
      "regex",
      "email",
      "url",
      "uuid",
      "datetime",
      "pipe",
    ]
  ) {
    contract[method] = () => contract;
  }
  contract.parse = (value) => value;
  contract.safeParse = (value) => ({ success: true, data: value });

  assertEquals(
    toolHandler.validate({
      type: "function",
      description: "Custom schema adapter tool",
      inputSchema: contract,
      execute: () => Promise.resolve(),
    }),
    true,
  );
});

Deno.test("agent discovery validates every callable public operation", () => {
  const valid = {
    id: "researcher",
    config: { model: "openai:gpt-4.1" },
    generate: () => Promise.resolve({}),
    stream: () => Promise.resolve({}),
    respond: () => Promise.resolve(new Response()),
    getMemory: () => ({}),
    getMemoryStats: () => Promise.resolve({ totalMessages: 0, estimatedTokens: 0, type: "test" }),
    clearMemory: () => Promise.resolve(),
  };

  assertEquals(agentHandler.validate(valid), true);
  assertEquals(agentHandler.validate({ ...valid, config: undefined }), false);
  assertEquals(agentHandler.validate({ ...valid, stream: undefined }), false);
  assertEquals(agentHandler.validate({ ...valid, clearMemory: undefined }), false);
  assertEquals(agentHandler.validate({ generate: valid.generate }), false);
});

Deno.test("workflow discovery rejects inconsistent or unusable definitions", () => {
  const valid = {
    id: "daily-report",
    definition: {
      id: "daily-report",
      steps: [],
    },
  };

  assertEquals(workflowHandler.validate(valid), true);
  assertEquals(
    workflowHandler.validate({
      ...valid,
      id: "outer-id",
    }),
    false,
  );
  assertEquals(
    workflowHandler.validate({
      ...valid,
      definition: { id: "daily-report", steps: null },
    }),
    false,
  );
  assertEquals(
    workflowHandler.validate({
      ...valid,
      definition: {
        id: "daily-report",
        steps: [{ id: "broken", config: null }],
      },
    }),
    false,
  );
});

Deno.test("resource discovery validates the complete runtime boundary", () => {
  assertEquals(
    resourceHandler.validate({
      description: "Docs",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: () => ({}),
    }),
    true,
  );
  assertEquals(resourceHandler.validate({ load: () => ({}) }), false);
  assertEquals(
    resourceHandler.validate({
      description: "Docs",
      paramsSchema: {},
      load: () => ({}),
    }),
    false,
  );
  assertEquals(
    resourceHandler.validate({
      description: "Docs",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: () => ({}),
      subscribe: "not-a-function",
    }),
    false,
  );
});

Deno.test("resource discovery derives metadata for a valid literal resource export", () => {
  const literal = {
    description: "Docs",
    paramsSchema: defineSchema((v) => v.object({}))(),
    load: () => ({}),
  };

  try {
    assertEquals(resourceHandler.validate(literal), true);
    const registered = resourceHandler.register(
      "docs",
      literal as unknown as Resource,
      "/project/resources/docs.ts",
      "/project/resources",
    );
    assertEquals(registered.id, "docs");
    assertEquals(registered.pattern, "/docs");
  } finally {
    resourceRegistry.delete("docs");
  }
});

Deno.test("resource discovery preserves explicit patterns and replaces generated placeholders", () => {
  const explicit = resource({
    pattern: "docs://project",
    description: "Project docs",
    paramsSchema: defineSchema((v) => v.object({}))(),
    load: () => ({}),
  });
  const generated = resource({
    description: "User profile",
    paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
    load: () => ({}),
  });

  try {
    const registeredExplicit = resourceHandler.register(
      "docs",
      explicit as unknown as Resource,
      "/project/resources/docs.ts",
      "/project/resources",
    );
    assertEquals(registeredExplicit.pattern, "docs://project");

    const registeredGenerated = resourceHandler.register(
      "profile",
      generated as unknown as Resource,
      "/project/resources/users/[id]/profile.ts",
      "/project/resources",
    );
    assertEquals(registeredGenerated.pattern, "/users/:id/profile");
  } finally {
    resourceRegistry.delete("docs");
    resourceRegistry.delete("profile");
  }
});

Deno.test("resource discovery applies parameter transforms exactly once", async () => {
  const discovered = resource({
    description: "Transformed profile",
    paramsSchema: defineSchema((v) =>
      v.object({
        id: v.string().transform((value) => `${value}!`),
      })
    )(),
    load: ({ id }) => id,
  });

  try {
    resourceHandler.register(
      "profile",
      discovered as unknown as Resource,
      "/project/resources/users/[id]/profile.ts",
      "/project/resources",
    );

    const registered = resourceRegistry.get("profile");
    assertEquals(await registered?.load({ id: "ready" }), "ready!");
  } finally {
    resourceRegistry.delete("profile");
  }
});

Deno.test("prompt discovery validates description and optional suggestion", () => {
  assertEquals(
    promptHandler.validate({
      description: "Welcome",
      getContent: () => Promise.resolve("Hello"),
    }),
    true,
  );
  assertEquals(promptHandler.validate({ getContent: () => Promise.resolve("Hello") }), false);
  assertEquals(
    promptHandler.validate({
      description: "Welcome",
      suggestion: 42,
      getContent: () => Promise.resolve("Hello"),
    }),
    false,
  );
  assertEquals(
    promptHandler.validate({
      description: "Welcome",
      getContent: () => Promise.resolve("Hello"),
      mcp: { arguments: [{ name: "topic" }, { name: "topic" }] },
    }),
    false,
  );
});

Deno.test("prompt discovery derives an id for a valid literal prompt export", () => {
  const literal = {
    description: "Welcome",
    getContent: () => Promise.resolve("Hello"),
  };

  try {
    assertEquals(promptHandler.validate(literal), true);
    const id = promptHandler.getId(
      literal as never,
      "/project/prompts/welcome-message.ts",
      "/project/prompts",
    );
    const registered = promptHandler.register(
      id,
      literal as never,
      "/project/prompts/welcome-message.ts",
      "/project/prompts",
    );
    assertEquals(registered.id, "welcomeMessage");
  } finally {
    promptRegistry.delete("welcomeMessage");
  }
});

Deno.test("prompt discovery preserves explicit ids and replaces generated placeholders", () => {
  const explicit = {
    id: "configured_prompt",
    description: "Configured",
    getContent: () => Promise.resolve("Configured"),
  };
  assertEquals(
    promptHandler.getId(explicit, "/project/prompts/file-name.ts", "/project/prompts"),
    "configured_prompt",
  );

  const generated = {
    ...explicit,
    id: "prompt_123_0",
    __veryfrontGeneratedId: "prompt_123_0",
  };
  assertEquals(
    promptHandler.getId(generated, "/project/prompts/file-name.ts", "/project/prompts"),
    "fileName",
  );
});

Deno.test("task discovery derives portable ids and rejects paths outside its root", () => {
  const task = { run() {} };

  assertEquals(
    taskHandler.getId(
      task,
      "file:///C:/project/tasks/reports/daily.ts",
      String.raw`C:\project\tasks`,
    ),
    "reports/daily",
  );
  assertThrows(
    () =>
      taskHandler.getId(
        task,
        "/project/other/daily.ts",
        "/project/tasks",
      ),
    Error,
    "outside discovery directory",
  );
});
