import "#veryfront/schemas/_test-setup.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { HostToolSet } from "#veryfront/tool";
import {
  createHostedRootLocalToolRuntime,
  prepareHostedRootSandboxToolSource,
} from "./root-sandbox-tool-source.ts";
import type { DefaultHostedChatRuntimeTaskContext } from "./default-chat-runtime.ts";

const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

function createSandboxTools(): HostToolSet {
  return {
    bash: {
      description: "Run shell commands",
      inputSchema: defineSchema((v) => v.object({ command: v.string() }))(),
      execute: ({ command }) => ({ command }),
    },
    get_background_command: {
      description: "Get a background command",
      inputSchema: defineSchema((v) => v.object({ commandId: v.string() }))(),
      execute: ({ commandId }) => ({ commandId }),
    },
  };
}

Deno.test("prepareHostedRootSandboxToolSource exposes the sandbox source when bash is selected", async () => {
  const factoryInputs: Array<{ apiUrl?: string | URL; authToken?: string }> = [];
  let closeCalls = 0;

  const source = await prepareHostedRootSandboxToolSource({
    allowedToolNames: ["bash"],
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    getProjectId: () => "project-1",
    createBashTool,
    createAgentServiceSandboxTools: (input) => {
      factoryInputs.push(input);
      return Promise.resolve({
        tools: createSandboxTools(),
        closeSandbox: () => {
          closeCalls += 1;
          return Promise.resolve();
        },
      });
    },
  });

  assertEquals(Object.keys(source.tools).sort(), ["bash", "get_background_command"]);
  assertEquals(factoryInputs.map((input) => [input.apiUrl, input.authToken]), [
    ["https://api.example.com", "token-1"],
  ]);
  await source.closeRuntime?.();
  assertEquals(closeCalls, 1);
});

Deno.test("prepareHostedRootSandboxToolSource treats unrestricted tools as a bash selection", async () => {
  let factoryCalls = 0;

  const source = await prepareHostedRootSandboxToolSource({
    allowedToolNames: undefined,
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    getProjectId: () => "project-1",
    createBashTool,
    createAgentServiceSandboxTools: () => {
      factoryCalls += 1;
      return Promise.resolve({
        tools: createSandboxTools(),
        closeSandbox: () => Promise.resolve(),
      });
    },
  });

  assertEquals(factoryCalls, 1);
  assertEquals("bash" in source.tools, true);
});

Deno.test("prepareHostedRootSandboxToolSource initializes for a bundled background command tool", async () => {
  let factoryCalls = 0;

  const source = await prepareHostedRootSandboxToolSource({
    allowedToolNames: ["get_background_command"],
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    getProjectId: () => "project-1",
    createBashTool,
    createAgentServiceSandboxTools: () => {
      factoryCalls += 1;
      return Promise.resolve({
        tools: createSandboxTools(),
        closeSandbox: () => Promise.resolve(),
      });
    },
  });

  assertEquals(factoryCalls, 1);
  assertEquals("get_background_command" in source.tools, true);
});

Deno.test("prepareHostedRootSandboxToolSource skips initialization when no sandbox tool is selected", async () => {
  let factoryCalls = 0;

  for (const allowedToolNames of [[], ["get_agent"]]) {
    const source = await prepareHostedRootSandboxToolSource({
      allowedToolNames,
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      getProjectId: () => "project-1",
      createBashTool,
      createAgentServiceSandboxTools: () => {
        factoryCalls += 1;
        return Promise.resolve({
          tools: createSandboxTools(),
          closeSandbox: () => Promise.resolve(),
        });
      },
    });

    assertEquals(source, { tools: {} });
  }

  assertEquals(factoryCalls, 0);
});

Deno.test("createHostedRootLocalToolRuntime merges sandbox tools and owns their cleanup", async () => {
  let getProjectId: (() => string | null | undefined) | undefined;
  let factoryCalls = 0;
  let closeCalls = 0;
  const taskContext: DefaultHostedChatRuntimeTaskContext = {
    authToken: "token-1",
    projectId: "project-1",
    branchId: null,
    model: "openai/gpt-5.4-nano",
  };
  const runtime = createHostedRootLocalToolRuntime({
    allowedToolNames: ["bash"],
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    createBashTool,
    buildBaseTools: () => ({ sleep: createSandboxTools().bash }),
    createAgentServiceSandboxTools: (input) => {
      factoryCalls += 1;
      getProjectId = input.getProjectId;
      return Promise.resolve({
        tools: createSandboxTools(),
        closeSandbox: () => {
          closeCalls += 1;
          return Promise.resolve();
        },
      });
    },
  });

  assertEquals(Object.keys(await runtime.buildLocalTools(taskContext)).sort(), [
    "bash",
    "get_background_command",
    "sleep",
  ]);
  assertEquals(Object.keys(await runtime.buildLocalTools(taskContext)).sort(), [
    "bash",
    "get_background_command",
    "sleep",
  ]);
  assertEquals(factoryCalls, 1);
  assertEquals(getProjectId?.(), "project-1");
  taskContext.projectId = "project-2";
  assertEquals(getProjectId?.(), "project-2");
  await runtime.cleanup();
  await runtime.cleanup();
  assertEquals(closeCalls, 1);
});

Deno.test("createHostedRootLocalToolRuntime waits for in-flight setup before cleanup", async () => {
  let resolveSandboxTools:
    | ((value: {
      tools: HostToolSet;
      closeSandbox: () => Promise<void>;
    }) => void)
    | undefined;
  let closeCalls = 0;
  const sandboxTools = new Promise<{
    tools: HostToolSet;
    closeSandbox: () => Promise<void>;
  }>((resolve) => {
    resolveSandboxTools = resolve;
  });
  const taskContext: DefaultHostedChatRuntimeTaskContext = {
    authToken: "token-1",
    projectId: "project-1",
    branchId: null,
    model: "openai/gpt-5.4-nano",
  };
  const runtime = createHostedRootLocalToolRuntime({
    allowedToolNames: ["bash"],
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    createBashTool,
    buildBaseTools: () => ({}),
    createAgentServiceSandboxTools: () => sandboxTools,
  });

  const buildPromise = runtime.buildLocalTools(taskContext);
  const cleanupPromise = runtime.cleanup();
  resolveSandboxTools?.({
    tools: createSandboxTools(),
    closeSandbox: () => {
      closeCalls += 1;
      return Promise.resolve();
    },
  });

  await buildPromise;
  await cleanupPromise;
  assertEquals(closeCalls, 1);
});
