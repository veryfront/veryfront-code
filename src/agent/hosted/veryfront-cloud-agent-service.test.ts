import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { SandboxShellToolsProviderName } from "#veryfront/extensions/sandbox/index.ts";
import { tool, toolRegistry } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
} from "#veryfront/skill/tools.ts";
import { agentRegistry } from "../composition/index.ts";
import {
  createNodeVeryfrontCloudAgentServiceRuntime,
  getDiscoveredHostTools,
  startNodeVeryfrontCloudAgentService,
  veryfrontApiMcpServer,
  veryfrontCloudAgentServiceInternals,
  veryfrontStudioMcpServer,
} from "./veryfront-cloud-agent-service.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import type { HostedRuntimeSourceIdentity } from "./runtime-source-binding.ts";

async function withTempDir(
  fn: (dir: string) => Promise<void> | void,
  options: { registerSandboxProvider?: boolean } = {},
): Promise<void> {
  const dir = Deno.makeTempDirSync();
  if (options.registerSandboxProvider ?? true) {
    registerTestSandboxShellToolsProvider();
  } else {
    unregister(SandboxShellToolsProviderName);
  }
  try {
    await fn(dir);
  } finally {
    await stopEsbuild();
    Deno.removeSync(dir, { recursive: true });
    agentRegistry.clearAll();
    toolRegistry.clearAll();
    unregister(SandboxShellToolsProviderName);
  }
}

function writeMarkdownAgentDefinition(rootDir: string, id = "veryfront"): void {
  const agentsDir = resolve(rootDir, "agents");
  Deno.mkdirSync(agentsDir, { recursive: true });
  Deno.writeTextFileSync(
    resolve(agentsDir, `${id}.md`),
    `---
name: Veryfront
model: openai/gpt-5.4
max-steps: 12
---

Help users build with Veryfront.
`,
  );
}

function writeCodeAgentDefinition(
  rootDir: string,
  options: { agentsDir?: string; toolsDir?: string } = {},
): void {
  const agentsDir = resolve(rootDir, options.agentsDir ?? "agents");
  const toolsDir = resolve(rootDir, options.toolsDir ?? "tools");
  Deno.mkdirSync(agentsDir, { recursive: true });
  Deno.mkdirSync(toolsDir, { recursive: true });
  Deno.writeTextFileSync(
    resolve(agentsDir, "support.ts"),
    [
      'import { agent } from "veryfront/agent";',
      "",
      "export default agent({",
      '  id: "support",',
      '  model: "openai/gpt-5.4",',
      "  maxSteps: 8,",
      '  system: "Help users from code.",',
      "});",
      "",
    ].join("\n"),
  );
  Deno.writeTextFileSync(
    resolve(toolsDir, "echo.ts"),
    [
      'import { tool } from "veryfront/tool";',
      'import { defineSchema } from "veryfront/schemas";',
      "",
      "export default tool({",
      '  id: "echo",',
      '  description: "Echo input",',
      "  inputSchema: defineSchema((v) => v.object({ text: v.string() }))(),",
      "  execute: ({ text }) => ({ text }),",
      "});",
      "",
    ].join("\n"),
  );
}

const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

function registerTestSandboxShellToolsProvider(): void {
  register(SandboxShellToolsProviderName, createBashTool);
}

function getRuntimeAgent(
  bundle: Awaited<ReturnType<typeof createNodeVeryfrontCloudAgentServiceRuntime>>,
  agentId: string,
) {
  const runtimeAgent = bundle.runtime.contract.agents[agentId];
  assert(runtimeAgent);
  return runtimeAgent;
}

Deno.test("getDiscoveredHostTools excludes shared skill infrastructure tools", () => {
  try {
    toolRegistry.registerShared("load_skill_reference", createLoadSkillReferenceTool());
    toolRegistry.registerShared("execute_skill_script", createExecuteSkillScriptTool());
    toolRegistry.registerShared(
      "shared_echo",
      tool({
        id: "shared_echo",
        description: "Echo shared input",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      }),
    );

    const tools = getDiscoveredHostTools();

    assertEquals("shared_echo" in tools, true);
    assertEquals("load_skill_reference" in tools, false);
    assertEquals("execute_skill_script" in tools, false);
  } finally {
    toolRegistry.clearAll();
  }
});

Deno.test("hosted child project agents request only materialized skill and delegate tools", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedChildToolNames({
      id: "extraction-agent",
      name: "Extraction agent",
      description: "Extract an application",
      instructions: "Extract the application.",
      tools: [
        "get_file",
        "execute_skill_script",
        "load_skill",
        "load_skill_reference",
      ],
      providerTools: ["web_search"],
      delegates: ["validation-agent"],
    }),
    ["get_file", "load_skill", "web_search", "agent_validation-agent"],
  );
});

Deno.test("hosted nested delegates inherit child scope and durable lineage", () => {
  const context = veryfrontCloudAgentServiceInternals.buildHostedChildToolContext(
    {
      authToken: "token-1",
      projectId: "project-1",
      branchId: "branch-1",
      agentId: "orchestrator",
      availableToolNames: ["agent_extraction-agent", "root_only"],
      availableSkillIds: ["root-skill"],
      conversationId: "root-conversation",
      parentRunId: "root-run",
      parentMessageId: "root-message",
    },
    "extraction-agent",
    {
      system: "Extract applications.",
      toolNames: ["get_file", "agent_validation-agent", "load_skill"],
      availableSkillIds: ["extraction-skill"],
      skillSourcePaths: {
        "extraction-skill": "agents/extraction-agent/skills/extract/SKILL.md",
      },
      delegateIds: ["validation-agent"],
      mcpServers: [],
    },
    {
      childConversationId: "child-conversation",
      childRunId: "child-run",
      childMessageId: "child-message",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    },
  );

  assertEquals(context.agentId, "extraction-agent");
  assertEquals(context.availableToolNames, [
    "get_file",
    "agent_validation-agent",
    "load_skill",
  ]);
  assertEquals(context.availableSkillIds, ["extraction-skill"]);
  assertEquals(context.skillSourcePaths, {
    "extraction-skill": "agents/extraction-agent/skills/extract/SKILL.md",
  });
  assertEquals(context.loadedSkillResponses, {});
  assertEquals(context.loadedSkillReferenceResponses, {});
  assertEquals(context.conversationId, "child-conversation");
  assertEquals(context.parentRunId, "child-run");
  assertEquals(context.parentMessageId, "child-message");
});

Deno.test("hosted nested delegates preserve trusted root invocation context", () => {
  const context = veryfrontCloudAgentServiceInternals.buildHostedChildToolContext(
    {
      authToken: "token-1",
      projectId: "project-1",
      agentId: "orchestrator",
      conversationId: "root-conversation",
      parentRunId: "root-run",
      parentMessageId: "root-message",
      veryfrontInvocationContext: {
        root_conversation_id: "root-conversation",
        root_run_id: "root-run",
        root_message_id: "root-message",
        parent_conversation_id: "root-conversation",
        parent_run_id: "root-run",
        parent_message_id: "root-message",
        tool_call_id: "tool-call-child",
        delegation_depth: 1,
      },
    },
    "validation-agent",
    {
      system: "Validate applications.",
      toolNames: ["get_file", "load_skill"],
      availableSkillIds: ["validation-skill"],
      mcpServers: [],
    },
    {
      childConversationId: "child-conversation",
      childRunId: "child-run",
      childMessageId: "child-message",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    },
  );

  assertEquals(context.veryfrontInvocationContext, {
    root_conversation_id: "root-conversation",
    root_run_id: "root-run",
    root_message_id: "root-message",
    parent_conversation_id: "root-conversation",
    parent_run_id: "root-run",
    parent_message_id: "root-message",
    tool_call_id: "tool-call-child",
    delegation_depth: 1,
  });
  assertEquals(context.conversationId, "child-conversation");
  assertEquals(context.parentRunId, "child-run");
  assertEquals(context.parentMessageId, "child-message");
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime loads the markdown agent and binds service routes", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir);

    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "veryfront-agent-test",
      agentId: "veryfront",
      entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.com",
        PORT: "3141",
        ALLOWED_ORIGINS: "https://studio.example.com",
      },
    });

    assertEquals(bundle.config.PORT, 3141);
    assertEquals(bundle.config.VERYFRONT_API_URL, "https://api.example.com");
    assertEquals(bundle.runtime.contract.serviceName, "veryfront-agent-test");
    assertEquals(bundle.runtime.contract.defaultAgentId, "veryfront");
    const runtimeAgent = getRuntimeAgent(bundle, "veryfront");
    assertEquals(runtimeAgent.id, "veryfront");
    assertEquals(runtimeAgent.config.model, "openai/gpt-5.4");

    const liveness = await bundle.runtime.request("http://localhost/liveness");
    assertEquals(liveness.status, 200);
    assertEquals(await liveness.text(), "OK");
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime rejects mutable branch source bindings", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir);

    await assertRejects(
      () =>
        createNodeVeryfrontCloudAgentServiceRuntime({
          serviceName: "veryfront-agent-test",
          agentId: "veryfront",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          runtimeSource: {
            type: "branch",
            branch: "main",
          } as unknown as HostedRuntimeSourceIdentity,
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            PORT: "3141",
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        }),
      Error,
      "runtimeSource must identify an immutable release or environment source",
    );
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime can load default sandbox shell tools without pre-registered extensions", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir);

    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "veryfront-agent-test",
      agentId: "veryfront",
      entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.com",
        PORT: "3141",
        ALLOWED_ORIGINS: "https://studio.example.com",
      },
    });

    assertEquals(bundle.runtime.contract.defaultAgentId, "veryfront");
  }, { registerSandboxProvider: false });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime defaults to the single markdown agent", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");

    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "single-markdown-agent-test",
      entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.com",
        PORT: "3146",
        ALLOWED_ORIGINS: "https://studio.example.com",
      },
    });

    assertEquals(bundle.runtime.contract.defaultAgentId, "support");
    assertEquals(getRuntimeAgent(bundle, "support").config.model, "openai/gpt-5.4");
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime derives serviceName from project manifest", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    Deno.writeTextFileSync(
      resolve(rootDir, "package.json"),
      JSON.stringify({ name: "support-agent-service" }),
    );

    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.com",
        PORT: "3149",
        ALLOWED_ORIGINS: "https://studio.example.com",
      },
    });

    assertEquals(bundle.runtime.contract.serviceName, "support-agent-service");
    assertEquals(bundle.runtime.contract.defaultAgentId, "support");
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime lets env override manifest serviceName", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    Deno.writeTextFileSync(
      resolve(rootDir, "deno.json"),
      JSON.stringify({ name: "manifest-agent-service" }),
    );

    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.com",
        VERYFRONT_AGENT_SERVICE_NAME: "env-agent-service",
        PORT: "3150",
        ALLOWED_ORIGINS: "https://studio.example.com",
      },
    });

    assertEquals(bundle.runtime.contract.serviceName, "env-agent-service");
    assertEquals(bundle.runtime.contract.defaultAgentId, "support");
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime uses configured markdown agent paths", async () => {
  await withTempDir(async (rootDir) => {
    const agentsDir = resolve(rootDir, "crew");
    Deno.mkdirSync(agentsDir, { recursive: true });
    Deno.writeTextFileSync(
      resolve(agentsDir, "support.md"),
      `---
name: Support
model: openai/gpt-5.4
max-steps: 6
---

Help users from configured markdown.
`,
    );
    Deno.writeTextFileSync(
      resolve(rootDir, "veryfront.config.ts"),
      [
        "export default {",
        "  ai: {",
        '    agents: { discovery: { paths: ["crew"] } },',
        "  },",
        "};",
        "",
      ].join("\n"),
    );

    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "configured-markdown-agent-test",
      entrypointUrl: pathToFileURL(resolve(rootDir, "src", "main.ts")),
      createBashTool,
      signals: [],
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.com",
        PORT: "3151",
        ALLOWED_ORIGINS: "https://studio.example.com",
      },
    });

    assertEquals(bundle.runtime.contract.defaultAgentId, "support");
    const runtimeAgent = getRuntimeAgent(bundle, "support");
    assertEquals(runtimeAgent.config.system, "Help users from configured markdown.");
    assertEquals(runtimeAgent.config.maxSteps, 6);
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime requires agentId for multiple markdown agents", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    writeMarkdownAgentDefinition(rootDir, "writer");

    await assertRejects(
      () =>
        createNodeVeryfrontCloudAgentServiceRuntime({
          serviceName: "multi-markdown-agent-test",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            PORT: "3147",
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        }),
      Error,
      "agentId is required",
    );
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime defaults discovery to cwd", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir);
    const previousCwd = Deno.cwd();
    Deno.chdir(rootDir);
    try {
      const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
        serviceName: "cwd-agent-test",
        agentId: "veryfront",
        signals: [],
        env: {
          NODE_ENV: "test",
          VERYFRONT_API_URL: "https://api.example.com",
          PORT: "3144",
          ALLOWED_ORIGINS: "https://studio.example.com",
        },
      });

      assertEquals(bundle.runtime.contract.defaultAgentId, "veryfront");
      assertEquals(getRuntimeAgent(bundle, "veryfront").config.model, "openai/gpt-5.4");
    } finally {
      Deno.chdir(previousCwd);
    }
  });
});

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime accepts entrypointUrl for discovery", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir);

    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "entrypoint-url-agent-test",
      agentId: "veryfront",
      entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.com",
        PORT: "3145",
        ALLOWED_ORIGINS: "https://studio.example.com",
      },
    });

    assertEquals(bundle.runtime.contract.defaultAgentId, "veryfront");
    assertEquals(getRuntimeAgent(bundle, "veryfront").config.model, "openai/gpt-5.4");
  });
});

Deno.test("startNodeVeryfrontCloudAgentService registers the service with the control plane", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = (input, init) => {
      calls.push({ url: input.toString(), init });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            service: {
              id: "22222222-2222-4222-a222-222222222222",
              service_name: "registered-service-test",
              service_key: "registered-service-test:key",
              scope_kind: "project",
              scope_key: "11111111-1111-4111-a111-111111111111",
              project_id: "11111111-1111-4111-a111-111111111111",
              agent_id: "support",
              base_url: "https://agent.example.com",
              invoke_url: "https://agent.example.com/api/runs",
              status: "active",
              capabilities: null,
              metadata: null,
              version: "0.1.0",
              runtime: "node",
              region: null,
              last_heartbeat_at: "2026-05-13T00:00:00.000Z",
              created_at: "2026-05-13T00:00:00.000Z",
              updated_at: "2026-05-13T00:00:00.000Z",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    };

    try {
      const bundle = await startNodeVeryfrontCloudAgentService({
        serviceName: "registered-service-test",
        agentId: "support",
        runtimeSource: { type: "release", releaseId: "release-42" },
        entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
        signals: [],
        env: {
          NODE_ENV: "test",
          VERYFRONT_API_URL: "https://api.example.com",
          VERYFRONT_API_TOKEN: "token-1",
          VERYFRONT_PROJECT_ID: "11111111-1111-4111-a111-111111111111",
          VERYFRONT_AGENT_SERVICE_URL: "https://agent.example.com",
          VERYFRONT_AGENT_SERVICE_KEY: "registered-service-test:key",
          VERYFRONT_AGENT_SERVICE_REGISTRATION: "enabled",
          VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: "60000",
          PORT: "0",
          ALLOWED_ORIGINS: "https://studio.example.com",
        },
      });
      await bundle.nodeServer.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.url, "https://api.example.com/agent-runtimes/push-services");
    assertEquals(new Headers(calls[0]?.init?.headers).get("Authorization"), "Bearer token-1");
    assertEquals(JSON.parse(String(calls[0]?.init?.body)).scope_kind, "project");
  });
});

Deno.test("startNodeVeryfrontCloudAgentService rejects registration without an immutable source binding", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");

    await assertRejects(
      () =>
        startNodeVeryfrontCloudAgentService({
          serviceName: "unbound-service-test",
          agentId: "support",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          signals: [],
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_API_TOKEN: "token-1",
            VERYFRONT_PROJECT_ID: "11111111-1111-4111-a111-111111111111",
            VERYFRONT_AGENT_SERVICE_URL: "https://agent.example.com",
            VERYFRONT_AGENT_SERVICE_KEY: "unbound-service-test:key",
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "enabled",
            PORT: "0",
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        }),
      Error,
      "runtimeSource is required when agent service control-plane registration is enabled",
    );
  });
});

Deno.test("Veryfront MCP server helpers create explicit server configs", () => {
  assertEquals(veryfrontApiMcpServer(), { kind: "veryfront-api" });
  assertEquals(veryfrontStudioMcpServer(), { kind: "veryfront-studio" });
});

Deno.test("hosted MCP resolver preserves default behavior without a service ceiling", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers({}),
    [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
  );

  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers({}, {
      mcpServers: [{
        kind: "veryfront-studio",
        toolPolicy: { allow: ["studio_open_project"] },
      }],
    }),
    [{
      kind: "veryfront-studio",
      toolPolicy: { allow: ["studio_open_project"] },
    }],
  );
});

Deno.test("hosted MCP resolver keeps explicit service opt-out as a hard ceiling", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers(
      { mcpServers: [] },
      { mcpServers: [{ kind: "veryfront-api" }] },
    ),
    [],
  );
});

Deno.test("hosted MCP resolver drops agent servers not granted by the service", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers(
      { mcpServers: [{ kind: "veryfront-api" }] },
      { mcpServers: [{ kind: "veryfront-api", id: "agent-picked" }] },
    ),
    [],
  );
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers(
      { mcpServers: [{ kind: "veryfront-studio" }] },
      { mcpServers: [{ kind: "veryfront-api" }] },
    ),
    [],
  );
});

Deno.test("hosted MCP resolver narrows allow policy and unions deny policy under service ceiling", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers(
      {
        mcpServers: [{
          kind: "veryfront-api",
          id: "primary",
          toolPolicy: {
            allow: ["read_job", "update_job"],
            deny: ["delete_job"],
            approval: "never",
          },
        }],
      },
      {
        mcpServers: [{
          kind: "veryfront-api",
          id: "primary",
          toolPolicy: {
            allow: ["read_job", "submit_job"],
            deny: ["update_job"],
            approval: "never",
          },
        }],
      },
    ),
    [{
      kind: "veryfront-api",
      id: "primary",
      toolPolicy: {
        allow: ["read_job"],
        deny: ["delete_job", "update_job"],
        approval: "never",
      },
    }],
  );
});

Deno.test("hosted child execution config resolves steering against the target project", async () => {
  const childAgent = {
    id: "extraction-agent",
    name: "Extraction agent",
    description: "Extract job applications",
    instructions: "Extract the application.",
    model: "openai/gpt-5.4",
    temperature: 0.35,
  };
  const steeringLookups: Array<{
    projectId: string;
    authToken: string;
    branchId?: string | null;
  }> = [];
  const config = await veryfrontCloudAgentServiceInternals.resolveHostedChildAgentExecutionConfig(
    {
      options: { mcpServers: [] },
      discoveryResult: { agents: new Map([["extraction-agent", null]]) },
      agentConfigs: new Map([["extraction-agent", childAgent]]),
      projectSteeringByAgentId: new Map([["extraction-agent", {
        getProjectInstructions: (lookup: typeof steeringLookups[number]) => {
          steeringLookups.push(lookup);
          return Promise.resolve("Use the target project's extraction policy.");
        },
        getSkillsConfig: (lookup: typeof steeringLookups[number]) => {
          steeringLookups.push(lookup);
          return Promise.resolve([]);
        },
      }]]),
      trace: (_name: string, operation: () => unknown) => operation(),
    } as never,
    {
      authToken: "token-1",
      projectId: "source-project",
      branchId: "source-branch",
      agentId: "orchestrator",
    },
    "extraction-agent",
    "target-project",
  );

  assertEquals(config?.model, "openai/gpt-5.4");
  assertEquals(config?.temperature, 0.35);
  assert(config?.system.includes("Use the target project's extraction policy."));
  assertEquals(steeringLookups, [
    { projectId: "target-project", authToken: "token-1", branchId: null },
    { projectId: "target-project", authToken: "token-1", branchId: null },
  ]);
});

Deno.test({
  name: "createNodeVeryfrontCloudAgentServiceRuntime uses veryfront.config.ts discovery paths",
  // Code primitive discovery invokes the esbuild-backed transpiler, which starts
  // an esbuild child process. This matches the sanitizer policy in
  // src/discovery/transpiler.test.ts.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (rootDir) => {
      writeCodeAgentDefinition(rootDir, { agentsDir: "crew", toolsDir: "tooling" });
      Deno.writeTextFileSync(
        resolve(rootDir, "veryfront.config.ts"),
        [
          "export default {",
          "  ai: {",
          '    agents: { discovery: { paths: ["crew"] } },',
          '    tools: { discovery: { paths: ["tooling"] } },',
          "  },",
          "};",
          "",
        ].join("\n"),
      );

      const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
        serviceName: "configured-agent-test",
        agentId: "support",
        agentSource: "code",
        entrypointUrl: pathToFileURL(resolve(rootDir, "src", "main.ts")),
        createBashTool,
        signals: [],
        env: {
          NODE_ENV: "test",
          VERYFRONT_API_URL: "https://api.example.com",
          PORT: "3143",
          ALLOWED_ORIGINS: "https://studio.example.com",
        },
      });

      assertEquals(bundle.runtime.contract.defaultAgentId, "support");
      assertEquals(getRuntimeAgent(bundle, "support").config.system, "Help users from code.");
      assertEquals(toolRegistry.has("echo"), true);
    });
  },
});

Deno.test({
  name: "createNodeVeryfrontCloudAgentServiceRuntime defaults to the single code agent",
  // Code primitive discovery invokes the esbuild-backed transpiler, which starts
  // an esbuild child process. This matches the sanitizer policy in
  // src/discovery/transpiler.test.ts.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (rootDir) => {
      writeCodeAgentDefinition(rootDir);

      const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
        serviceName: "single-code-agent-test",
        agentSource: "code",
        entrypointUrl: pathToFileURL(resolve(rootDir, "src", "main.ts")),
        createBashTool,
        signals: [],
        env: {
          NODE_ENV: "test",
          VERYFRONT_API_URL: "https://api.example.com",
          PORT: "3148",
          ALLOWED_ORIGINS: "https://studio.example.com",
        },
      });

      assertEquals(bundle.runtime.contract.defaultAgentId, "support");
      assertEquals(getRuntimeAgent(bundle, "support").config.system, "Help users from code.");
    });
  },
});

Deno.test({
  name: "createNodeVeryfrontCloudAgentServiceRuntime discovers code agents and project primitives",
  // Code primitive discovery invokes the esbuild-backed transpiler, which starts
  // an esbuild child process. This matches the sanitizer policy in
  // src/discovery/transpiler.test.ts.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withTempDir(async (rootDir) => {
      writeCodeAgentDefinition(rootDir);

      const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
        serviceName: "support-agent-test",
        agentId: "support",
        agentSource: "code",
        entrypointUrl: pathToFileURL(resolve(rootDir, "src", "main.ts")),
        createBashTool,
        signals: [],
        env: {
          NODE_ENV: "test",
          VERYFRONT_API_URL: "https://api.example.com",
          PORT: "3142",
          ALLOWED_ORIGINS: "https://studio.example.com",
        },
      });

      assertEquals(bundle.runtime.contract.defaultAgentId, "support");
      const runtimeAgent = getRuntimeAgent(bundle, "support");
      assertEquals(runtimeAgent.config.system, "Help users from code.");
      assertEquals(runtimeAgent.config.model, "openai/gpt-5.4");
      assertEquals(runtimeAgent.config.maxSteps, 8);
      assertEquals(toolRegistry.has("echo"), true);
    });
  },
});
