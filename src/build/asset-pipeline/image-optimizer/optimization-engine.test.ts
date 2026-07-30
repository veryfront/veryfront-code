import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  ImageOptimizationEngine,
  ImageOptimizationRequest,
  ImageOptimizationResult,
} from "#veryfront/extensions/image/index.ts";
import { createImageOptimizationSession } from "./optimization-engine.ts";

function validResult(): ImageOptimizationResult {
  return {
    sourceWidth: 640,
    sourceHeight: 480,
    variants: [{
      format: "webp",
      width: 320,
      height: 240,
      data: new Uint8Array([1, 2, 3]),
    }],
  };
}

function engine(
  optimize: (request: ImageOptimizationRequest) => Promise<ImageOptimizationResult> = () =>
    Promise.resolve(validResult()),
): ImageOptimizationEngine {
  return {
    cacheIdentity: "test-image-engine@1",
    optimize,
  };
}

const variants = Object.freeze([
  Object.freeze({ format: "webp" as const, width: 320, quality: 80 }),
]);

describe("image optimization engine invocation", () => {
  it("copies request and result bytes across the extension boundary", async () => {
    const input = new Uint8Array([7, 8, 9]);
    const output = new Uint8Array([1, 2, 3]);
    let seenInput: Uint8Array | undefined;
    const session = createImageOptimizationSession(engine((request) => {
      seenInput = request.input;
      return Promise.resolve({
        ...validResult(),
        variants: [{ ...validResult().variants[0]!, data: output }],
      });
    }));

    const result = await session.run(input, variants);
    input[0] = 99;
    output[0] = 99;
    assertEquals(seenInput === input, false);
    assertEquals(result.variants[0]?.data, new Uint8Array([1, 2, 3]));
  });

  it("rejects incomplete, reordered, and oversized engine output", async () => {
    await assertRejects(
      () =>
        createImageOptimizationSession(
          engine(() => Promise.resolve({ ...validResult(), variants: [] })),
        ).run(new Uint8Array([1]), variants),
      TypeError,
      "incomplete variant set",
    );
    await assertRejects(
      () =>
        createImageOptimizationSession(engine(() =>
          Promise.resolve({
            ...validResult(),
            variants: [{ ...validResult().variants[0]!, width: 321 }],
          })
        )).run(new Uint8Array([1]), variants),
      TypeError,
      "was not requested",
    );
  });

  it("rejects result accessors without invoking them", async () => {
    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "sourceWidth", {
      enumerable: true,
      get() {
        getterCalls++;
        return 640;
      },
    });
    Object.defineProperties(hostile, {
      sourceHeight: { enumerable: true, value: 480 },
      variants: { enumerable: true, value: [] },
    });

    await assertRejects(
      () =>
        createImageOptimizationSession(
          engine(() => Promise.resolve(hostile as ImageOptimizationResult)),
        ).run(new Uint8Array([1]), variants),
      TypeError,
      "data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("propagates caller cancellation into the captured engine signal", async () => {
    let engineSignal: AbortSignal | undefined;
    const session = createImageOptimizationSession(engine((request) => {
      engineSignal = request.signal;
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(new Error("engine observed abort")),
          { once: true },
        );
      });
    }));
    const controller = new AbortController();
    const operation = session.run(new Uint8Array([1]), variants, controller.signal);
    controller.abort();

    await assertRejects(() => operation, Error, "cancelled");
    assertEquals(engineSignal?.aborted, true);
  });

  it("enforces a bounded operation deadline", async () => {
    let signal: AbortSignal | undefined;
    const session = createImageOptimizationSession(
      engine((request) => {
        signal = request.signal;
        return new Promise(() => {});
      }),
      { operationTimeoutMs: 5 },
    );
    await assertRejects(
      () => session.run(new Uint8Array([1]), variants),
      Error,
      "exceeded 5 ms",
    );
    assertEquals(signal?.aborted, true);
  });
});
