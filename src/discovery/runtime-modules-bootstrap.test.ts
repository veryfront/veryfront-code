import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DISCOVERY_GLOBAL_VERYFRONT_MODULES } from "./import-rewriter.ts";
import "./runtime-modules-bootstrap.ts";
import { getDiscoveryRuntimeModules } from "./runtime-modules.ts";
import type { DiscoveryRuntimeModuleName } from "./runtime-modules.ts";

/**
 * One export per registered name that only that namespace provides, so a
 * copy-paste slip swapping two entries of the bootstrap literal is caught.
 * The Record type keeps the table honest: a new registered module without a
 * signature export is a type error.
 *
 * veryfront-issue-inbox#217: API routes import the middleware pipeline from
 * "veryfront/middleware"; a compiled binary must register the right namespace
 * so the generated subpath shim re-exports MiddlewarePipeline instead of 500ing.
 */
const SIGNATURE_EXPORTS: Record<DiscoveryRuntimeModuleName, string> = {
  "veryfront": "createValidatedHandler",
  "veryfront/agent": "AgentRuntime",
  "veryfront/tool": "dynamicTool",
  "veryfront/platform": "createFSAdapter",
  "veryfront/prompt": "prompt",
  "veryfront/resource": "resource",
  "veryfront/embedding": "createUploadHandler",
  "veryfront/knowledge": "projectKnowledge",
  "veryfront/workflow": "createWorkflowClient",
  "veryfront/eval": "evalAgent",
  "veryfront/metrics": "counter",
  "veryfront/schemas": "defineSchema",
  "veryfront/integrations": "executeRemoteIntegrationTool",
  "veryfront/middleware": "MiddlewarePipeline",
  "veryfront/chat/uploads": "createChatUploadHandler",
};

describe("compiled discovery runtime modules", () => {
  it("registers every module rewritten to a compiled-binary global", () => {
    const modules = getDiscoveryRuntimeModules();

    assertEquals(Object.keys(modules).sort(), [...DISCOVERY_GLOBAL_VERYFRONT_MODULES].sort());

    for (const name of DISCOVERY_GLOBAL_VERYFRONT_MODULES) {
      const exportName = SIGNATURE_EXPORTS[name];
      assertEquals(
        typeof (modules[name] as Record<string, unknown>)[exportName],
        "function",
        `${name} must be registered with its own namespace (missing ${exportName})`,
      );
    }
  });

  it("registers only the public metrics facade", () => {
    const metricsModule = getDiscoveryRuntimeModules()["veryfront/metrics"] as Record<
      string,
      unknown
    >;

    assertEquals("__resetForTests" in metricsModule, false);
    assertEquals("__flushForTests" in metricsModule, false);
    assertEquals(Object.isFrozen(metricsModule.metrics), true);
  });
});
