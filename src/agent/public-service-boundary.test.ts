import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicAgentApi from "./index.ts";

it("keeps the process-global agent service bootstrap off the public barrel", () => {
  assertEquals("startAgentService" in publicAgentApi, false);
  assertEquals(typeof publicAgentApi.startNodeVeryfrontCloudAgentService, "function");
});
