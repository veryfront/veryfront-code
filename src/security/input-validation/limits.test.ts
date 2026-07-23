import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "./errors.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
  validateContentType,
  validateRequestLimits,
} from "./limits.ts";

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

    it("should reject partially numeric and negative Content-Length values", () => {
      for (const contentLength of ["", "10oops", "-1", "+10", "1.5"]) {
        const req = new Request("http://localhost/", {
          method: "POST",
          headers: { "Content-Length": contentLength },
        });

        assertThrows(
          () => validateRequestLimits(req),
          VeryfrontError,
          "Invalid Content-Length",
        );
      }
    });

    it("should reject invalid configured limits before inspecting the request", () => {
      const req = new Request("http://localhost/");

      for (const maxBodySize of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => validateRequestLimits(req, { maxBodySize }),
          VeryfrontError,
          "Invalid request limit",
        );
      }
    });

    it("classifies an oversized declared body consistently", () => {
      const request = new Request("http://localhost/", {
        headers: { "content-length": "1025" },
      });

      const error = assertThrows(
        () => validateRequestLimits(request, { maxBodySize: 1024 }),
        VeryfrontError,
      );
      assertEquals(isRequestBodyTooLargeError(error), true);
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

    it("should measure header limits in bytes", () => {
      const req = new Request("http://localhost/", {
        headers: { "x-test": "é" },
      });

      assertThrows(
        () => validateRequestLimits(req, { maxHeaderSize: 11 }),
        VeryfrontError,
        "Headers too large",
      );
    });
  });

  describe("validateContentType", () => {
    it("should pass for matching Content-Type", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      validateContentType(req, "application/json");
    });

    it("should pass with extra parameters", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });

      validateContentType(req, "application/json");
    });

    it("should reject prefix-sharing Content-Type", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json-seq" },
      });

      assertThrows(
        () => validateContentType(req, "application/json"),
        VeryfrontError,
        "Invalid Content-Type",
      );
    });

    it("should reject mismatched Content-Type", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
      });

      assertThrows(
        () => validateContentType(req, "application/json"),
        VeryfrontError,
        "Invalid Content-Type",
      );
    });

    it("should reject missing Content-Type", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
      });

      assertThrows(
        () => validateContentType(req, "application/json"),
        VeryfrontError,
        "Missing Content-Type",
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

    it("should identify body-size errors without matching at call sites", async () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        body: "x".repeat(100),
      });

      try {
        await readBodyWithLimit(req, 10);
        throw new Error("Expected body-size validation to fail");
      } catch (error) {
        assertEquals(isRequestBodyTooLargeError(error), true);
      }
      assertEquals(isRequestBodyTooLargeError(new Error("unrelated")), false);
    });

    it("should reject an oversized Content-Length", async () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "content-length": "100" },
        body: new ReadableStream({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            controller.close();
          },
        }),
      });

      await assertRejects(
        () => readBodyWithLimit(req, 10),
        VeryfrontError,
        "exceeds size limit",
      );
    });

    it("should cancel a streaming body once the limit is exceeded", async () => {
      let cancelled = false;
      const req = new Request("http://localhost/", {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("too large"));
          },
          cancel() {
            cancelled = true;
          },
        }),
      });

      await assertRejects(
        () => readBodyWithLimit(req, 4),
        VeryfrontError,
        "exceeds size limit",
      );
      assertEquals(cancelled, true);
    });

    it("should reject request with no body", async () => {
      const req = new Request("http://localhost/");

      await assertRejects(
        () => readBodyWithLimit(req),
        VeryfrontError,
        "No request body",
      );
    });

    it("should reject an invalid size limit before reading the body", async () => {
      const req = new Request("http://localhost/", { method: "POST", body: "body" });

      await assertRejects(
        () => readBodyWithLimit(req, Number.NaN),
        VeryfrontError,
        "Invalid request limit",
      );
    });
  });
});
