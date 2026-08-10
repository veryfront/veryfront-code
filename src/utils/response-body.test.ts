import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  InvalidResponseBodyUtf8Error,
  JsonNonValueBytesTooLargeError,
  JsonStringValueTooLargeError,
  maximumJsonStringDocumentBytes,
  readResponseJsonStringBytesWithinLimit,
  readResponseJsonStringWithinLimit,
  readResponseTextPrefix,
} from "./response-body.ts";

describe("utils/response-body", () => {
  it("derives exact worst-case JSON string wire limits without unsafe arithmetic", async () => {
    assertEquals(maximumJsonStringDocumentBytes(2, 14), 26);
    assertEquals(maximumJsonStringDocumentBytes(0, 14), 14);

    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          maximumJsonStringDocumentBytes(
            Number.MAX_SAFE_INTEGER,
            1,
          )
        ),
      RangeError,
      "safe integer range",
    );
  });

  it("meters selected source bytes separately from the JSON envelope budget", async () => {
    const maximumValueBytes = 4;
    const maximumNonValueBytes = 18;
    const maximumDocumentBytes = maximumJsonStringDocumentBytes(
      maximumValueBytes,
      maximumNonValueBytes,
    );
    for (
      const body of [
        '{"value":"😀","x":0}',
        '{"value":"\\ud83d\\ude00","x":0}',
      ]
    ) {
      assertEquals(
        await readResponseJsonStringWithinLimit(
          new Response(body),
          "value",
          maximumValueBytes,
          maximumDocumentBytes,
          undefined,
          maximumNonValueBytes,
        ),
        "😀",
      );
    }

    await assertRejects(
      () =>
        readResponseJsonStringWithinLimit(
          new Response('{"value":"😀","x":0} '),
          "value",
          maximumValueBytes,
          maximumDocumentBytes,
          undefined,
          maximumNonValueBytes,
        ),
      JsonNonValueBytesTooLargeError,
      "18 bytes",
    );
  });

  it("streams one top-level JSON string field with exact escaped UTF-8 bytes", async () => {
    const value = "é\0😀";
    const response = new Response(JSON.stringify({
      ignored: { nested: [true, false, null] },
      value,
      tail: "not retained",
    }));

    const bytes = await readResponseJsonStringBytesWithinLimit(
      response,
      "value",
      7,
      1_024,
    );

    assertEquals(bytes, new TextEncoder().encode(value));
  });

  it("preserves escaped Unicode pairs and replaces an escaped lone surrogate", async () => {
    const bytes = await readResponseJsonStringBytesWithinLimit(
      new Response('{"value":"\\u00e9\\ud83d\\ude00\\ud800"}'),
      "value",
      9,
      128,
    );

    assertEquals(bytes, new TextEncoder().encode("é😀\ud800"));
  });

  it("returns escaped lone surrogates losslessly in bounded string mode", async () => {
    const value = await readResponseJsonStringWithinLimit(
      new Response('{"value":"\\ud800x\\udc00y\\ud83d\\ude00"}'),
      "value",
      12,
      128,
    );

    assertEquals(value, "\ud800x\udc00y😀");
    await assertRejects(
      () =>
        readResponseJsonStringWithinLimit(
          new Response('{"value":"\\ud800x\\udc00y\\ud83d\\ude00"}'),
          "value",
          11,
          128,
        ),
      JsonStringValueTooLargeError,
      "11 UTF-8 bytes",
    );
  });

  it("returns a tight byte buffer instead of retaining growth capacity", async () => {
    const bytes = await readResponseJsonStringBytesWithinLimit(
      new Response('{"value":"small"}'),
      "value",
      8 * 1_024,
      16 * 1_024,
    );

    assertEquals(bytes?.byteLength, 5);
    assertEquals(bytes?.buffer.byteLength, 5);
  });

  it("uses captured byte intrinsics after ambient constructors and species are poisoned", async () => {
    const response = new Response('{"ignored":"x","value":"small"}');
    const OriginalUint8Array = globalThis.Uint8Array;
    const OriginalTextDecoder = globalThis.TextDecoder;
    const originalSpecies = Object.getOwnPropertyDescriptor(
      OriginalUint8Array,
      Symbol.species,
    );
    const originalDecode = Object.getOwnPropertyDescriptor(
      OriginalTextDecoder.prototype,
      "decode",
    );
    class PoisonedUint8Array extends OriginalUint8Array {
      constructor(..._args: unknown[]) {
        super(0);
        throw new Error("ambient Uint8Array constructor must not run");
      }
    }
    class PoisonedTextDecoder extends OriginalTextDecoder {
      constructor() {
        super();
        throw new Error("ambient TextDecoder constructor must not run");
      }
    }

    try {
      Object.defineProperty(OriginalUint8Array, Symbol.species, {
        configurable: true,
        get() {
          throw new Error("ambient typed-array species must not run");
        },
      });
      Object.defineProperty(globalThis, "Uint8Array", {
        configurable: true,
        value: PoisonedUint8Array,
        writable: true,
      });
      if (originalDecode === undefined || !("value" in originalDecode)) {
        throw new Error("TextDecoder.decode must be a data property");
      }
      Object.defineProperty(OriginalTextDecoder.prototype, "decode", {
        ...originalDecode,
        value() {
          throw new Error("ambient TextDecoder.decode must not run");
        },
      });
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: PoisonedTextDecoder,
        writable: true,
      });

      const bytes = await readResponseJsonStringBytesWithinLimit(response, "value", 8, 128);
      assertEquals(bytes?.byteLength, 5);
      assertEquals([...bytes!], [0x73, 0x6d, 0x61, 0x6c, 0x6c]);
    } finally {
      Object.defineProperty(globalThis, "Uint8Array", {
        configurable: true,
        value: OriginalUint8Array,
        writable: true,
      });
      Object.defineProperty(globalThis, "TextDecoder", {
        configurable: true,
        value: OriginalTextDecoder,
        writable: true,
      });
      if (originalDecode !== undefined) {
        Object.defineProperty(OriginalTextDecoder.prototype, "decode", originalDecode);
      }
      if (originalSpecies === undefined) {
        delete (OriginalUint8Array as unknown as Record<PropertyKey, unknown>)[Symbol.species];
      } else {
        Object.defineProperty(OriginalUint8Array, Symbol.species, originalSpecies);
      }
    }
  });

  it("rejects shared or resizable response chunks at the exact-read boundary", async () => {
    const encoded = new TextEncoder().encode('{"value":"ok"}');
    const unsafeChunks: Uint8Array[] = [];
    if (typeof SharedArrayBuffer === "function") {
      const shared = new Uint8Array(new SharedArrayBuffer(encoded.byteLength));
      shared.set(encoded);
      unsafeChunks.push(shared);
    }
    try {
      const resizableBuffer = Reflect.construct(ArrayBuffer, [
        encoded.byteLength,
        { maxByteLength: encoded.byteLength * 2 },
      ]);
      if (resizableBuffer instanceof ArrayBuffer && resizableBuffer.resizable) {
        const resizable = new Uint8Array(resizableBuffer);
        resizable.set(encoded);
        unsafeChunks.push(resizable);
      }
    } catch {
      // Resizable ArrayBuffers are unavailable in this runtime.
    }

    for (const chunk of unsafeChunks) {
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk);
            controller.close();
          },
        }),
      );
      await assertRejects(
        () => readResponseJsonStringBytesWithinLimit(response, "value", 8, 128),
        TypeError,
        "fixed ArrayBuffer",
      );
    }
  });

  it("reports malformed UTF-8 consistently for streamed exact JSON reads", async () => {
    await assertRejects(
      () =>
        readResponseJsonStringBytesWithinLimit(
          new Response(new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])),
          "value",
          8,
          128,
        ),
      InvalidResponseBodyUtf8Error,
    );
  });

  it("returns null for a top-level JSON null field", async () => {
    const bytes = await readResponseJsonStringBytesWithinLimit(
      new Response('{"value":null}'),
      "value",
      0,
      64,
    );

    assertEquals(bytes, null);
  });

  it("cancels an oversized ASCII JSON field before reading the full response", async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          if (pulls === 1) {
            controller.enqueue(encoder.encode('{"value":"' + "x".repeat(1_024)));
            return;
          }
          controller.enqueue(encoder.encode("x".repeat(1_024)));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await assertRejects(
      () => readResponseJsonStringBytesWithinLimit(response, "value", 8, 64 * 1_024),
      JsonStringValueTooLargeError,
      "8 UTF-8 bytes",
    );
    assertEquals(cancelled, true);
    assertEquals(pulls <= 2, true);
  });

  it("rejects duplicate target fields instead of accepting an ambiguous value", async () => {
    await assertRejects(
      () =>
        readResponseJsonStringBytesWithinLimit(
          new Response('{"value":"first","value":"second"}'),
          "value",
          32,
          128,
        ),
      TypeError,
      "duplicate top-level JSON field",
    );
  });

  it("rejects adversarial JSON nesting before frame storage scales with the body", async () => {
    const nested = "[".repeat(1_024);
    await assertRejects(
      () =>
        readResponseJsonStringBytesWithinLimit(
          new Response(`{"ignored":${nested}${"]".repeat(1_024)},"value":"ok"}`),
          "value",
          8,
          4 * 1_024,
        ),
      RangeError,
      "nesting depth",
    );
  });

  it("rejects invalid numbers elsewhere in the streamed JSON envelope", async () => {
    await assertRejects(
      () =>
        readResponseJsonStringBytesWithinLimit(
          new Response('{"ignored":1e,"value":"ok"}'),
          "value",
          8,
          128,
        ),
      TypeError,
      "exponent has no digits",
    );
  });

  it("streams an oversized transport chunk while discarding unrelated fields", async () => {
    const body = `{"ignored":"${"x".repeat(256 * 1_024)}","value":"ok"}`;

    assertEquals(
      await readResponseJsonStringBytesWithinLimit(
        new Response(new TextEncoder().encode(body)),
        "value",
        8,
        512 * 1_024,
      ),
      new TextEncoder().encode("ok"),
    );
  });

  it("rejects invalid byte limits", async () => {
    for (
      const limit of [
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
        1e100,
      ]
    ) {
      await assertRejects(
        () => readResponseTextPrefix(new Response("body"), limit),
        RangeError,
      );
    }
  });

  it("cancels an oversized response after reading the byte limit", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1_024));
    let pulls = 0;
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          pulls++;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    const result = await readResponseTextPrefix(response, 2_000);

    assertEquals(result.text.length, 2_000);
    assertEquals(result.truncated, true);
    assertEquals(cancelled, true);
    assertEquals(pulls <= 3, true);
  });

  it("reports a complete response without truncation", async () => {
    const result = await readResponseTextPrefix(new Response("complete"), 100);

    assertEquals(result, { text: "complete", truncated: false });
  });

  it("can reject invalid UTF-8 at strict response boundaries", async () => {
    await assertRejects(
      () =>
        readResponseTextPrefix(
          new Response(new Uint8Array([0xc3, 0x28])),
          100,
          undefined,
          { fatalUtf8: true },
        ),
      TypeError,
    );
  });

  it("does not emit a replacement character when truncating inside UTF-8", async () => {
    const result = await readResponseTextPrefix(new Response("😀after"), 3);

    assertEquals(result, { text: "", truncated: true });
  });

  it("cancels immediately when the byte limit is reached before EOF", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("exact"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("reader waited beyond the byte limit")),
        50,
      );
    });
    const result = await (async () => {
      try {
        return await Promise.race([readResponseTextPrefix(response, 5), timeout]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    })();

    assertEquals(result, { text: "exact", truncated: true });
    assertEquals(cancelled, true);
  });

  it("does not await stalled cancellation after an exact-limit read, even if abort follows", async () => {
    let cancellationStarted = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("exact"));
        },
        cancel() {
          cancellationStarted = true;
          return new Promise<void>(() => {});
        },
      }),
    );
    const abortController = new AbortController();
    const laterAbort = new Promise<void>((resolve) => {
      setTimeout(() => {
        abortController.abort(new Error("later abort"));
        resolve();
      }, 5);
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timed-out">((resolve) => {
      timeoutId = setTimeout(() => resolve("timed-out"), 100);
    });

    try {
      const outcome = await Promise.race([
        readResponseTextPrefix(response, 5, abortController.signal),
        timeout,
      ]);

      assertEquals(outcome === "timed-out", false);
      if (outcome === "timed-out") return;
      assertEquals(outcome, { text: "exact", truncated: true });
      assertEquals(cancellationStarted, true);
      await laterAbort;
      assertEquals(abortController.signal.aborted, true);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  });

  it("aborts a stalled body read and cancels the unread stream", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const abortController = new AbortController();
    const fallbackTimer = setTimeout(() => {
      try {
        streamController?.close();
      } catch {
        // The implementation may already have cancelled the stream.
      }
    }, 25);
    const read = readResponseTextPrefix(response, 100, abortController.signal);
    abortController.abort(new Error("body read timed out"));

    try {
      await assertRejects(() => read, Error, "body read timed out");
      assertEquals(cancelled, true);
    } finally {
      clearTimeout(fallbackTimer);
      try {
        streamController?.close();
      } catch {
        // The implementation should already have cancelled the stream.
      }
    }
  });

  it("does not let a stalled cancellation defeat an aborted body read", async () => {
    let cancellationStarted = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel: () => {
          cancellationStarted = true;
          return new Promise<void>(() => {});
        },
      }),
    );
    const abortController = new AbortController();
    const read = readResponseTextPrefix(response, 100, abortController.signal);
    abortController.abort(new Error("body read timed out"));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timed-out">((resolve) => {
      timeoutId = setTimeout(() => resolve("timed-out"), 100);
    });

    try {
      const outcome = await Promise.race([
        read.then(
          () => ({ status: "fulfilled" as const }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        ),
        timeout,
      ]);

      assertEquals(outcome === "timed-out", false);
      if (outcome === "timed-out") return;
      assertEquals(outcome.status, "rejected");
      assertEquals(
        outcome.status === "rejected" &&
          outcome.error instanceof Error &&
          outcome.error.message,
        "body read timed out",
      );
      assertEquals(cancellationStarted, true);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  });
});
