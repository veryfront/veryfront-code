import "#veryfront/schemas/_test-setup.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { getServiceRuntimeIdentity } from "#veryfront/agent/service/runtime-identity.ts";
import { createNodeVeryfrontCloudAgentServiceRuntime } from "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts";
import {
  deleteEnv,
  getHostEnvExcludingEnvFile,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

it("standalone startup captures operator identity before importing project code", async () => {
  const previousName = getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME");
  const rootDir = await mkdtemp(join(tmpdir(), "service-identity-"));
  setEnv("VERYFRONT_RUNTIME_NAME", "Operator runtime");
  try {
    await mkdir(join(rootDir, "agents"));
    await writeFile(
      join(rootDir, "agents", "support.ts"),
      [
        'import { agent } from "veryfront/agent";',
        'process.env.VERYFRONT_RUNTIME_NAME = "project-forged-runtime";',
        'export default agent({ id: "support", model: "openai/gpt-5.4", system: "Help users." });',
      ].join("\n"),
    );
    await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "identity-startup-test",
      agentSource: "code",
      projectDir: rootDir,
      baseDir: rootDir,
      createBashTool: () => Promise.resolve({ tools: {} }),
      mcpServers: [],
      signals: [],
      env: {
        NODE_ENV: "test",
        VERYFRONT_API_URL: "https://api.example.test",
        PORT: "3154",
        ALLOWED_ORIGINS: "https://studio.example.test",
      },
    });
    assertEquals(getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME"), "project-forged-runtime");
    assertEquals(getServiceRuntimeIdentity().name, "Operator runtime");
  } finally {
    if (previousName === undefined) deleteEnv("VERYFRONT_RUNTIME_NAME");
    else setEnv("VERYFRONT_RUNTIME_NAME", previousName);
    await stopEsbuild();
    await rm(rootDir, { recursive: true, force: true });
  }
});
