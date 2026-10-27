import "#veryfront/schemas/_test-setup.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { getServiceRuntimeIdentity } from "#veryfront/agent/service/runtime-identity.ts";
import { createNodeVeryfrontCloudAgentServiceRuntime } from "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts";
import {
  deleteEnv,
  getHostEnv,
  getHostEnvExcludingEnvFile,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
import {
  clearEnvFileValueSource,
  hasEnvFileValueSource,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

export async function verifyRuntimeIdentityStartup(source: "env" | "processTarget") {
  const encode = globalThis.encodeURIComponent;
  const previousName = getHostEnv("VERYFRONT_RUNTIME_NAME");
  const previousEnvFileSource = hasEnvFileValueSource("VERYFRONT_RUNTIME_NAME");
  const rootDir = await mkdtemp(join(tmpdir(), "service-identity-"));
  setEnv("VERYFRONT_RUNTIME_NAME", "project env-file identity");
  markEnvFileValue("VERYFRONT_RUNTIME_NAME");
  try {
    assertEquals(getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME"), undefined);
    await mkdir(join(rootDir, "agents"));
    await writeFile(
      join(rootDir, "agents", "support.ts"),
      [
        'import { agent } from "veryfront/agent";',
        'process.env.VERYFRONT_RUNTIME_NAME = "project-forged-runtime";',
        'globalThis.encodeURIComponent = () => { throw new Error("project encoder invoked"); };',
        'export default agent({ id: "support", model: "openai/gpt-5.4", system: "Help users." });',
      ].join("\n"),
    );
    const environment = {
      VERYFRONT_RUNTIME_NAME: "Resolved operator runtime",
      NODE_ENV: "test",
      VERYFRONT_API_URL: "https://api.example.test",
      PORT: "3154",
      ALLOWED_ORIGINS: "https://studio.example.test",
    };
    const serviceEnvironment = (env: typeof environment) =>
      source === "env"
        ? {
          env,
          processTarget: {
            on: () => {},
            env: { ...env, VERYFRONT_RUNTIME_NAME: "Ignored target runtime" },
          },
        }
        : { processTarget: { env, on: () => {} } };
    for (const invalidName of ["x".repeat(129), "bad\nname", "bad\ud800"]) {
      await assertRejects(
        () =>
          createNodeVeryfrontCloudAgentServiceRuntime({
            serviceName: "invalid-identity-startup-test",
            projectDir: rootDir,
            baseDir: rootDir,
            createBashTool: () => Promise.resolve({ tools: {} }),
            ...serviceEnvironment({ ...environment, VERYFRONT_RUNTIME_NAME: invalidName }),
          }),
        Error,
        "VERYFRONT_RUNTIME_NAME",
      );
      assertEquals(getHostEnv("VERYFRONT_RUNTIME_NAME"), "project env-file identity");
      assertEquals(hasEnvFileValueSource("VERYFRONT_RUNTIME_NAME"), true);
    }
    await createNodeVeryfrontCloudAgentServiceRuntime({
      serviceName: "identity-startup-test",
      agentSource: "code",
      projectDir: rootDir,
      baseDir: rootDir,
      createBashTool: () => Promise.resolve({ tools: {} }),
      mcpServers: [],
      signals: [],
      ...serviceEnvironment(environment),
    });
    assertEquals(getHostEnv("VERYFRONT_RUNTIME_NAME"), "project-forged-runtime");
    assertEquals(getServiceRuntimeIdentity().name, "Resolved operator runtime");
  } finally {
    globalThis.encodeURIComponent = encode;
    if (previousName === undefined) deleteEnv("VERYFRONT_RUNTIME_NAME");
    else setEnv("VERYFRONT_RUNTIME_NAME", previousName);
    if (previousEnvFileSource) markEnvFileValue("VERYFRONT_RUNTIME_NAME");
    else clearEnvFileValueSource("VERYFRONT_RUNTIME_NAME");
    await stopEsbuild();
    await rm(rootDir, { recursive: true, force: true });
  }
}
