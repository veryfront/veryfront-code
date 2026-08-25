import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { snapshotJsonValue } from "./json-snapshot.ts";

describe("provider/runtime-loader/json-snapshot", () => {
  it("rejects proxy options before descriptor inspection", () => {
    let descriptorReads = 0;
    const options = new Proxy(
      { maxDepth: 1 },
      {
        getOwnPropertyDescriptor() {
          descriptorReads += 1;
          throw new TypeError("options descriptor trap must not run");
        },
      },
    );

    assertThrows(
      () => snapshotJsonValue(null, options),
      TypeError,
      "Provider JSON snapshot options could not be inspected",
    );
    assertEquals(descriptorReads, 0);
  });

  it("preserves plain own-data options", () => {
    assertEquals(
      snapshotJsonValue({ b: 1, a: 2 }, { sortObjectKeys: false }),
      { b: 1, a: 2 },
    );
  });
});
