import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { clearModelProviders, registerModelProvider } from "#veryfront/provider";
import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import {
  type ApplicationErrorContext,
  type ApplicationErrorReporter,
  setApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { SandboxShellToolsProviderName } from "#veryfront/extensions/sandbox/index.ts";
import {
  createRemoteMCPToolSource,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  tool,
  toolRegistry,
} from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { __resetLogRecordEmitterForTests, agentLogger } from "#veryfront/utils/logger/index.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
} from "#veryfront/skill/tools.ts";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { agentRegistry } from "../composition/index.ts";
import {
  createNodeVeryfrontCloudAgentServiceRuntime,
  getDiscoveredHostTools,
  startAgentService,
  startNodeVeryfrontCloudAgentService,
  veryfrontApiMcpServer,
  veryfrontCloudAgentServiceInternals,
  veryfrontStudioMcpServer,
} from "./veryfront-cloud-agent-service.ts";
import type { NodeVeryfrontCloudAgentServiceOptions } from "./veryfront-cloud-agent-service.ts";
import { createAgentRuntime } from "./cloud-agent-chat-execution.ts";
import { createInvokeAgentTool } from "./cloud-agent-child-tools.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import type { HostedRuntimeSourceIdentity } from "./runtime-source-binding.ts";
import { initializeNodeAgentServiceSentryApplicationErrors } from "../service/node-sentry.ts";
import { getRemoteToolSourceFactory } from "./cloud-agent-config.ts";
import type { AgentSystem } from "#veryfront/agent/types.ts";
import type { RuntimeClientProfile } from "#veryfront/agent/runtime/client-profile.ts";

type CaptureRecord = {
  error: unknown;
  context: ApplicationErrorContext;
};

function systemIncludes(system: AgentSystem | undefined, text: string): boolean {
  return typeof system === "string"
    ? system.includes(text)
    : system?.some((message) => message.content.includes(text)) ?? false;
}

Deno.test("public agent service options do not expose the internal eager rollback", () => {
  type HasOperationalToolLoadingOverride = "operationalToolLoadingOverride" extends
    keyof NodeVeryfrontCloudAgentServiceOptions ? true
    : false;
  const hasOperationalToolLoadingOverride: HasOperationalToolLoadingOverride = false;
  assertEquals(hasOperationalToolLoadingOverride, false);
});

Deno.test("public agent service options expose deployment-owned remote MCP composition", () => {
  type HasCreateRemoteToolSource = "createRemoteToolSource" extends
    keyof NodeVeryfrontCloudAgentServiceOptions ? true
    : false;
  const hasCreateRemoteToolSource: HasCreateRemoteToolSource = true;
  assertEquals(hasCreateRemoteToolSource, true);
});

Deno.test("root and child runtimes use the deployment-owned remote MCP factory", async () => {
  const createdConfigs: RemoteMCPToolSourceConfig[] = [];
  let failStudioListing = false;
  let modelCallCount = 0;
  let switchedTaskContext: { projectId: string; projectSlug?: string } | undefined;
  const injectedFactory = (config: RemoteMCPToolSourceConfig): RemoteToolSource => {
    createdConfigs.push(config);
    return {
      id: config.id ?? "injected",
      listTools: () =>
        failStudioListing && config.endpoint === "https://studio.example/mcp"
          ? Promise.reject(new Error("stop after transport capture"))
          : Promise.resolve(
            config.id === "studio-mcp"
              ? [{
                name: "studio_open_project",
                description: "Open a project.",
                parameters: { type: "object", properties: {} },
              }]
              : [],
          ),
      executeTool: (toolName) =>
        Promise.resolve(
          config.id === "studio-mcp" && toolName === "studio_open_project"
            ? { success: true, project_id: "project-2", slug: "project-two" }
            : null,
        ),
    };
  };
  const context = {
    options: {
      createBashTool,
      createRemoteToolSource: injectedFactory,
      mcpServers: [veryfrontApiMcpServer(), veryfrontStudioMcpServer()],
    },
    infrastructure: {
      getConfig: () => ({
        VERYFRONT_API_URL: "https://93.184.216.34",
        VERYFRONT_MCP_URL: "https://93.184.216.34/mcp",
        VERYFRONT_STUDIO_MCP_URL: "https://studio.example/mcp",
        VERYFRONT_ENABLE_DURABLE_INVOKE_AGENT: false,
      }),
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      tracer: {
        trace: (_name: string, operation: () => unknown) => operation(),
        scope: () => ({ active: () => undefined }),
      },
      setActiveSpanAttributes: () => undefined,
    },
    discoveryResult: {
      agents: new Map(),
      tools: new Map(),
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    },
    defaultAgentId: "root-agent",
    projectSteeringByAgentId: new Map([["root-agent", {
      createLoadSkillTool: () =>
        tool({
          id: "load_skill",
          description: "Load a skill.",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ ok: true }),
        }),
      refreshProjectSkillIds: (taskContext: { projectId: string; projectSlug?: string }) => {
        switchedTaskContext = taskContext;
        return Promise.resolve();
      },
    }]]),
    trace: (_name: string, operation: () => unknown) => operation(),
  } as never;
  const clientProfile: RuntimeClientProfile = {
    id: "veryfront-studio",
    type: "web",
    trusted: true,
    capabilities: ["ui_panels"],
  };

  clearModelProviders();
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/hosted-project-switch",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream: () => {
      modelCallCount++;
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            if (modelCallCount === 1) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "open-project-1",
                toolName: "studio_open_project",
                input: { project_reference: "project-two" },
              });
              controller.enqueue({ type: "finish", finishReason: "tool-calls", usage: {} });
            } else {
              controller.enqueue({ type: "text-delta", text: "opened" });
              controller.enqueue({ type: "finish", finishReason: "stop", usage: {} });
            }
            controller.close();
          },
        }),
      });
    },
  }));

  const rootRuntime = await createAgentRuntime(context, {
    projectId: "project-1",
    branchId: "branch-1",
    authToken: "token-1",
    instructions: "Use the available tools.",
    agentId: "root-agent",
    model: "test/hosted-project-switch",
    allowedTools: ["studio_open_project"],
    allowDelegation: false,
    clientProfile,
  });
  assertEquals(
    await Promise.all(createdConfigs.map(async ({ id, endpoint }) => ({
      id,
      endpoint: typeof endpoint === "function" ? await endpoint() : endpoint,
    }))),
    [
      { id: "veryfront-mcp", endpoint: "https://93.184.216.34/projects/project-1/mcp" },
      { id: "studio-mcp", endpoint: "https://studio.example/mcp" },
    ],
  );

  try {
    await withMockFetch(
      () => Promise.resolve(Response.json({ tools: [] })),
      async () => {
        const stream = await rootRuntime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of stream.toUIMessageStream()) {
          // Consume the project-switch tool round trip.
        }
      },
    );
  } finally {
    await rootRuntime.cleanup();
    clearModelProviders();
  }
  assertEquals(switchedTaskContext?.projectId, "project-2");
  const rootApiConfig = createdConfigs.find((config) => config.id === "veryfront-mcp");
  assertEquals(
    typeof rootApiConfig?.endpoint === "function"
      ? await rootApiConfig.endpoint()
      : rootApiConfig?.endpoint,
    "https://93.184.216.34/projects/project-2/mcp",
  );

  createdConfigs.length = 0;
  failStudioListing = true;
  const invokeAgent = createInvokeAgentTool(context, {
    authToken: "token-1",
    projectId: switchedTaskContext?.projectId ?? "project-1",
    branchId: "branch-1",
    agentId: "orchestrator",
    clientProfile,
  });
  await invokeAgent.execute({
    agent_id: "child-agent",
    description: "Verify child MCP composition.",
    prompt: "Inspect the available tools.",
  }, { toolCallId: "tool-call-1" });
  assertEquals(
    await Promise.all(createdConfigs.map(async ({ id, endpoint }) => ({
      id,
      endpoint: typeof endpoint === "function" ? await endpoint() : endpoint,
    }))),
    [
      { id: "veryfront-mcp-fork", endpoint: "https://93.184.216.34/projects/project-2/mcp" },
      { id: "studio-mcp-live-tools", endpoint: "https://studio.example/mcp" },
    ],
  );

  assertStrictEquals(
    getRemoteToolSourceFactory({ options: {} } as never),
    createRemoteMCPToolSource,
  );
});

type TestDenoRuntime = {
  serve: typeof Deno.serve;
  addSignalListener: typeof Deno.addSignalListener;
  removeSignalListener: typeof Deno.removeSignalListener;
  exit: typeof Deno.exit;
};

function createReporter(options: {
  flush?: () => Promise<boolean>;
} = {}): ApplicationErrorReporter & {
  captured: CaptureRecord[];
  flushTimeouts: Array<number | undefined>;
} {
  const reporter = {
    captured: [] as CaptureRecord[],
    flushTimeouts: [] as Array<number | undefined>,
    capture(error: unknown, context: ApplicationErrorContext) {
      reporter.captured.push({ error, context });
      return "event-id";
    },
    async flush(timeoutMs?: number) {
      reporter.flushTimeouts.push(timeoutMs);
      return await (options.flush?.() ?? Promise.resolve(true));
    },
  };
  return reporter;
}

async function withMockDenoServiceServer(
  fn: (
    input: {
      events: string[];
      signalHandlers: Map<string, () => void>;
      waitForExit: () => Promise<number>;
    },
  ) => Promise<void>,
): Promise<void> {
  const denoRuntime = Deno as unknown as TestDenoRuntime;
  const originalServe = denoRuntime.serve;
  const originalAddSignalListener = denoRuntime.addSignalListener;
  const originalRemoveSignalListener = denoRuntime.removeSignalListener;
  const originalExit = denoRuntime.exit;
  const events: string[] = [];
  const signalHandlers = new Map<string, () => void>();
  let resolveExit: ((code: number) => void) | undefined;
  const exitPromise = new Promise<number>((resolveExitPromise) => {
    resolveExit = resolveExitPromise;
  });

  denoRuntime.serve = ((options: Parameters<typeof Deno.serve>[0]) => {
    events.push("serve");
    return {
      addr: { port: "port" in options && typeof options.port === "number" ? options.port : 0 },
      shutdown: () => {
        events.push("server-shutdown");
      },
    };
  }) as typeof Deno.serve;
  denoRuntime.addSignalListener = ((signal: string, handler: () => void) => {
    signalHandlers.set(signal, handler);
  }) as typeof Deno.addSignalListener;
  denoRuntime.removeSignalListener = ((signal: string) => {
    signalHandlers.delete(signal);
  }) as typeof Deno.removeSignalListener;
  denoRuntime.exit = ((code: number) => {
    events.push(`exit:${code}`);
    resolveExit?.(code);
  }) as typeof Deno.exit;

  try {
    await fn({
      events,
      signalHandlers,
      waitForExit: () => exitPromise,
    });
  } finally {
    denoRuntime.serve = originalServe;
    denoRuntime.addSignalListener = originalAddSignalListener;
    denoRuntime.removeSignalListener = originalRemoveSignalListener;
    denoRuntime.exit = originalExit;
  }
}

function withMutedConsole<T>(fn: () => T): T {
  const originalError = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = originalError;
  }
}

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
    toolRegistryInternal.clearAll();
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
  const originalSkillToolIds = [...SKILL_TOOL_IDS];
  try {
    toolRegistryInternal.registerShared("load_skill_reference", createLoadSkillReferenceTool());
    toolRegistryInternal.registerShared("execute_skill_script", createExecuteSkillScriptTool());
    toolRegistryInternal.registerShared(
      "shared_echo",
      tool({
        id: "shared_echo",
        description: "Echo shared input",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      }),
    );
    SKILL_TOOL_IDS.delete("execute_skill_script");
    SKILL_TOOL_IDS.add("shared_echo");

    const tools = getDiscoveredHostTools();

    assertEquals("shared_echo" in tools, true);
    assertEquals("load_skill_reference" in tools, false);
    assertEquals("execute_skill_script" in tools, false);
  } finally {
    SKILL_TOOL_IDS.clear();
    for (const toolId of originalSkillToolIds) SKILL_TOOL_IDS.add(toolId);
    toolRegistryInternal.clearAll();
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
    })?.toSorted(),
    ["agent_validation-agent", "get_file", "load_skill", "web_search"],
  );
});

Deno.test("hosted child project agents omit skill tools for an empty skill selector snapshot", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedChildToolNames({
      id: "extraction-agent",
      name: "Extraction agent",
      description: "Extract an application",
      instructions: "Extract the application.",
      skills: [],
      tools: [
        "get_file",
        "execute_skill_script",
        "load_skill",
        "load_skill_reference",
      ],
    }, { allowedSkillIds: [] }),
    ["get_file"],
  );
});

Deno.test("hosted child project agents keep delegation tools for an empty skill selector snapshot", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedChildToolNames({
      id: "extraction-agent",
      name: "Extraction agent",
      description: "Extract an application",
      instructions: "Extract the application.",
      skills: [],
      tools: [
        "get_file",
        "execute_skill_script",
        "load_skill",
        "load_skill_reference",
      ],
      providerTools: ["web_search"],
      delegates: ["validation-agent"],
    }, { allowedSkillIds: [] })?.toSorted(),
    ["agent_validation-agent", "get_file", "web_search"],
  );
});

Deno.test("hosted child project agents keep load_skill for a non-empty exact skill allowlist", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedChildToolNames({
      id: "extraction-agent",
      name: "Extraction agent",
      description: "Extract an application",
      instructions: "Extract the application.",
      skills: ["extract"],
      tools: ["get_file"],
    }, { allowedSkillIds: ["extraction-agent--extract"] }),
    ["get_file", "load_skill"],
  );
});

Deno.test("startAgentService keeps application-error reporting active after readiness and cleans up on graceful shutdown", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    const reporter = createReporter();
    const events: string[] = [];
    const restoreInitializeApplicationErrors = veryfrontCloudAgentServiceInternals
      .setInitializeApplicationErrorsForTests(async () => {
        const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
          env: {
            SENTRY_ENABLED: "true",
            SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
          },
          flushTimeoutMs: 5,
          loadExtension: () =>
            Promise.resolve({
              createNodeSentryApplicationErrorReporter: () => reporter,
            }),
        });
        return {
          ...lifecycle,
          flush: async (timeoutMs?: number) => {
            events.push(`flush:${timeoutMs ?? "default"}`);
            return await lifecycle.flush(timeoutMs);
          },
          reset: () => {
            events.push("reset");
            lifecycle.reset();
          },
        };
      });

    try {
      await withMockDenoServiceServer(async ({ signalHandlers, waitForExit }) => {
        await startAgentService({
          serviceName: "agent-application-errors-test",
          agentId: "support",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          signals: ["SIGTERM"],
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "disabled",
            PORT: "0",
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        });

        assertEquals(events, []);
        withMutedConsole(() => {
          agentLogger.error("framework error after readiness");
        });
        assertEquals(reporter.captured.length, 1);
        assertEquals(reporter.captured[0]?.context.boundary, "agent.framework-log");

        signalHandlers.get("SIGTERM")?.();
        assertEquals(await waitForExit(), 0);
      });

      assertEquals(events, ["flush:default", "reset"]);
      assertEquals(reporter.flushTimeouts, [5]);
      withMutedConsole(() => {
        agentLogger.error("framework error after shutdown");
      });
      assertEquals(reporter.captured.length, 1);
    } finally {
      restoreInitializeApplicationErrors();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });
});

Deno.test("startAgentService resets application-error reporting when shutdown flush fails", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    const events: string[] = [];
    const restoreInitializeApplicationErrors = veryfrontCloudAgentServiceInternals
      .setInitializeApplicationErrorsForTests(() => ({
        enabled: true,
        captureStartupError: () => {},
        flush: () => {
          events.push("flush");
          return Promise.reject(new Error("flush failed"));
        },
        reset: () => {
          events.push("reset");
        },
      }));

    try {
      await withMockDenoServiceServer(async ({ signalHandlers, waitForExit }) => {
        await startAgentService({
          serviceName: "agent-application-error-flush-failure-test",
          agentId: "support",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          signals: ["SIGTERM"],
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "disabled",
            PORT: "0",
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        });

        assertEquals(events, []);
        signalHandlers.get("SIGTERM")?.();
        assertEquals(await waitForExit(), 1);
      });

      assertEquals(events, ["flush", "reset"]);
    } finally {
      restoreInitializeApplicationErrors();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });
});

Deno.test("startAgentService captures, flushes, and resets terminal startup failures", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    const startupError = new Error("listen failed");
    const reporter = createReporter();
    const events: string[] = [];
    const exitCodes: number[] = [];
    const restoreInitializeApplicationErrors = veryfrontCloudAgentServiceInternals
      .setInitializeApplicationErrorsForTests(async () => {
        const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
          env: {
            SENTRY_ENABLED: "true",
            SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
          },
          flushTimeoutMs: 5,
          loadExtension: () =>
            Promise.resolve({
              createNodeSentryApplicationErrorReporter: () => reporter,
            }),
        });
        return {
          ...lifecycle,
          captureStartupError: (error: unknown) => {
            events.push("capture-startup");
            lifecycle.captureStartupError(error);
          },
          flush: async (timeoutMs?: number) => {
            events.push(`flush:${timeoutMs ?? "default"}`);
            return await lifecycle.flush(timeoutMs);
          },
          reset: () => {
            events.push("reset");
            lifecycle.reset();
          },
        };
      });

    try {
      const denoRuntime = Deno as unknown as TestDenoRuntime;
      const originalServe = denoRuntime.serve;
      denoRuntime.serve = (() => {
        throw startupError;
      }) as typeof Deno.serve;
      try {
        await startAgentService({
          serviceName: "agent-startup-application-errors-test",
          agentId: "support",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          signals: [],
          processTarget: {
            env: {},
            on: () => {},
            off: () => {},
            exit: (code) => {
              exitCodes.push(code);
            },
          },
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "disabled",
            PORT: "0",
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        });
      } finally {
        denoRuntime.serve = originalServe;
      }

      assertEquals(events, ["capture-startup", "flush:default", "reset"]);
      assertEquals(reporter.captured, [
        { error: startupError, context: { boundary: "agent.process.startup" } },
      ]);
      assertEquals(reporter.flushTimeouts, [5]);
      assertEquals(exitCodes, [1]);
    } finally {
      restoreInitializeApplicationErrors();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });
});

Deno.test("startAgentService resets and exits when startup error flush rejects", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    const startupError = new Error("listen failed");
    const events: string[] = [];
    const exitCodes: number[] = [];
    const restoreInitializeApplicationErrors = veryfrontCloudAgentServiceInternals
      .setInitializeApplicationErrorsForTests(() => ({
        enabled: true,
        captureStartupError: (error: unknown) => {
          assertStrictEquals(error, startupError);
          events.push("capture-startup");
        },
        flush: () => {
          events.push("flush");
          return Promise.reject(new Error("flush failed"));
        },
        reset: () => {
          events.push("reset");
        },
      }));

    try {
      const denoRuntime = Deno as unknown as TestDenoRuntime;
      const originalServe = denoRuntime.serve;
      denoRuntime.serve = (() => {
        throw startupError;
      }) as typeof Deno.serve;
      try {
        await startAgentService({
          serviceName: "agent-startup-flush-failure-test",
          agentId: "support",
          entrypointUrl: pathToFileURL(resolve(rootDir, "main.ts")),
          signals: [],
          processTarget: {
            env: {},
            on: () => {},
            off: () => {},
            exit: (code) => {
              exitCodes.push(code);
            },
          },
          env: {
            NODE_ENV: "test",
            VERYFRONT_API_URL: "https://api.example.com",
            VERYFRONT_AGENT_SERVICE_REGISTRATION: "disabled",
            PORT: "0",
            ALLOWED_ORIGINS: "https://studio.example.com",
          },
        });
      } finally {
        denoRuntime.serve = originalServe;
      }

      assertEquals(events, ["capture-startup", "flush", "reset"]);
      assertEquals(exitCodes, [1]);
    } finally {
      restoreInitializeApplicationErrors();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });
});

Deno.test("hosted generic invocation is only replaced by explicit delegates", () => {
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedDelegationBinding({
      id: "job-submission-orchestrator",
      name: "Job submission orchestrator",
      description: "Coordinate job submission specialists.",
      instructions: "Coordinate the workflow.",
      skills: ["orchestrate-job-submission"],
      tools: [
        "invoke_agent",
        "agent_ingestion-agent",
        "agent_extraction-agent",
        "agent_enrichment-agent",
        "agent_submission-agent",
        "get_file",
      ],
    }),
    { kind: "generic" },
  );
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedDelegationBinding({
      id: "legacy-agent",
      name: "Legacy agent",
      description: "Uses legacy delegation.",
      instructions: "Delegate when useful.",
      skills: ["legacy-workflow"],
      tools: ["get_file"],
    }),
    { kind: "generic" },
  );
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedDelegationBinding({
      id: "scoped-agent",
      name: "Scoped agent",
      description: "Uses explicit delegates.",
      instructions: "Delegate only to the specialist.",
      delegates: ["specialist-agent"],
    }),
    { kind: "scoped", delegateIds: ["specialist-agent"] },
  );
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveHostedDelegationBinding({
      id: "no-delegation-agent",
      name: "No delegation agent",
      description: "Cannot delegate.",
      instructions: "Work directly.",
      delegates: [],
    }),
    { kind: "scoped", delegateIds: [] },
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
  assertEquals("runEventAppendToken" in context, false);
});

Deno.test("hosted nested delegates clear inherited skill catalog state for empty child selectors", () => {
  const context = veryfrontCloudAgentServiceInternals.buildHostedChildToolContext(
    {
      authToken: "token-1",
      projectId: "project-1",
      branchId: "branch-1",
      agentId: "orchestrator",
      availableSkillIds: ["root-skill"],
      skillSelectorPolicy: { kind: "allowlist", entries: ["root-skill"] },
      skillSourcePaths: {
        "root-skill": "skills/root/SKILL.md",
      },
      conversationId: "root-conversation",
      parentRunId: "root-run",
      parentMessageId: "root-message",
    },
    "extraction-agent",
    {
      system: "Extract applications.",
      toolNames: ["get_file", "agent_validation-agent"],
      availableSkillIds: [],
      skillSelectorPolicy: { kind: "none" },
      delegateIds: ["validation-agent"],
      mcpServers: [],
    },
  );

  assertEquals(context.agentId, "extraction-agent");
  assertEquals(context.availableSkillIds, []);
  assertEquals(context.skillSelectorPolicy, { kind: "none" });
  assertEquals(context.skillSourcePaths, undefined);
});

Deno.test("hosted generic delegates preserve inherited skill catalog state", () => {
  const context = veryfrontCloudAgentServiceInternals.buildHostedChildToolContext(
    {
      authToken: "token-1",
      projectId: "project-1",
      branchId: "branch-1",
      agentId: "orchestrator",
      availableSkillIds: ["root-skill"],
      skillSelectorPolicy: { kind: "allowlist", entries: ["root-skill"] },
      skillSourcePaths: {
        "root-skill": "skills/root/SKILL.md",
      },
      conversationId: "root-conversation",
      parentRunId: "root-run",
      parentMessageId: "root-message",
    },
    "generic-agent",
    undefined,
  );

  assertEquals(context.agentId, "generic-agent");
  assertEquals(context.availableSkillIds, ["root-skill"]);
  assertEquals(context.skillSelectorPolicy, { kind: "allowlist", entries: ["root-skill"] });
  assertEquals(context.skillSourcePaths, {
    "root-skill": "skills/root/SKILL.md",
  });
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

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime accepts baseDir for discovery", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir);
    const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "base-dir-agent-test",
      agentId: "veryfront",
      baseDir: rootDir,
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

Deno.test("startNodeVeryfrontCloudAgentService preserves startup error when registration rollback fails", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir, "support");
    const originalFetch = globalThis.fetch;
    const originalClearInterval = globalThis.clearInterval;
    const rollbackError = new Error("registration stop failed");
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            service: {
              id: "22222222-2222-4222-a222-222222222222",
              service_name: "registered-rollback-test",
              service_key: "registered-rollback-test:key",
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
    globalThis.clearInterval = ((timerId) => {
      originalClearInterval(timerId);
      throw rollbackError;
    }) as typeof globalThis.clearInterval;

    try {
      const rejected = await assertRejects(
        () =>
          startNodeVeryfrontCloudAgentService({
            serviceName: "registered-rollback-test",
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
              VERYFRONT_AGENT_SERVICE_KEY: "registered-rollback-test:key",
              VERYFRONT_AGENT_SERVICE_REGISTRATION: "enabled",
              VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS: "60000",
              PORT: "-1",
              ALLOWED_ORIGINS: "https://studio.example.com",
            },
          }),
        Error,
        "Node server port must be an integer from 0 to 65535, got -1",
      );

      assertStrictEquals(rejected === rollbackError, false);
      assert(rejected instanceof Error);
      assertEquals(
        rejected.message,
        "Node server port must be an integer from 0 to 65535, got -1",
      );
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.clearInterval = originalClearInterval;
    }
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

Deno.test("hosted MCP resolver binds deployment-owned transports to first-party defaults", () => {
  const createRemoteToolSource = () => ({
    id: "injected",
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve(null),
  });
  const serviceGenericMcpServer = {
    id: "operator-docs",
    endpoint: "https://operator.example/mcp",
  } as const;
  // Project agent parsing rejects generic endpoints. This unchecked shape
  // verifies the resolver still fails closed if another caller bypasses it.
  const untrustedGenericAgentConfig = {
    mcpServers: [{ id: "operator-docs", endpoint: "https://project.example/mcp" }],
  } as unknown as Pick<RuntimeAgentMarkdownDefinition, "mcpServers">;

  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers({ createRemoteToolSource }),
    [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
  );
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers(
      { createRemoteToolSource },
      untrustedGenericAgentConfig,
    ),
    [],
  );
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers(
      { createRemoteToolSource, mcpServers: [serviceGenericMcpServer] },
      untrustedGenericAgentConfig,
    ),
    [serviceGenericMcpServer],
  );
  assertEquals(
    veryfrontCloudAgentServiceInternals.resolveMcpServers(
      { createRemoteToolSource },
      {
        mcpServers: [{
          kind: "veryfront-api",
          toolPolicy: { allow: ["read_job"] },
        }],
      },
    ),
    [{
      kind: "veryfront-api",
      toolPolicy: { allow: ["read_job"] },
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
    system: [{
      role: "system" as const,
      content: "Extract the application.",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
      },
    }],
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
  assert(Array.isArray(config?.system));
  assertEquals(config.system[0]?.providerOptions, {
    anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
  });
  assert(
    config.system.some((message) =>
      message.content.includes("Use the target project's extraction policy.")
    ),
  );
  assertEquals(steeringLookups, [
    { projectId: "target-project", authToken: "token-1", branchId: null },
    { projectId: "target-project", authToken: "token-1", branchId: null },
  ]);
});

Deno.test("hosted child execution config hides skill infrastructure for skills empty and false", async () => {
  for (const skills of [[], false] as const) {
    try {
      toolRegistryInternal.registerShared(
        "get_file",
        tool({
          id: "get_file",
          description: "Get file",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ ok: true }),
        }),
      );
      toolRegistryInternal.registerShared("load_skill_reference", createLoadSkillReferenceTool());
      toolRegistryInternal.registerShared("execute_skill_script", createExecuteSkillScriptTool());

      const childAgent = {
        id: "extraction-agent",
        name: "Extraction agent",
        description: "Extract job applications",
        instructions: "Extract the application.",
        skills,
        tools: [
          "get_file",
          "load_skill",
          "load_skill_reference",
          "execute_skill_script",
        ],
      };
      const context = {
        options: { mcpServers: [] },
        discoveryResult: { agents: new Map([["extraction-agent", null]]) },
        agentConfigs: new Map([["extraction-agent", childAgent]]),
        projectSteeringByAgentId: new Map([["extraction-agent", {
          getProjectInstructions: () => Promise.resolve("Use extraction policy."),
          getSkillsConfig: () =>
            Promise.resolve([{
              id: "global-skill",
              name: "Global skill",
              description: "Global skill",
              instructions: "Use global skill.",
              allowedTools: [],
            }]),
          createLoadSkillTool: () =>
            tool({
              id: "load_skill",
              description: "Load skill",
              inputSchema: defineSchema((v) => v.object({}))(),
              execute: () => ({ ok: true }),
            }),
        }]]),
        trace: (_name: string, operation: () => unknown) => operation(),
      } as never;
      const config = await veryfrontCloudAgentServiceInternals
        .resolveHostedChildAgentExecutionConfig(
          context,
          {
            authToken: "token-1",
            projectId: "project-1",
            branchId: "branch-1",
            agentId: "orchestrator",
          },
          "extraction-agent",
          "project-1",
        );

      assertEquals(config?.availableSkillIds, []);
      assertEquals(config?.toolNames, ["get_file"]);
      assertEquals(systemIncludes(config?.system, "global-skill"), false);
      assertEquals(systemIncludes(config?.system, "load_skill"), false);
      assertEquals(systemIncludes(config?.system, "load_skill_reference"), false);
      assertEquals(systemIncludes(config?.system, "execute_skill_script"), false);
      const childToolContext = veryfrontCloudAgentServiceInternals.buildHostedChildToolContext(
        {
          authToken: "token-1",
          projectId: "project-1",
          branchId: "branch-1",
          agentId: "orchestrator",
        },
        "extraction-agent",
        config,
      );
      const hostTools = veryfrontCloudAgentServiceInternals.buildHostedChildGlobalTools(
        context,
        {
          childAgentId: "extraction-agent",
          childConfig: config,
          childToolContext,
        },
      );

      assertEquals("get_file" in hostTools, true);
      assertEquals("load_skill" in hostTools, false);
      assertEquals("load_skill_reference" in hostTools, false);
      assertEquals("execute_skill_script" in hostTools, false);
    } finally {
      toolRegistryInternal.clearAll();
    }
  }
});

Deno.test("hosted child execution config keeps exact non-empty skill authorization", async () => {
  try {
    toolRegistryInternal.registerShared(
      "get_file",
      tool({
        id: "get_file",
        description: "Get file",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      }),
    );
    const childAgent = {
      id: "extraction-agent",
      name: "Extraction agent",
      description: "Extract job applications",
      instructions: "Extract the application.",
      skills: ["extract"],
      tools: ["get_file"],
    };
    const context = {
      options: { mcpServers: [] },
      discoveryResult: { agents: new Map([["extraction-agent", null]]) },
      agentConfigs: new Map([["extraction-agent", childAgent]]),
      projectSteeringByAgentId: new Map([["extraction-agent", {
        getProjectInstructions: () => Promise.resolve("Use extraction policy."),
        getSkillsConfig: () =>
          Promise.resolve([{
            id: "extraction-agent--extract",
            name: "Extract",
            description: "Extract skill",
            instructions: "Extract with skill.",
            allowedTools: [],
            ownerAgentId: "extraction-agent",
            shortName: "extract",
            sourcePath: "agents/extraction-agent/skills/extract/SKILL.md",
          }, {
            id: "global-skill",
            name: "Global skill",
            description: "Global skill",
            instructions: "Use global skill.",
            allowedTools: [],
          }]),
        createLoadSkillTool: () =>
          tool({
            id: "load_skill",
            description: "Load skill",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => ({ ok: true }),
          }),
      }]]),
      trace: (_name: string, operation: () => unknown) => operation(),
    } as never;
    const config = await veryfrontCloudAgentServiceInternals
      .resolveHostedChildAgentExecutionConfig(
        context,
        {
          authToken: "token-1",
          projectId: "project-1",
          branchId: "branch-1",
          agentId: "orchestrator",
        },
        "extraction-agent",
        "project-1",
      );

    assertEquals(config?.availableSkillIds, ["extraction-agent--extract"]);
    assertEquals(config?.toolNames, ["get_file", "load_skill"]);
    assert(systemIncludes(config?.system, "extraction-agent--extract"));
    assertEquals(systemIncludes(config?.system, "global-skill"), false);

    const childToolContext = veryfrontCloudAgentServiceInternals.buildHostedChildToolContext(
      {
        authToken: "token-1",
        projectId: "project-1",
        branchId: "branch-1",
        agentId: "orchestrator",
      },
      "extraction-agent",
      config,
    );
    const hostTools = veryfrontCloudAgentServiceInternals.buildHostedChildGlobalTools(
      context,
      {
        childAgentId: "extraction-agent",
        childConfig: config,
        childToolContext,
      },
    );

    assertEquals("get_file" in hostTools, true);
    assertEquals("load_skill" in hostTools, true);
  } finally {
    toolRegistryInternal.clearAll();
  }
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
