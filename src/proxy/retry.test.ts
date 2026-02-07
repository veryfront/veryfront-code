import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { isRetryableConnectionError } from "./retry.ts";

describe("isRetryableConnectionError", () => {
  it("returns false for non-Error values", () => {
    assertEquals(isRetryableConnectionError(null), false);
    assertEquals(isRetryableConnectionError(undefined), false);
    assertEquals(isRetryableConnectionError("string error"), false);
    assertEquals(isRetryableConnectionError(42), false);
  });

  it("returns true for connection reset errors", () => {
    assertEquals(isRetryableConnectionError(new Error("connection reset by peer")), true);
    assertEquals(
      isRetryableConnectionError(new Error("Connection reset by peer (os error 104)")),
      true,
    );
  });

  it("returns true for connection closed errors", () => {
    assertEquals(
      isRetryableConnectionError(new Error("connection closed before message completed")),
      true,
    );
    assertEquals(
      isRetryableConnectionError(new Error("client error (SendRequest): connection closed")),
      true,
    );
  });

  it("returns true for connection refused errors", () => {
    assertEquals(isRetryableConnectionError(new Error("connection refused")), true);
    assertEquals(
      isRetryableConnectionError(new Error("tcp connect error: Connection refused (os error 111)")),
      true,
    );
  });

  it("returns true for OS error codes", () => {
    assertEquals(isRetryableConnectionError(new Error("os error 104")), true);
    assertEquals(isRetryableConnectionError(new Error("os error 111")), true);
  });

  it("returns false for timeout errors", () => {
    assertEquals(isRetryableConnectionError(new Error("Request timeout")), false);
    assertEquals(isRetryableConnectionError(new Error("Gateway timeout")), false);
  });

  it("returns false for other errors", () => {
    assertEquals(isRetryableConnectionError(new Error("Not found")), false);
    assertEquals(isRetryableConnectionError(new Error("Internal server error")), false);
    assertEquals(isRetryableConnectionError(new TypeError("Cannot read property")), false);
  });

  it("handles real error messages from production logs", () => {
    // Actual error messages from production logs
    assertEquals(
      isRetryableConnectionError(
        new TypeError(
          "error sending request from 10.192.0.35:60358 for http://veryfront-server/ (10.193.189.155:80): client error (SendRequest): connection error: Connection reset by peer (os error 104)",
        ),
      ),
      true,
    );

    assertEquals(
      isRetryableConnectionError(
        new TypeError(
          "error sending request from 10.192.0.35:46166 for http://veryfront-server/ (10.193.189.155:80): client error (SendRequest): connection closed before message completed",
        ),
      ),
      true,
    );

    assertEquals(
      isRetryableConnectionError(
        new TypeError(
          "error sending request for url (http://veryfront-server/_vf_modules/components/Welcome.js): client error (Connect): tcp connect error: Connection refused (os error 111)",
        ),
      ),
      true,
    );
  });
});
