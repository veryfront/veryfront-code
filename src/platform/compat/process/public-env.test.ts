import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicEnv from "veryfront/platform/env";
import * as publicPlatform from "veryfront/platform";

it("keeps host and trusted-snapshot readers outside veryfront/platform/env", () => {
  assertEquals(Object.keys(publicEnv).sort(), [
    "getEnv",
    "getEnvBoolean",
    "getEnvNumber",
    "getEnvString",
  ]);
  assertEquals("env" in publicEnv, false);
  assertEquals("getHostEnv" in publicEnv, false);
  assertEquals("getTrustedProjectEnvSnapshot" in publicEnv, false);
  assertEquals("registerTrustedProjectEnvSnapshot" in publicEnv, false);
});

it("keeps host-private credential accessors off both public surfaces", () => {
  for (const name of ["setHostSecret", "getHostSecret", "deleteHostSecret"]) {
    assertEquals(name in publicEnv, false);
    assertEquals(name in publicPlatform, false);
  }
});

it("keeps process-wide env mutators outside veryfront/platform/env", () => {
  assertEquals("setEnv" in publicEnv, false);
  assertEquals("deleteEnv" in publicEnv, false);
});

it("keeps process-wide env mutators outside veryfront/platform", () => {
  assertEquals("chdir" in publicPlatform, false);
  assertEquals("env" in publicPlatform, false);
  assertEquals("setEnv" in publicPlatform, false);
  assertEquals("deleteEnv" in publicPlatform, false);
  assertEquals("exit" in publicPlatform, false);
  assertEquals("liveHostRuntime" in publicPlatform, false);
  assertEquals("onGlobalError" in publicPlatform, false);
  assertEquals("onSignal" in publicPlatform, false);
  assertEquals("runtime" in publicPlatform, false);
  assertEquals("getAdapter" in publicPlatform, false);
  assertEquals("getLocalAdapter" in publicPlatform, false);
  assertEquals("getDenoRuntime" in publicPlatform, false);
});
