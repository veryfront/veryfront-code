import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun } from "../runtime.ts";
import { getV8HeapSizeLimit } from "./lifecycle.ts";

describe("platform/compat/process/lifecycle", () => {
  it("rejects Bun's moving node:v8 compatibility heap limit", () => {
    if (!isBun) return;
    assertEquals(
      getV8HeapSizeLimit(),
      undefined,
      "Bun's process-derived node:v8 shim value is not a fixed heap ceiling",
    );
  });
});
