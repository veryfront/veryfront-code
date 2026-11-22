// Replaces the host Object.freeze, so this regression runs in the Deno
// integration suite rather than a hermetic unit module.
import {
  formatProviderRequestRejection,
  readProviderErrorDiagnostic,
  readProviderRequestRejectionMessage,
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

  it("keeps refusing injected text when project code replaces array and string intrinsics", () => {
    const prefix = "The model provider rejected the request with HTTP ";
    const arrayIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    const stringSplit = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
    const regExpTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!;
    const messages = [`${prefix}400 (<PRIVATE_PAYLOAD>).`, `${prefix}4xx.`];
    const results: (string | undefined)[] = [];
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        writable: true,
        value: function* () {},
      });
      Object.defineProperty(String.prototype, Symbol.split, {
        configurable: true,
        writable: true,
        value: () => ["invalid_request_error"],
      });
      Object.defineProperty(RegExp.prototype, "test", {
        configurable: true,
        writable: true,
        value: () => true,
      });
      // Indexed on purpose: the replaced iterator would skip a for...of loop here too.
      for (let index = 0; index < messages.length; index++) {
        results[index] = readProviderRequestRejectionMessage(messages[index]);
      }
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, arrayIterator);
      if (stringSplit) Object.defineProperty(String.prototype, Symbol.split, stringSplit);
      else delete (String.prototype as { [Symbol.split]?: unknown })[Symbol.split];
      Object.defineProperty(RegExp.prototype, "test", regExpTest);
    }
    assertEquals(results, [undefined, undefined]);
  });

  it("formats only allowlisted fields when project code replaces Array.prototype.push", () => {
    const error = new Error("<REDACTED>");
    recordProviderErrorDiagnostic(error, "invalid_request_error", undefined, undefined);
    const push = Object.getOwnPropertyDescriptor(Array.prototype, "push")!;
    try {
      Object.defineProperty(Array.prototype, "push", {
        configurable: true,
        writable: true,
        value(this: unknown[]) {
          this[this.length] = "<PRIVATE_PAYLOAD>";
          return this.length;
        },
      });
      const message = formatProviderRequestRejection(400, error);
      Object.defineProperty(Array.prototype, "push", push);
      assertEquals(
        message,
        "The model provider rejected the request with HTTP 400 (invalid_request_error).",
      );
    } finally {
      Object.defineProperty(Array.prototype, "push", push);
    }
  });
});
