import "#veryfront/schemas/_test-setup.ts";
import type {
  ImageOptimizationEngine,
  ImageOptimizationRequest,
  ImageOptimizationResult,
} from "#veryfront/extensions/image/index.ts";
import { ImageOptimizationEngineName } from "#veryfront/extensions/image/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  acquireConfiguredImageOptimization,
  createImageOptimizationSession,
} from "./optimization-engine.ts";

function request(
  overrides: Partial<ImageOptimizationRequest> = {},
): ImageOptimizationRequest {
  return {
    input: new Uint8Array([1, 2, 3]),
    targetWidths: [320],
    formats: ["webp"],
    quality: 80,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function result(
  overrides: Partial<ImageOptimizationResult> = {},
): ImageOptimizationResult {
  return {
    sourceWidth: 640,
    sourceHeight: 480,
    variants: [
      {
        format: "webp",
        width: 320,
        height: 240,
        data: new Uint8Array([3, 2, 1]),
      },
      {
        format: "webp",
        width: 640,
        height: 480,
        data: new Uint8Array([6, 4, 0]),
      },
    ],
    ...overrides,
  };
}

function engine(
  optimize: ImageOptimizationEngine["optimize"] = () => Promise.resolve(result()),
): ImageOptimizationEngine {
  return { cacheIdentity: "test-image-provider@1", optimize };
}

describe("image optimization engine boundary", () => {
  it("fails closed with the recommended extension when no engine is composed", () => {
    const previous = tryResolve<ImageOptimizationEngine>(
      ImageOptimizationEngineName,
    );
    unregister(ImageOptimizationEngineName);
    try {
      assertThrows(
        () => acquireConfiguredImageOptimization(),
        Error,
        "deno add @veryfront/ext-image-sharp",
      );
    } finally {
      if (previous !== undefined) {
        register(ImageOptimizationEngineName, previous);
      }
    }
  });

  it("captures one provider and snapshots bytes in both directions", async () => {
    let received: ImageOptimizationRequest | undefined;
    const providerResult = result();
    const provider = engine((value) => {
      received = value;
      return Promise.resolve(providerResult);
    });
    const session = createImageOptimizationSession(provider);
    provider.optimize = () => Promise.reject(new Error("replacement invoked"));

    const input = new Uint8Array([1, 2, 3]);
    const output = await session.run(request({ input }));
    input[0] = 9;
    providerResult.variants[0]!.data[0] = 9;

    assertEquals(session.cacheIdentity, "test-image-provider@1");
    assertNotStrictEquals(received!.input, input);
    assertEquals([...received!.input], [1, 2, 3]);
    assertEquals([...output.variants[0]!.data], [3, 2, 1]);
  });

  it("normalizes a complete provider matrix to requested deterministic order", async () => {
    const session = createImageOptimizationSession(
      engine(() =>
        Promise.resolve({
          sourceWidth: 640,
          sourceHeight: 480,
          variants: [
            { format: "avif", width: 640, height: 480, data: new Uint8Array([4]) },
            { format: "webp", width: 640, height: 480, data: new Uint8Array([3]) },
            { format: "avif", width: 320, height: 240, data: new Uint8Array([2]) },
            { format: "webp", width: 320, height: 240, data: new Uint8Array([1]) },
          ],
        })
      ),
    );

    const output = await session.run(request({ formats: ["webp", "avif"] }));
    assertEquals(
      output.variants.map(({ width, format }) => `${width}:${format}`),
      ["320:webp", "320:avif", "640:webp", "640:avif"],
    );
  });

  it("accepts only the configured width and intrinsic width for a custom target plan", async () => {
    const session = createImageOptimizationSession(
      engine(() =>
        Promise.resolve({
          sourceWidth: 1_000,
          sourceHeight: 500,
          variants: [
            { format: "webp", width: 1_000, height: 500, data: new Uint8Array([2]) },
            { format: "webp", width: 320, height: 160, data: new Uint8Array([1]) },
          ],
        })
      ),
    );

    const output = await session.run(request({ targetWidths: [320] }));
    assertEquals(output.variants.map(({ width }) => width), [320, 1_000]);
  });

  it("enforces the legacy no-enlargement aspect-ratio contract", async () => {
    const invalid = result({
      variants: [
        { ...result().variants[0]!, height: 239 },
        result().variants[1]!,
      ],
    });
    await assertRejects(
      () =>
        createImageOptimizationSession(
          engine(() => Promise.resolve(invalid)),
        ).run(request()),
      TypeError,
      "preserve the source aspect ratio",
    );
  });

  it("rejects request accessors and sparse arrays without invoking them", async () => {
    const session = createImageOptimizationSession(engine());
    let accessorCalls = 0;
    const hostile = Object.defineProperty(request(), "formats", {
      enumerable: true,
      get() {
        accessorCalls++;
        return ["webp"];
      },
    });
    await assertRejects(
      () => session.run(hostile),
      TypeError,
      "own data property",
    );
    assertEquals(accessorCalls, 0);

    const sparse = new Array<number>(1);
    await assertRejects(
      () => session.run(request({ targetWidths: sparse })),
      TypeError,
      "dense data-property array",
    );

    const inherited = request({ targetWidths: [320] });
    Object.setPrototypeOf(inherited.targetWidths, null);
    await assertRejects(
      () => session.run(inherited),
      TypeError,
      "standard array prototype",
    );
  });

  it("rejects incomplete, duplicate, malformed, and accessor-backed output", async () => {
    const invalidResults: unknown[] = [
      result({ variants: result().variants.slice(0, 1) }),
      result({ variants: [result().variants[0]!, result().variants[0]!] }),
      result({ sourceWidth: 0 }),
      result({
        variants: [
          { ...result().variants[0]!, data: new Uint16Array([1]) as unknown as Uint8Array },
          result().variants[1]!,
        ],
      }),
    ];
    for (const invalid of invalidResults) {
      await assertRejects(
        () =>
          createImageOptimizationSession(
            engine(() => Promise.resolve(invalid as ImageOptimizationResult)),
          ).run(request()),
        TypeError,
      );
    }

    let accessorCalls = 0;
    const hostile = Object.defineProperty(result(), "variants", {
      enumerable: true,
      get() {
        accessorCalls++;
        return [];
      },
    });
    await assertRejects(
      () =>
        createImageOptimizationSession(
          engine(() => Promise.resolve(hostile)),
        ).run(request()),
      TypeError,
      "own data property",
    );
    assertEquals(accessorCalls, 0);
  });

  it("rejects promptly when the caller aborts an uncooperative provider", async () => {
    const controller = new AbortController();
    const session = createImageOptimizationSession(
      engine(() => new Promise<ImageOptimizationResult>(() => undefined)),
    );
    const pending = session.run(request({ signal: controller.signal }));
    controller.abort();
    await assertRejects(
      () => pending,
      Error,
      "cancelled or exceeded its deadline",
    );
  });
});
