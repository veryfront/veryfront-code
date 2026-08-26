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
});
