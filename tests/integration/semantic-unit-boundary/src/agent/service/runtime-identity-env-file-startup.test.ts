import { resolveDefaultProcessTarget } from "#veryfront/agent/hosted/cloud-agent-paths.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createNodeVeryfrontCloudAgentServiceContext } from "#veryfront/agent/hosted/cloud-agent-config.ts";
import {
  getServiceRuntimeIdentity,
  resolveServiceRuntimeName,
} from "#veryfront/agent/service/runtime-identity.ts";
import {
  deleteEnv,
  getHostEnvExcludingEnvFile,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
import {
  clearEnvFileValueSource,
  markEnvFileValue,
} from "#veryfront/platform/compat/process/env.ts";

it("default standalone identity excludes project env-file values", () => {
  const previous = getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME");
  setEnv("VERYFRONT_RUNTIME_NAME", "project env-file identity");
  markEnvFileValue("VERYFRONT_RUNTIME_NAME");
  try {
    const trustedName = resolveServiceRuntimeName(
      getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME"),
    );
    createNodeVeryfrontCloudAgentServiceContext({
      serviceName: "env-file-identity",
      processTarget: resolveDefaultProcessTarget(),
      createBashTool: () => Promise.resolve({ tools: {} }),
    });
    assertEquals(getServiceRuntimeIdentity().name, trustedName);
  } finally {
    clearEnvFileValueSource("VERYFRONT_RUNTIME_NAME");
    if (previous === undefined) deleteEnv("VERYFRONT_RUNTIME_NAME");
    else setEnv("VERYFRONT_RUNTIME_NAME", previous);
  }
});
