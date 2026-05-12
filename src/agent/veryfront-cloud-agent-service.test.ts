import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { toolRegistry } from "#veryfront/tool";
import { agentRegistry } from "./composition/index.ts";
import { createNodeVeryfrontCloudAgentServiceRuntime } from "./veryfront-cloud-agent-service.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = Deno.makeTempDirSync();
  try {
    await fn(dir);
  } finally {
    await stopEsbuild();
    Deno.removeSync(dir, { recursive: true });
    agentRegistry.clearAll();
    toolRegistry.clearAll();
  }
}

function writeMarkdownAgentDefinition(rootDir: string): void {
  const agentsDir = resolve(rootDir, "agents");
  Deno.mkdirSync(agentsDir, { recursive: true });
  Deno.writeTextFileSync(
    resolve(agentsDir, "veryfront.md"),
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
      'import { z } from "zod";',
      "",
      "export default tool({",
      '  id: "echo",',
      '  description: "Echo input",',
      "  inputSchema: z.object({ text: z.string() }),",
      "  execute: ({ text }) => ({ text }),",
      "});",
      "",
    ].join("\n"),
  );
}

const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

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
      entryUrl: pathToFileURL(resolve(rootDir, "main.ts")),
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

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime defaults discovery to cwd", async () => {
  await withTempDir(async (rootDir) => {
    writeMarkdownAgentDefinition(rootDir);
    const previousCwd = Deno.cwd();
    Deno.chdir(rootDir);
    try {
      const bundle = await createNodeVeryfrontCloudAgentServiceRuntime({
        serviceName: "cwd-agent-test",
        agentId: "veryfront",
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

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime accepts entrypointUrl alias", async () => {
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
        entryUrl: pathToFileURL(resolve(rootDir, "src", "main.ts")),
        createBashTool,
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
        entryUrl: pathToFileURL(resolve(rootDir, "src", "main.ts")),
        createBashTool,
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
