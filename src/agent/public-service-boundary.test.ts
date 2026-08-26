import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicAgentApi from "./index.ts";

it("keeps the process-global agent service bootstrap off the public barrel", () => {
  assertEquals("startAgentService" in publicAgentApi, false);
  assertEquals("initializeNodeAgentServiceOpenTelemetry" in publicAgentApi, false);
  assertEquals("initializeNodeHostedAgentServiceOpenTelemetry" in publicAgentApi, false);
  assertEquals("installAbortRejectionGuard" in publicAgentApi, false);
  assertEquals("bootstrapAgentService" in publicAgentApi, false);
  assertEquals("runAgentServiceMain" in publicAgentApi, false);
  assertEquals("loadAgentServiceEnvFiles" in publicAgentApi, false);
  assertEquals("loadHostedAgentServiceEnvFiles" in publicAgentApi, false);
  assertEquals(typeof publicAgentApi.startNodeVeryfrontCloudAgentService, "function");
});
