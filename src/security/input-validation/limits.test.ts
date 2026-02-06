import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "./errors.ts";
import { readBodyWithLimit, validateRequestLimits } from "./limits.ts";

describe("security/input-validation/limits", () => {
  describe("validateRequestLimits", () => {
    it("should pass for normal requests", () => {
      const req = new Request("http://localhost/api/data", {
        headers: { "Content-Length": "100" },
      });

      validateRequestLimits(req);
    });

    it("should reject URLs that are too long", () => {
      const req = new Request("http://localhost/" + "a".repeat(10000));

      assertThrows(
        () => validateRequestLimits(req, { maxUrlLength: 100 }),
        VeryfrontError,
        "URL too long",
      );
    });

    it("should reject bodies that are too large", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Length": "999999999" },
      });

      assertThrows(
        () => validateRequestLimits(req, { maxBodySize: 1000 }),
        VeryfrontError,
        "too large",
      );
    });

    it("should reject invalid Content-Length", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Length": "not-a-number" },
      });

      assertThrows(
        () => validateRequestLimits(req),
        VeryfrontError,
        "Invalid Content-Length",
      );
    });

    it("should reject oversized headers", () => {
      const headers: Record<string, string> = {};

      for (let i = 0; i < 100; i++) {
        headers[`X-Custom-Header-${i}`] = "x".repeat(1000);
      }

      const req = new Request("http://localhost/", { headers });

      assertThrows(
        () => validateRequestLimits(req, { maxHeaderSize: 1000 }),
        VeryfrontError,
        "Headers too large",
      );
    });
  });

  describe("readBodyWithLimit", () => {
    it("should read body within limit", async () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        body: "hello world",
      });

      const text = await readBodyWithLimit(req, 1024);

      assertEquals(text, "hello world");
    });

    it("should reject body exceeding limit", async () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        body: "x".repeat(100),
      });

      await assertRejects(
        () => readBodyWithLimit(req, 10),
        VeryfrontError,
        "exceeds size limit",
      );
    });

    it("should reject request with no body", async () => {
      const req = new Request("http://localhost/");

      await assertRejects(
        () => readBodyWithLimit(req),
        VeryfrontError,
        "No request body",
      );
    });
  });
});
