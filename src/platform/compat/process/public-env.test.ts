import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicEnv from "veryfront/platform/env";

it("keeps host and trusted-snapshot readers outside veryfront/platform/env", () => {
  assertEquals(Object.keys(publicEnv).sort(), [
    "deleteEnv",
    "env",
    "getEnv",
    "getEnvBoolean",
    "getEnvNumber",
    "getEnvString",
    "setEnv",
  ]);
  assertEquals("getHostEnv" in publicEnv, false);
  assertEquals("getTrustedProjectEnvSnapshot" in publicEnv, false);
  assertEquals("registerTrustedProjectEnvSnapshot" in publicEnv, false);
});
