import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as utils from "veryfront/utils";

describe("veryfront/utils public export surface", () => {
  it("does not expose test-only logger reset helpers", () => {
    assertEquals("__resetLoggerConfigForTests" in utils, false);
    assertEquals("__resetLogRecordEmitterForTests" in utils, false);
  });
});
