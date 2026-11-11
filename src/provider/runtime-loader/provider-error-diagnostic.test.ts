import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatProviderRequestRejection,
  readProviderRequestRejectionMessage,
  recordProviderErrorDiagnostic,
} from "./provider-error-diagnostic.ts";

describe("provider/runtime-loader/provider-error-diagnostic", () => {
  describe("formatProviderRequestRejection", () => {
    it("names the status and only the allowlisted fields", () => {
      const error = new Error("Private provider wording <REDACTED>");
      recordProviderErrorDiagnostic(error, "invalid_request_error", "invalid_value", "max_tokens");

      assertEquals(
        formatProviderRequestRejection(400, error),
        "The model provider rejected the request with HTTP 400 (invalid_request_error, invalid_value, parameter max_tokens).",
      );
    });

    it("drops fields that are not allowlisted", () => {
      const error = new Error("<REDACTED>");
      recordProviderErrorDiagnostic(error, "<REDACTED>", "<TOKEN>", "user.secret");

      assertEquals(
        formatProviderRequestRejection(422, error),
        "The model provider rejected the request with HTTP 422.",
      );
    });
  });

  describe("readProviderRequestRejectionMessage", () => {
    it("accepts every message the formatter produces", () => {
      const error = new Error("<REDACTED>");
      recordProviderErrorDiagnostic(error, "invalid_request_error", undefined, "tools[2].type");
      for (
        const message of [
          formatProviderRequestRejection(400, error),
          formatProviderRequestRejection(404, new Error("<REDACTED>")),
        ]
      ) {
        assertEquals(readProviderRequestRejectionMessage(message), message, message);
      }
    });

    it("refuses anything outside the grammar and allowlists", () => {
      const prefix = "The model provider rejected the request with HTTP ";
      for (
        const message of [
          undefined,
          42,
          "Provider stream failed",
          `${prefix}500.`,
          `${prefix}400`,
          `${prefix}400 <REDACTED>.`,
          `${prefix}400 (<REDACTED>).`,
          `${prefix}400 (invalid_request_error, <PROMPT>).`,
          `${prefix}400 (parameter user.secret).`,
          `${prefix}400 (invalid_request_error, invalid_value, parameter max_tokens, model).`,
          `${prefix}400 (invalid_request_error).${"x".repeat(600)}`,
        ]
      ) {
        assertEquals(readProviderRequestRejectionMessage(message), undefined, String(message));
      }
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
