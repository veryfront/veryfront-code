import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ImageOptimizationFormat, ImageOptimizationRequest } from "veryfront/extensions/image";
import {
  BoundSharpImageOptimizationEngine,
  captureSharpRuntime,
  type SharpImageLimits,
} from "./sharp-runtime.ts";

interface FakePipelineState {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  width: number;
  format: ImageOptimizationFormat;
}

interface FakeSharpOptions {
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly outputBytes?: number;
  readonly outputSizeOffset?: number;
  readonly metadata?: unknown;
  readonly metadataPromise?: Promise<unknown>;
  readonly outputPromise?: Promise<unknown>;
  readonly onToBuffer?: () => void;
}

interface FakeSharpFixture {
  readonly sharp: unknown;
  readonly createdInputs: number[];
  readonly encoded: Array<readonly [number, ImageOptimizationFormat]>;
}

const defineProperty = Object.defineProperty;

function fakeSharpFixture(options: FakeSharpOptions = {}): FakeSharpFixture {
  const sourceWidth = options.sourceWidth ?? 4;
  const sourceHeight = options.sourceHeight ?? 2;
  const states = new WeakMap<object, FakePipelineState>();
  const createdInputs: number[] = [];
  const encoded: Array<readonly [number, ImageOptimizationFormat]> = [];

  function state(pipeline: object): FakePipelineState {
    const value = states.get(pipeline);
    if (!value) throw new Error("missing fake Sharp pipeline state");
    return value;
  }

  function createPipeline(value?: FakePipelineState): object {
    const pipeline = Object.create(fakeSharp.prototype);
    states.set(
      pipeline,
      value ?? {
        sourceWidth,
        sourceHeight,
        width: sourceWidth,
        format: "png",
      },
    );
    return pipeline;
  }

  function fakeSharp(input: Uint8Array): object {
    createdInputs.push(input[0] ?? -1);
    return createPipeline();
  }

  defineProperty(fakeSharp, "versions", {
    value: {
      vips: "test",
      aom: "test",
      heif: "test",
      mozjpeg: "test",
      png: "test",
      webp: "test",
      "zlib-ng": "test",
    },
  });
  defineProperty(fakeSharp.prototype, "autoOrient", {
    configurable: true,
    writable: true,
    value: function (this: object): object {
      state(this);
      return this;
    },
  });
  defineProperty(fakeSharp.prototype, "metadata", {
    configurable: true,
    writable: true,
    value: function (this: object): unknown {
      state(this);
      if (options.metadataPromise) return options.metadataPromise;
      return Promise.resolve(
        options.metadata ?? {
          autoOrient: { width: sourceWidth, height: sourceHeight },
        },
      );
    },
  });
  defineProperty(fakeSharp.prototype, "clone", {
    configurable: true,
    writable: true,
    value: function (this: object): object {
      const current = state(this);
      return createPipeline({ ...current });
    },
  });
  defineProperty(fakeSharp.prototype, "resize", {
    configurable: true,
    writable: true,
    value: function (
      this: object,
      resizeOptions: { width: number },
    ): object {
      state(this).width = resizeOptions.width;
      return this;
    },
  });
  for (const format of ["webp", "avif", "jpeg", "png"] as const) {
    defineProperty(fakeSharp.prototype, format, {
      configurable: true,
      writable: true,
      value: function (this: object): object {
        state(this).format = format;
        return this;
      },
    });
  }
  defineProperty(fakeSharp.prototype, "toBuffer", {
    configurable: true,
    writable: true,
    value: function (this: object): unknown {
      const current = state(this);
      encoded.push([current.width, current.format]);
      options.onToBuffer?.();
      if (options.outputPromise) return options.outputPromise;
      const outputBytes = options.outputBytes ?? 2;
      const data = new Uint8Array(outputBytes);
      data.fill(current.width);
      const height = Math.max(
        1,
        Math.round(
          current.sourceHeight * current.width / current.sourceWidth,
        ),
      );
      return Promise.resolve({
        data,
        info: {
          width: current.width,
          height,
          size: outputBytes + (options.outputSizeOffset ?? 0),
          format: current.format === "avif" ? "heif" : current.format,
        },
      });
    },
  });

  return { sharp: fakeSharp, createdInputs, encoded };
}

function request(
  overrides: Partial<ImageOptimizationRequest> = {},
): ImageOptimizationRequest {
  return {
    input: new Uint8Array([7]),
    targetWidths: [3, 1, 3, 9],
    formats: ["png", "webp"],
    quality: 80,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function engine(
  fixture = fakeSharpFixture(),
  limits?: SharpImageLimits,
): {
  engine: BoundSharpImageOptimizationEngine;
  fixture: FakeSharpFixture;
} {
  return {
    engine: new BoundSharpImageOptimizationEngine(
      captureSharpRuntime(fixture.sharp),
      "test-sharp@1",
      limits,
    ),
    fixture,
  };
}

const smallLimits: SharpImageLimits = Object.freeze({
  maxInputBytes: 4,
  maxDecodedPixels: 100,
  maxDimension: 10,
  maxTargetWidths: 4,
  maxFormats: 4,
  maxVariants: 8,
  maxOutputBytesPerVariant: 3,
  maxTotalOutputBytes: 8,
});

describe("captured Sharp runtime", () => {
  it("captures prototype methods once without consulting replacements", async () => {
    const fixture = fakeSharpFixture();
    const captured = captureSharpRuntime(fixture.sharp);
    defineProperty(
      (fixture.sharp as { prototype: object }).prototype,
      "metadata",
      {
        value: () => Promise.reject(new Error("replacement invoked")),
      },
    );
    const result = await new BoundSharpImageOptimizationEngine(
      captured,
      "test-sharp@1",
    ).optimize(request());
    assertEquals(result.sourceWidth, 4);
  });

  it("rejects method and version accessors without invoking them", () => {
    let reads = 0;
    const fixture = fakeSharpFixture();
    defineProperty(
      (fixture.sharp as { prototype: object }).prototype,
      "metadata",
      {
        configurable: true,
        get() {
          reads++;
          return () => Promise.resolve({ width: 1, height: 1 });
        },
      },
    );
    assertThrows(
      () => captureSharpRuntime(fixture.sharp),
      TypeError,
      "data-property method",
    );
    assertEquals(reads, 0);

    const hostile = function (): void {};
    defineProperty(hostile, "versions", {
      get() {
        reads++;
        return {};
      },
    });
    assertThrows(
      () => captureSharpRuntime(hostile),
      TypeError,
      "versions must be an own data property",
    );
    assertEquals(reads, 0);
  });

  it("fails closed on cyclic Sharp prototype chains", () => {
    const fixture = fakeSharpFixture();
    const cyclic: object = new Proxy({}, { getPrototypeOf: () => cyclic });
    defineProperty(fixture.sharp as object, "prototype", {
      value: cyclic,
    });
    assertThrows(
      () => captureSharpRuntime(fixture.sharp),
      TypeError,
      "invalid prototype chain",
    );
  });
});

describe("BoundSharpImageOptimizationEngine", () => {
  it("emits the exact no-upscale width by format product canonically", async () => {
    const value = engine();
    const result = await value.engine.optimize(request());

    assertEquals([result.sourceWidth, result.sourceHeight], [4, 2]);
    assertEquals(
      result.variants.map((variant) => [variant.width, variant.format]),
      [
        [1, "webp"],
        [1, "png"],
        [3, "webp"],
        [3, "png"],
        [4, "webp"],
        [4, "png"],
      ],
    );
    assertEquals(value.fixture.encoded, [
      [1, "webp"],
      [1, "png"],
      [3, "webp"],
      [3, "png"],
      [4, "webp"],
      [4, "png"],
    ]);
  });

  it("snapshots each operation before asynchronous native work", async () => {
    const value = engine();
    const input = new Uint8Array([9]);
    const targetWidths = [2];
    const formats: ImageOptimizationFormat[] = ["png"];
    const operation = value.engine.optimize(
      request({ input, targetWidths, formats }),
    );
    input[0] = 1;
    targetWidths[0] = 4;
    formats[0] = "webp";

    const result = await operation;
    assertEquals(value.fixture.createdInputs, [9]);
    assertEquals(
      result.variants.map((variant) => [variant.width, variant.format]),
      [[2, "png"], [4, "png"]],
    );
  });

  it("uses an independent source pipeline for concurrent operations", async () => {
    const value = engine();
    const [first, second] = await Promise.all([
      value.engine.optimize(request({ targetWidths: [1], formats: ["webp"] })),
      value.engine.optimize(request({ targetWidths: [2], formats: ["png"] })),
    ]);
    assertEquals(value.fixture.createdInputs.length, 2);
    assertEquals(
      first.variants.map((variant) => [variant.width, variant.format]),
      [[1, "webp"], [4, "webp"]],
    );
    assertEquals(
      second.variants.map((variant) => [variant.width, variant.format]),
      [[2, "png"], [4, "png"]],
    );
  });

  it("supports the complete core width-by-format matrix", async () => {
    const targetWidths = Array.from({ length: 64 }, (_, index) => index + 1);
    const result = await engine(
      fakeSharpFixture({ sourceWidth: 65, sourceHeight: 65 }),
    ).engine.optimize(
      request({
        targetWidths,
        formats: ["webp", "avif", "jpeg", "png"],
      }),
    );

    assertEquals(result.variants.length, 260);
    assertEquals(result.variants[0]?.width, 1);
    assertEquals(result.variants.at(-1)?.width, 65);
  });

  it("rejects request accessors, sparse arrays, and custom array behavior", async () => {
    let reads = 0;
    const value = engine();
    const hostile = Object.create(null);
    for (const [property, entry] of Object.entries(request())) {
      if (property === "targetWidths") continue;
      defineProperty(hostile, property, {
        enumerable: true,
        value: entry,
      });
    }
    defineProperty(hostile, "targetWidths", {
      enumerable: true,
      get() {
        reads++;
        return [1];
      },
    });
    await assertRejects(
      () => value.engine.optimize(hostile),
      TypeError,
      "data property",
    );
    assertEquals(reads, 0);

    const sparse = new Array<number>(2);
    sparse[1] = 1;
    await assertRejects(
      () => value.engine.optimize(request({ targetWidths: sparse })),
      TypeError,
      "dense data-property array",
    );

    const custom = [1];
    defineProperty(custom, Symbol.iterator, {
      get() {
        reads++;
        return Array.prototype[Symbol.iterator];
      },
    });
    await assertRejects(
      () => value.engine.optimize(request({ targetWidths: custom })),
      TypeError,
      "custom properties",
    );
    assertEquals(reads, 0);
  });

  it("requires exact Uint8Array inputs instead of generic typed arrays", async () => {
    const wrongView = new Uint16Array([1]);
    await assertRejects(
      () =>
        engine().engine.optimize(
          request({ input: wrongView as unknown as Uint8Array }),
        ),
      TypeError,
      "must be a Uint8Array",
    );
  });

  it("rejects invalid dimensions and bounded variant plans", async () => {
    await assertRejects(
      () =>
        engine(
          fakeSharpFixture({
            metadata: { autoOrient: { width: 11, height: 1 } },
          }),
          smallLimits,
        ).engine.optimize(request({ targetWidths: [1], formats: ["png"] })),
      TypeError,
      "from 1 through 10",
    );

    await assertRejects(
      () =>
        engine(fakeSharpFixture(), {
          ...smallLimits,
          maxTargetWidths: 2,
        }).engine.optimize(
          request({ targetWidths: [1, 2, 3], formats: ["png"] }),
        ),
      TypeError,
      "exceeds its supported length",
    );

    await assertRejects(
      () =>
        engine(fakeSharpFixture(), {
          ...smallLimits,
          maxVariants: 2,
        }).engine.optimize(
          request({ targetWidths: [1], formats: ["png", "webp"] }),
        ),
      TypeError,
      "more than 2 variants",
    );
  });

  it("validates output byte and metadata bounds", async () => {
    await assertRejects(
      () =>
        engine(
          fakeSharpFixture({ outputBytes: 4 }),
          smallLimits,
        ).engine.optimize(request({ targetWidths: [], formats: ["png"] })),
      TypeError,
      "exceeds 3 bytes",
    );
    await assertRejects(
      () =>
        engine(
          fakeSharpFixture({ outputSizeOffset: 1 }),
          smallLimits,
        ).engine.optimize(request({ targetWidths: [], formats: ["png"] })),
      TypeError,
      "size metadata does not match",
    );
    await assertRejects(
      () =>
        engine(fakeSharpFixture(), {
          ...smallLimits,
          maxTotalOutputBytes: 3,
        }).engine.optimize(
          request({ targetWidths: [], formats: ["webp", "png"] }),
        ),
      TypeError,
      "outputs exceed 3 bytes",
    );
  });

  it("does not settle after abort until started native work finishes", async () => {
    let markNativeStarted!: () => void;
    const nativeStarted = new Promise<void>((resolve) => {
      markNativeStarted = resolve;
    });
    let finishNative!: (value: unknown) => void;
    const nativeOperation = new Promise<unknown>((resolve) => {
      finishNative = resolve;
    });
    const value = engine(fakeSharpFixture({
      outputPromise: nativeOperation,
      onToBuffer: markNativeStarted,
    }));
    const controller = new AbortController();
    const operation = value.engine.optimize(request({ signal: controller.signal }));
    const providerSettlement = operation.then(
      () => true,
      () => true,
    );

    await nativeStarted;
    controller.abort();
    const settledBeforeNative = await Promise.race([
      providerSettlement,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0)),
    ]);
    if (settledBeforeNative) {
      finishNative(undefined);
      await operation.catch(() => undefined);
    }
    assertEquals(settledBeforeNative, false);

    finishNative(undefined);
    await assertRejects(
      () => operation,
      Error,
      "cancelled or exceeded its deadline",
    );
    assertEquals(await providerSettlement, true);
  });
});
