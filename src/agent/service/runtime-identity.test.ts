import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  getServiceRuntimeIdentity,
  initializeServiceRuntimeIdentity,
  resolveServiceRuntimeName,
} from "./runtime-identity.ts";

it("service display names use an explicit override or the machine hostname", () => {
  assertEquals(resolveServiceRuntimeName("  Agent service 2  ", () => "host-1"), "Agent service 2");
  assertEquals(resolveServiceRuntimeName(" ", () => "host-1"), "host-1");
  assertEquals(resolveServiceRuntimeName(undefined, () => "h".repeat(200)), "h".repeat(128));
  assertEquals(resolveServiceRuntimeName(undefined, () => ""), "Service runtime");
  assertEquals(
    resolveServiceRuntimeName(undefined, () => {
      throw new Error("unavailable");
    }),
    "Service runtime",
  );
});

it("service display names reject values that cannot be safely reported", () => {
  assertThrows(() => resolveServiceRuntimeName("x".repeat(129)), Error, "128 UTF-16 code units");
  assertThrows(() => resolveServiceRuntimeName("name\nforged"), Error, "control characters");
  assertThrows(() => resolveServiceRuntimeName("bad\ud800"), Error, "valid Unicode");
  assertEquals(resolveServiceRuntimeName("服务 🚀"), "服务 🚀");
  assertEquals(resolveServiceRuntimeName("🚀".repeat(64)), "🚀".repeat(64));
  assertThrows(() => resolveServiceRuntimeName("🚀".repeat(65)), Error, "128 UTF-16 code units");
});

it("the service process identity is immutable and stable", () => {
  const identity = getServiceRuntimeIdentity();
  assertEquals(getServiceRuntimeIdentity(), identity);
  assertEquals(
    initializeServiceRuntimeIdentity({ VERYFRONT_RUNTIME_NAME: "Later runtime" }),
    identity,
  );
  assertEquals(Object.isFrozen(identity), true);
  assertEquals(identity.mode, "service");
});
