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
  });
});
