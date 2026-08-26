import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicEnv from "veryfront/platform/env";
import * as publicPlatform from "veryfront/platform";

it("keeps host and trusted-snapshot readers outside veryfront/platform/env", () => {
  assertEquals(Object.keys(publicEnv).sort(), [
    "env",
    "getEnv",
    "getEnvBoolean",
    "getEnvNumber",
    "getEnvString",
  ]);
  assertEquals("getHostEnv" in publicEnv, false);
  assertEquals("getTrustedProjectEnvSnapshot" in publicEnv, false);
  assertEquals("registerTrustedProjectEnvSnapshot" in publicEnv, false);
});

it("keeps process-wide env mutators outside veryfront/platform/env", () => {
  assertEquals("setEnv" in publicEnv, false);
  assertEquals("deleteEnv" in publicEnv, false);
});

it("keeps process-wide env mutators outside veryfront/platform", () => {
  assertEquals("setEnv" in publicPlatform, false);
  assertEquals("deleteEnv" in publicPlatform, false);
  assertEquals("liveHostRuntime" in publicPlatform, false);
});
