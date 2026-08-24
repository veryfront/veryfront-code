import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "./errors.ts";
import {
  isRequestBodyTooLargeError,
  readBodyBytesWithLimit,
  readBodyWithLimit,
  resolveRequestLimits,
  validateContentType,
  validateRequestLimits,
} from "./limits.ts";
import { DEFAULT_LIMITS } from "./types.ts";

function createStreamingRequest(
  body: ReadableStream<Uint8Array>,
  headers?: HeadersInit,
  signal?: AbortSignal,
): Request {
  // Node requires this Fetch extension for streaming request bodies. Deno and
  // Bun accept it as an ignored/compatible RequestInit member.
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers,
    body,
    duplex: "half",
    signal,
  };
  return new Request("http://localhost/", init);
}

describe("security/input-validation/limits", () => {
  describe("validateRequestLimits", () => {
    it("does not allow callers to weaken framework-owned defaults", () => {
      const expectedBodyLimit = DEFAULT_LIMITS.maxBodySize;

      assertThrows(
        () => {
          (DEFAULT_LIMITS as { maxBodySize: number }).maxBodySize = 0;
        },
        TypeError,
      );
      assertStrictEquals(resolveRequestLimits().maxBodySize, expectedBodyLimit);
    });

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

    it("should reject an empty Content-Length consistently", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Length": "" },
      });

      assertThrows(
        () => validateRequestLimits(req),
        VeryfrontError,
        "Invalid Content-Length",
      );
    });

    it("should reject a Content-Length with a numeric prefix and trailing junk", () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Length": "10 trailing-junk" },
      });

      assertThrows(
        () => validateRequestLimits(req),
        VeryfrontError,
        "Invalid Content-Length",
      );
    });

    it("rejects Content-Length values outside the safe integer domain", () => {
      const req = createStreamingRequest(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        { "content-length": "9007199254740992" },
      );

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

    it("rejects invalid runtime limits instead of disabling enforcement", () => {
      const req = new Request("http://localhost/");
      for (
        const limits of [
          { maxBodySize: Number.POSITIVE_INFINITY },
          { maxUrlLength: Number.NaN },
          { maxHeaderSize: -1 },
          { maxFileSize: 1.5 },
          { maxBodySize: null as unknown as number },
        ]
      ) {
        assertThrows(
          () => validateRequestLimits(req, limits),
          RangeError,
          "must be a non-negative safe integer",
        );
      }
    });

    it("rejects unknown, inherited, and accessor-backed limit options", () => {
      let getterCalls = 0;
      const accessorLimits = {} as Record<string, unknown>;
      Object.defineProperty(accessorLimits, "maxBodySize", {
        enumerable: true,
        get() {
          getterCalls++;
          return 1;
        },
      });

      assertThrows(
        () => resolveRequestLimits({ unknown: 1 } as never),
        TypeError,
        "unsupported option",
      );
      assertThrows(
        () => resolveRequestLimits(Object.create({ maxBodySize: 1 })),
        TypeError,
        "plain object",
      );
      assertThrows(
        () => resolveRequestLimits(accessorLimits as never),
        TypeError,
        "own data property",
      );
      assertEquals(getterCalls, 0);
    });

    it("counts URL and header limits in UTF-8 bytes", () => {
      const requestWithUnicodeUrl = {
        url: "http://localhost/å",
        headers: new Headers(),
      } as Request;
      assertThrows(
        () =>
          validateRequestLimits(requestWithUnicodeUrl, {
            maxUrlLength: requestWithUnicodeUrl.url.length,
          }),
        VeryfrontError,
        "URL too long",
      );

      const req = new Request("http://localhost/", {
        headers: { "x-value": "å" },
      });
      const codeUnitSize = "x-value".length + "å".length + 4;
      assertThrows(
        () => validateRequestLimits(req, { maxHeaderSize: codeUnitSize }),
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

    it("should reject malformed UTF-8 instead of replacing bytes", async () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        body: new Uint8Array([0xc0, 0xaf]),
      });

      await assertRejects(() => readBodyWithLimit(req, 2), TypeError);
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
      const req = createStreamingRequest(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new TextEncoder().encode("hello"));
            controller.close();
          },
        }),
        { "content-length": "100" },
      );

      await assertRejects(
        () => readBodyWithLimit(req, 10),
        VeryfrontError,
        "exceeds size limit",
      );
    });

    it("should cancel a streaming body once the limit is exceeded", async () => {
      let cancelled = false;
      const req = createStreamingRequest(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("too large"));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );

      await assertRejects(
        () => readBodyWithLimit(req, 4),
        VeryfrontError,
        "exceeds size limit",
      );
      assertEquals(cancelled, true);
    });

    it("should not wait for an uncooperative stream cancellation hook", async () => {
      let cancelled = false;
      const req = createStreamingRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("too large"));
          },
          cancel() {
            cancelled = true;
            return new Promise<void>(() => {});
          },
        }),
      );

      let timeoutId: number | undefined;
      const outcome = await Promise.race([
        readBodyBytesWithLimit(req, 4).then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<"timed-out">((resolve) => {
          timeoutId = setTimeout(() => resolve("timed-out"), 20);
        }),
      ]).finally(() => clearTimeout(timeoutId));

      assertEquals(cancelled, true);
      assertEquals(outcome, "rejected");
    });

    it("should preserve binary request bytes", async () => {
      const expected = new Uint8Array([0, 255, 1, 128, 42]);
      const req = new Request("http://localhost/", {
        method: "POST",
        body: expected,
      });

      const actual = await readBodyBytesWithLimit(req, expected.byteLength);

      assertEquals(actual, expected);
    });

    it("should coalesce many tiny and empty transport chunks", async () => {
      const expected = Uint8Array.from(
        { length: 4_096 },
        (_, index) => index % 251,
      );
      let chunkIndex = 0;
      const req = createStreamingRequest(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunkIndex === expected.byteLength * 2) {
              controller.close();
              return;
            }
            const dataIndex = Math.floor(chunkIndex / 2);
            controller.enqueue(
              chunkIndex % 2 === 0 ? new Uint8Array() : expected.subarray(dataIndex, dataIndex + 1),
            );
            chunkIndex++;
          },
        }),
      );

      const actual = await readBodyBytesWithLimit(
        req,
        expected.byteLength,
      );

      assertEquals(actual, expected);
    });

    it("should let an abort timer preempt a synchronous empty-chunk stream", async () => {
      const controller = new AbortController();
      const reason = new Error("empty body stream deadline");
      let pulls = 0;
      let cancelReason: unknown;
      const req = createStreamingRequest(
        new ReadableStream<Uint8Array>({
          pull(streamController) {
            pulls++;
            streamController.enqueue(new Uint8Array());
          },
          cancel(receivedReason) {
            cancelReason = receivedReason;
          },
        }),
        undefined,
        controller.signal,
      );

      const pending = readBodyBytesWithLimit(req, 1024);
      setTimeout(() => controller.abort(reason), 0);

      const error = await assertRejects(() => pending);
      assertStrictEquals(error, reason);
      assertStrictEquals(cancelReason, reason);
      assertEquals(pulls < 4_096, true);
    });

    it("should reject an endless no-progress body without an external deadline", async () => {
      let pulls = 0;
      let cancelled = false;
      const req = createStreamingRequest(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array());
          },
          cancel() {
            cancelled = true;
          },
        }),
      );

      await assertRejects(
        () => readBodyBytesWithLimit(req, 1024),
        VeryfrontError,
        "made no progress",
      );
      assertEquals(cancelled, true);
      // Fetch implementations may issue one speculative pull beyond the
      // consumer-visible read; the no-progress bound still stays constant.
      assertEquals(pulls < 4_100, true);
    });

    it("should reject malformed Content-Length before reading body bytes", async () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Length": "5x" },
        body: "hello",
      });

      await assertRejects(
        () => readBodyBytesWithLimit(req, 10),
        VeryfrontError,
        "Invalid Content-Length",
      );
    });

    it("should cancel a body read when the caller signal aborts", async () => {
      const controller = new AbortController();
      let cancelled = false;
      const req = createStreamingRequest(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
      );
      const reason = new Error("body read deadline expired");
      const pending = readBodyBytesWithLimit(req, 10, {
        signal: controller.signal,
      });

      controller.abort(reason);

      await assertRejects(
        () => pending,
        Error,
        "body read deadline expired",
      );
      assertEquals(cancelled, true);
    });

    it("should honor the incoming Request signal without explicit options", async () => {
      const controller = new AbortController();
      const reason = new Error("incoming request disconnected");
      let cancelReason: unknown;
      const requestWithSignal = createStreamingRequest(
        new ReadableStream<Uint8Array>({
          cancel(receivedReason) {
            cancelReason = receivedReason;
          },
        }),
        undefined,
        controller.signal,
      );
      const pending = readBodyBytesWithLimit(requestWithSignal, 10);

      controller.abort(reason);

      const error = await assertRejects(() => pending);
      assertStrictEquals(error, reason);
      assertStrictEquals(cancelReason, reason);
    });

    it("should reject an already-consumed request body", async () => {
      const req = new Request("http://localhost/", {
        method: "POST",
        body: "abc",
      });
      assertEquals(await readBodyWithLimit(req), "abc");

      await assertRejects(
        () => readBodyBytesWithLimit(req),
        VeryfrontError,
        "already been consumed",
      );
    });

    it("should reject a non-byte stream chunk instead of truncating it", async () => {
      const req = createStreamingRequest(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue("attacker-text" as unknown as Uint8Array);
            controller.close();
          },
        }),
      );

      await assertRejects(
        () => readBodyBytesWithLimit(req, 100),
        VeryfrontError,
        "non-byte chunk",
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

    it("rejects body-read option accessors without invoking them", async () => {
      let getterCalls = 0;
      const options = {} as Record<string, unknown>;
      Object.defineProperty(options, "signal", {
        enumerable: true,
        get() {
          getterCalls++;
          return new AbortController().signal;
        },
      });

      await assertRejects(
        () =>
          readBodyBytesWithLimit(
            createStreamingRequest(
              new ReadableStream({
                start(controller) {
                  controller.close();
                },
              }),
            ),
            1,
            options as never,
          ),
        TypeError,
        "own data property",
      );
      assertEquals(getterCalls, 0);
    });

    it("rejects an invalid byte limit before reading the body", async () => {
      for (
        const limit of [
          -1,
          Number.NaN,
          1.5,
          Number.POSITIVE_INFINITY,
          null as unknown as number,
        ]
      ) {
        const req = new Request("http://localhost/", { method: "POST", body: "abc" });

        await assertRejects(
          () => readBodyBytesWithLimit(req, limit),
          RangeError,
          "must be a non-negative safe integer",
          `${String(limit)} is not a usable byte limit and must be rejected outright`,
        );
        assertEquals(
          req.bodyUsed,
          false,
          "an invalid limit must be rejected before the body is consumed",
        );
      }
    });
  });
});
