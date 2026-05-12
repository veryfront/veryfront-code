import { assertEquals } from "#veryfront/testing/assert.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { createNodeVeryfrontCloudAgentServiceRuntime } from "./veryfront-cloud-agent-service.ts";

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = Deno.makeTempDirSync();
  try {
    return fn(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

function writeAgentDefinition(rootDir: string): void {
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

const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

Deno.test("createNodeVeryfrontCloudAgentServiceRuntime loads the markdown agent and binds service routes", async () => {
  await withTempDir(async (rootDir) => {
    writeAgentDefinition(rootDir);

    const bundle = createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "veryfront-agent-test",
      agentId: "veryfront",
      entryUrl: pathToFileURL(resolve(rootDir, "src", "main.ts")),
      createBashTool,
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
    assertEquals(bundle.runtime.contract.agents.veryfront.id, "veryfront");
    assertEquals(bundle.runtime.contract.agents.veryfront.config.model, "openai/gpt-5.4");

    const liveness = await bundle.runtime.request("http://localhost/liveness");
    assertEquals(liveness.status, 200);
    assertEquals(await liveness.text(), "OK");
  });
});
