// Replaces the host Object.freeze, so this regression runs in the Deno
// integration suite rather than a hermetic unit module.
import {
  readProviderErrorDiagnostic,
  recordProviderErrorDiagnostic,
} from "#veryfront/provider/runtime-loader/provider-error-diagnostic.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("provider error diagnostic intrinsics", () => {
  it("stores the frozen validated diagnostic while Object.freeze stays replaced", () => {
    const error = new Error("provider rejected request");
    const forged = { type: "attacker_type", code: "attacker_code", param: "secret.path" };
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze")!;
    let replacementCalls = 0;
    try {
      Object.defineProperty(Object, "freeze", {
        ...freezeDescriptor,
        value: () => {
          replacementCalls++;
          return forged;
        },
      });
      recordProviderErrorDiagnostic(error, "invalid_request_error", "invalid_tool_schema", "model");
    } finally {
      Object.defineProperty(Object, "freeze", freezeDescriptor);
    }

    const diagnostic = readProviderErrorDiagnostic(error);
    assertEquals(replacementCalls, 0);
    assertEquals(diagnostic, {
      type: "invalid_request_error",
      code: "invalid_tool_schema",
      param: "model",
    });
    assertEquals(diagnostic === (forged as unknown), false);
    assertStrictEquals(Object.isFrozen(diagnostic), true);
  });
});
