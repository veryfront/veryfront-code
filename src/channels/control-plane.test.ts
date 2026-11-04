import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import "#veryfront/schemas/_test-setup.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { schemaToJsonSchema } from "#veryfront/schemas/json-schema.ts";
import { schemaIdentitySha256 } from "#veryfront/schemas/schema-identity.ts";
import type { Agent, SuggestionsConfig } from "#veryfront/agent";
import { createRuntimeAgentFromMarkdownDefinition } from "#veryfront/agent";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  isConfigOptionalControlPlaneRunRequest,
  listRuntimeAgents,
  resolveAgentSkills,
  RuntimeAgentListResponseSchema,
} from "./control-plane.ts";

function createHandlerContext(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: null,
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
  } as unknown as HandlerContext;
}

function createAgent(overrides: {
  id?: string;
  name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  description?: string;
  model?: string;
  version?: string;
  skills?: true | string[];
  suggestions?: SuggestionsConfig;
  outputSchema?: unknown;
} = {}): Agent {
  return {
    id: overrides.id ?? "agent-1",
    config: {
      system: "You are helpful.",
      model: overrides.model ?? "anthropic/claude-sonnet-4-6",
      name: overrides.name ?? "Support",
      avatarUrl: overrides.avatarUrl,
      avatar_url: overrides.avatar_url,
      description: overrides.description ?? "Helps with support questions",
      version: overrides.version ?? "2.0.0",
      skills: overrides.skills,
      suggestions: overrides.suggestions,
      outputSchema: overrides.outputSchema,
    } as unknown as Agent["config"],
    generate: async () => ({}) as never,
    stream: async () => ({ toDataStreamResponse: () => new Response() } as never),
    respond: async () => new Response(),
    getMemory: () => ({} as never),
    getMemoryStats: async () => ({
      totalMessages: 0,
      estimatedTokens: 0,
      type: "conversation",
    }),
    clearMemory: async () => {},
  };
}

describe("control-plane run route classification", () => {
  for (
    const { method, pathname } of [
      { method: "POST", pathname: "/api/control-plane/runs/run_1/stream" },
      { method: "POST", pathname: "/api/control-plane/runs/run_1/resume" },
      { method: "DELETE", pathname: "/api/control-plane/runs/run_1" },
    ]
  ) {
    it(`treats ${method} ${pathname} as config optional`, () => {
      assertEquals(isConfigOptionalControlPlaneRunRequest(method, pathname), true);
    });
  }

  for (
    const { method, pathname } of [
      { method: "POST", pathname: "/api/control-plane/runs/run_1/execute" },
      { method: "GET", pathname: "/api/control-plane/runs/run_1/stream" },
      { method: "DELETE", pathname: "/api/control-plane/runs/run_1/extra" },
      { method: "POST", pathname: "/page" },
    ]
  ) {
    it(`keeps ${method} ${pathname} strict`, () => {
      assertEquals(isConfigOptionalControlPlaneRunRequest(method, pathname), false);
    });
  }
});

describe("channels/control-plane", () => {
  describe("listRuntimeAgents", () => {
    it("qualifies boolean output only in the complete pair and omits unknown conversions", async () => {
      for (const outputSchema of [true, false, { invalid: () => "secret" }]) {
        const response = await listRuntimeAgents(createHandlerContext(), {
          ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
          getAgent: () => createAgent({ outputSchema }),
          getAllAgentIds: () => ["assistant"],
        });
        const entry = response.agents[0]!;
        assertEquals(entry.output_schema, undefined);
        if (typeof outputSchema === "boolean") {
          assertEquals(entry.schema_snapshot?.state, "captured");
          assertEquals(entry.schema_snapshot?.input, null);
          assertEquals(entry.schema_snapshot?.output?.schema, outputSchema);
          assertEquals(entry.schema_snapshot?.output?.sha256.length, 64);
        } else {
          assertEquals(entry.schema_snapshot, undefined);
        }
      }
    });

    it("returns canonical runtime agents sorted by name", async () => {
      let discoveryCalls = 0;

      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
          return createEmptyDiscoveryResult();
        },
        getAgent: (id) => {
          if (id === "assistant-b") {
            return createAgent({
              id,
              name: "Beta",
              description: "Second assistant",
              model: "openai/gpt-5",
              version: "1.1.0",
            });
          }

          if (id === "assistant-a") {
            return createAgent({
              id,
              name: "Alpha",
              description: "Primary assistant",
              model: "anthropic/claude-sonnet-4-6",
              version: "2.0.0",
            });
          }

          return undefined;
        },
        getAllAgentIds: () => ["assistant-b", "assistant-a"],
      });

      assertEquals(discoveryCalls, 1);
      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [
            {
              id: "assistant-a",
              name: "Alpha",
              description: "Primary assistant",
              model: "anthropic/claude-sonnet-4-6",
              version: "2.0.0",
              schema_snapshot: { version: 1, state: "captured", input: null, output: null },
              skills: [],
            },
            {
              id: "assistant-b",
              name: "Beta",
              description: "Second assistant",
              model: "openai/gpt-5",
              version: "1.1.0",
              schema_snapshot: { version: 1, state: "captured", input: null, output: null },
              skills: [],
            },
          ],
        }),
      );
    });

    it("filters missing agents and falls back to the runtime id when config metadata is absent", async () => {
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant-z"
            ? {
              ...createAgent({ id }),
              config: {
                system: "You are helpful.",
                name: "",
              } as unknown as Agent["config"],
            }
            : undefined,
        getAllAgentIds: () => ["assistant-z", "assistant-missing"],
      });

      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [{
            id: "assistant-z",
            name: "assistant-z",
            description: null,
            model: null,
            version: null,
            schema_snapshot: { version: 1, state: "captured", input: null, output: null },
            skills: [],
          }],
        }),
      );
    });

    it("uses the registry id for discovered agents whose factory id was auto-generated", async () => {
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "researcher"
            ? {
              ...createAgent({ id: "agent_123" }),
              config: {
                system: "You are helpful.",
                name: "",
              } as unknown as Agent["config"],
            }
            : undefined,
        getAllAgentIds: () => ["researcher"],
      });

      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [{
            id: "researcher",
            name: "researcher",
            description: null,
            model: null,
            version: null,
            schema_snapshot: { version: 1, state: "captured", input: null, output: null },
            skills: [],
          }],
        }),
      );
    });

    it("returns markdown-defined runtime agents from the same registry contract", async () => {
      const markdownAgent = createRuntimeAgentFromMarkdownDefinition({
        id: "support",
        name: "Support",
        description: "Helps users",
        model: "openai/gpt-5.4",
        maxSteps: 4,
        instructions: "Help users from markdown.",
      });

      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) => id === "support" ? markdownAgent : undefined,
        getAllAgentIds: () => ["support"],
      });

      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [{
            id: "support",
            name: "Support",
            description: "Helps users",
            model: "openai/gpt-5.4",
            version: null,
            schema_snapshot: { version: 1, state: "captured", input: null, output: null },
            skills: [],
          }],
        }),
      );
    });

    it("includes resolved skill metadata for agents with an omitted selector", async () => {
      skillRegistryInternal.clearAll();
      registerSkill("writer-helper", {
        id: "writer-helper",
        metadata: {
          name: "Writer Helper",
          description: "Turns rough notes into polished copy",
        },
        rootPath: "/project/skills/writer-helper",
      });

      try {
        const response = await listRuntimeAgents(createHandlerContext(), {
          ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
          getAgent: (id) => id === "assistant" ? createAgent({ id }) : undefined,
          getAllAgentIds: () => ["assistant"],
        });

        assertEquals(
          response,
          RuntimeAgentListResponseSchema.parse({
            agents: [{
              id: "assistant",
              name: "Support",
              description: "Helps with support questions",
              model: "anthropic/claude-sonnet-4-6",
              version: "2.0.0",
              schema_snapshot: { version: 1, state: "captured", input: null, output: null },
              skills: [{
                id: "writer-helper",
                name: "Writer Helper",
                description: "Turns rough notes into polished copy",
              }],
            }],
          }),
        );
      } finally {
        skillRegistryInternal.clearAll();
      }
    });

    it("includes typed suggestions when an agent defines them", async () => {
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant"
            ? createAgent({
              id,
              suggestions: {
                welcomeMessage: "How can I help you?",
                suggestions: [
                  {
                    type: "prompt",
                    title: "Plan work",
                    prompt: "Help me turn this idea into a concrete plan.",
                  },
                  {
                    type: "prompt",
                    id: "project-planning-prompt",
                  },
                  {
                    type: "task",
                    id: "research-topic",
                  },
                ],
              },
            })
            : undefined,
        getAllAgentIds: () => ["assistant"],
      });

      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [{
            id: "assistant",
            name: "Support",
            description: "Helps with support questions",
            model: "anthropic/claude-sonnet-4-6",
            version: "2.0.0",
            schema_snapshot: { version: 1, state: "captured", input: null, output: null },
            skills: [],
            suggestions: {
              welcomeMessage: "How can I help you?",
              suggestions: [
                {
                  type: "prompt",
                  title: "Plan work",
                  prompt: "Help me turn this idea into a concrete plan.",
                },
                {
                  type: "prompt",
                  id: "project-planning-prompt",
                },
                {
                  type: "task",
                  id: "research-topic",
                },
              ],
            },
          }],
        }),
      );
    });

    it("normalizes flat Studio suggestions for runtime clients", async () => {
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant"
            ? createAgent({
              id,
              suggestions: [
                "Review status",
                {
                  title: "Summarize",
                  prompt: "Summarize the latest context.",
                },
                {
                  type: "prompt",
                  title: "Plan work",
                  prompt: "Turn this idea into a concrete plan.",
                },
              ],
            })
            : undefined,
        getAllAgentIds: () => ["assistant"],
      });

      assertEquals(response.agents[0]?.suggestions, {
        suggestions: [
          {
            type: "prompt",
            title: "Review status",
            prompt: "Review status",
          },
          {
            type: "prompt",
            title: "Summarize",
            prompt: "Summarize the latest context.",
          },
          {
            type: "prompt",
            title: "Plan work",
            prompt: "Turn this idea into a concrete plan.",
          },
        ],
      });
    });

    it("serializes a source avatarUrl as control-plane avatar_url", async () => {
      const avatarUrl = "https://cdn.example.com/agents/support.svg";
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant"
            ? createAgent({
              id,
              avatarUrl,
            })
            : undefined,
        getAllAgentIds: () => ["assistant"],
      });

      assertEquals(response.agents[0]?.avatar_url, avatarUrl);
      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [{
            id: "assistant",
            name: "Support",
            avatar_url: avatarUrl,
            description: "Helps with support questions",
            model: "anthropic/claude-sonnet-4-6",
            version: "2.0.0",
            schema_snapshot: { version: 1, state: "captured", input: null, output: null },
            skills: [],
          }],
        }),
      );
    });

    it("lists a contract outputSchema as the JSON Schema document the runtime validates against", async () => {
      const outputSchema = defineSchema((v) =>
        v.object({ category: v.enum(["billing", "technical"]), confidence: v.number() })
      )();
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) => (id === "classifier" ? createAgent({ id, outputSchema }) : undefined),
        getAllAgentIds: () => ["classifier"],
      });

      assertEquals(response.agents[0]?.output_schema, schemaToJsonSchema(outputSchema));
      // The document crosses HTTP as JSON; it must arrive unchanged so the API hashes what the
      // runtime hashes.
      const received = JSON.parse(JSON.stringify(response.agents[0]?.output_schema));
      assertEquals(
        await schemaIdentitySha256(received),
        await schemaIdentitySha256(outputSchema),
      );
    });

    it("lists a raw JSON Schema outputSchema as declared", async () => {
      const outputSchema = {
        type: "object",
        properties: { headline: { type: "string" } },
        required: ["headline"],
      };
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) => (id === "writer" ? createAgent({ id, outputSchema }) : undefined),
        getAllAgentIds: () => ["writer"],
      });

      assertEquals(response.agents[0]?.output_schema, outputSchema);
    });

    it("omits an outputSchema that cannot be converted and keeps listing the agent", async () => {
      const outputSchema = { __zod: true, parse() {}, safeParse() {} };
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) => (id === "broken" ? createAgent({ id, outputSchema }) : undefined),
        getAllAgentIds: () => ["broken"],
      });

      assertEquals(response.agents[0]?.id, "broken");
      assertEquals("output_schema" in (response.agents[0] ?? {}), false);
    });

    it("omits output_schema for an agent that declares none", async () => {
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) => (id === "assistant" ? createAgent({ id }) : undefined),
        getAllAgentIds: () => ["assistant"],
      });

      assertEquals("output_schema" in (response.agents[0] ?? {}), false);
    });

    it("omits invalid suggestions instead of failing the whole agent list", async () => {
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant"
            ? {
              ...createAgent({ id }),
              config: {
                ...createAgent({ id }).config,
                suggestions: {
                  welcomeMessage: "How can I help you?",
                },
              } as unknown as Agent["config"],
            }
            : undefined,
        getAllAgentIds: () => ["assistant"],
      });

      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [{
            id: "assistant",
            name: "Support",
            description: "Helps with support questions",
            model: "anthropic/claude-sonnet-4-6",
            version: "2.0.0",
            schema_snapshot: { version: 1, state: "captured", input: null, output: null },
            skills: [],
          }],
        }),
      );
    });

    it("omits legacy suggestion payloads with unsupported fields", async () => {
      const response = await listRuntimeAgents(createHandlerContext(), {
        ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
        getAgent: (id) =>
          id === "assistant"
            ? {
              ...createAgent({ id }),
              config: {
                ...createAgent({ id }).config,
                suggestions: {
                  suggestions: [
                    {
                      id: "plan-work",
                      type: "prompt",
                      title: "Plan work",
                      description: "Turn an idea into clear next steps",
                      prompt: "Help me turn this idea into a concrete plan.",
                    },
                    {
                      id: "research-topic",
                      type: "task",
                      title: "Research a topic",
                      task: "Research this topic and summarize the key findings",
                    },
                  ],
                },
              } as unknown as Agent["config"],
            }
            : undefined,
        getAllAgentIds: () => ["assistant"],
      });

      assertEquals(
        response,
        RuntimeAgentListResponseSchema.parse({
          agents: [{
            id: "assistant",
            name: "Support",
            description: "Helps with support questions",
            model: "anthropic/claude-sonnet-4-6",
            version: "2.0.0",
            schema_snapshot: { version: 1, state: "captured", input: null, output: null },
            skills: [],
          }],
        }),
      );
    });
  });
});

it("resolveAgentSkills includes the agent's own skills and excludes others'", () => {
  skillRegistryInternal.clearAll();
  try {
    registerSkill("global-howto", {
      id: "global-howto",
      metadata: { name: "global-howto", description: "Global guide" },
      rootPath: "/nonexistent/global-howto",
    });
    registerSkill("researcher--cite", {
      id: "researcher--cite",
      metadata: { name: "cite", description: "Cite sources" },
      rootPath: "/nonexistent/cite",
      ownerAgentId: "researcher",
      shortName: "cite",
    });

    const researcher = { id: "researcher", config: { skills: true } } as unknown as Agent;
    const researcherSkills = resolveAgentSkills(researcher).map((skill) => skill.id).sort();
    assertEquals(researcherSkills, ["global-howto", "researcher--cite"]);

    const writer = { id: "writer", config: { skills: true } } as unknown as Agent;
    const writerSkills = resolveAgentSkills(writer).map((skill) => skill.id);
    assertEquals(writerSkills, ["global-howto"]);

    const defaultWriter = { id: "writer", config: {} } as unknown as Agent;
    assertEquals(resolveAgentSkills(defaultWriter).map((skill) => skill.id), ["global-howto"]);

    const emptyWriter = { id: "writer", config: { skills: [] } } as unknown as Agent;
    assertEquals(resolveAgentSkills(emptyWriter), [], "skills: [] advertises no skills");

    const disabledWriter = { id: "writer", config: { skills: false } } as unknown as Agent;
    assertEquals(resolveAgentSkills(disabledWriter), [], "skills: false advertises no skills");
  } finally {
    skillRegistryInternal.clearAll();
  }
});
