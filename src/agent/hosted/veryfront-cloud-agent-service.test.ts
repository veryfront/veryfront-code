import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { SandboxShellToolsProviderName } from "#veryfront/extensions/sandbox/index.ts";
import { toolRegistry } from "#veryfront/tool";
import { agentRegistry } from "../composition/index.ts";
import {
  createNodeVeryfrontCloudAgentServiceRuntime,
  startNodeVeryfrontCloudAgentService,
  veryfrontApiMcpServer,
  veryfrontStudioMcpServer,
} from "./veryfront-cloud-agent-service.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

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

Deno.test("Veryfront MCP server helpers create explicit server configs", () => {
  assertEquals(veryfrontApiMcpServer(), { kind: "veryfront-api" });
  assertEquals(veryfrontStudioMcpServer(), { kind: "veryfront-studio" });
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
