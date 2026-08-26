import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as publicLogger from "./index.ts";

describe("veryfront/utils/logger public export surface", () => {
  it("does not expose process-level log emitters or subscriptions", () => {
    assertEquals("__registerLogRecordEmitter" in publicLogger, false);
    assertEquals("__subscribeLogRecordEmitter" in publicLogger, false);
  });

  it("does not expose process-wide registration or reset hooks", () => {
    assertEquals("__registerRequestContextGetter" in publicLogger, false);
    assertEquals("__registerTraceContextGetter" in publicLogger, false);
    assertEquals("__resetLogRecordEmitterForTests" in publicLogger, false);
    assertEquals("__resetTraceContextGetterForTests" in publicLogger, false);
  });

  it("exports immutable shared logger facades", () => {
    for (
      const name of [
        "agentLogger",
        "bundlerLogger",
        "cliLogger",
        "logger",
        "proxyLogger",
        "rendererLogger",
        "serverLogger",
      ] as const
    ) {
      assertEquals(Object.isFrozen(publicLogger[name]), true, `${name} must be immutable`);
      assertEquals(Reflect.set(publicLogger[name], "info", () => {}), false);
    }
  });

  it("returns an immutable public base logger facade", () => {
    const baseLogger = publicLogger.getBaseLogger("SERVER");

    assertEquals(Object.isFrozen(baseLogger), true);
    assertEquals(Reflect.set(baseLogger, "info", () => {}), false);
    assertEquals(Object.isFrozen(baseLogger.child({ request_id: "req-test" })), true);
    assertEquals(Object.isFrozen(baseLogger.component("test")), true);
  });
});
