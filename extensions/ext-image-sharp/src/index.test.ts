import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ImageOptimizationEngineName } from "veryfront/extensions/image";
import sharp from "sharp";
import factory, { SharpImageOptimizationEngine } from "./index.ts";

const pixel = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

describe("ext-image-sharp", () => {
  it("is explicit and provides only ImageOptimizationEngine", () => {
    const extension = factory();
    assertEquals(extension.name, "ext-image-sharp");
    assertEquals(extension.contracts?.provides, [ImageOptimizationEngineName]);
    assertEquals(extension.capabilities, [
      {
        type: "fs:read",
        paths: ["/proc/self/exe", "/usr/bin/ldd"],
      },
      {
        type: "env:read",
        keys: ["MALLOC_ARENA_MAX", "npm_package_config_libvips"],
      },
      { type: "native:ffi" },
    ]);
  });

  it("registers one explicit Sharp engine", async () => {
    const provided = new Map<string, unknown>();
    await factory().setup?.({
      get: () => undefined,
      require: () => {
        throw new Error("unexpected require");
      },
      provide: (name, value) => provided.set(name, value),
      config: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    assertEquals(
      provided.get(ImageOptimizationEngineName) instanceof
        SharpImageOptimizationEngine,
      true,
    );
  });

  it("keeps cache identity immutable and backend-specific", () => {
    const engine = new SharpImageOptimizationEngine();
    assertStringIncludes(engine.cacheIdentity, "sharp@0.35.3");
    assertStringIncludes(engine.cacheIdentity, `vips@${sharp.versions.vips}`);
    assertEquals(Object.isFrozen(engine), true);
    assertThrows(
      () => {
        (engine as { cacheIdentity: string }).cacheIdentity = "mutated";
      },
      TypeError,
    );
    assertStringIncludes(engine.cacheIdentity, "veryfront.image-sharp.v2");
  });

  it("emits exact no-upscale widths and deterministic formats", async () => {
    const input = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 25, g: 50, b: 75 },
      },
    }).png().toBuffer();
    const result = await new SharpImageOptimizationEngine().optimize({
      input,
      targetWidths: [5, 2, 1, 2],
      formats: ["png", "webp"],
      quality: 67,
      signal: new AbortController().signal,
    });

    assertEquals([result.sourceWidth, result.sourceHeight], [3, 2]);
    assertEquals(
      result.variants.map((variant) => [
        variant.width,
        variant.height,
        variant.format,
      ]),
      [
        [1, 1, "webp"],
        [1, 1, "png"],
        [2, 1, "webp"],
        [2, 1, "png"],
        [3, 2, "webp"],
        [3, 2, "png"],
      ],
    );
    assertEquals(
      result.variants.every((variant) => variant.data.length > 0),
      true,
    );
  });

  it("uses auto-oriented source dimensions without enlargement", async () => {
    const input = await sharp({
      create: {
        width: 2,
        height: 3,
        channels: 3,
        background: { r: 25, g: 50, b: 75 },
      },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await new SharpImageOptimizationEngine().optimize({
      input,
      targetWidths: [6, 1],
      formats: ["webp"],
      quality: 80,
      signal: new AbortController().signal,
    });

    assertEquals([result.sourceWidth, result.sourceHeight], [3, 2]);
    assertEquals(
      result.variants.map((variant) => [variant.width, variant.height]),
      [[1, 1], [3, 2]],
    );
  });

  it("fails before native work when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await assertRejects(
      () =>
        new SharpImageOptimizationEngine().optimize({
          input: pixel,
          targetWidths: [1],
          formats: ["png"],
          quality: 80,
          signal: controller.signal,
        }),
      Error,
      "cancelled or exceeded its deadline",
    );
  });

  it("rejects inherited, accessor, and unknown factory configuration", () => {
    assertThrows(
      () => factory(Object.create({ value: true })),
      TypeError,
      "must not inherit",
    );
    assertThrows(
      () => factory({ value: true }),
      TypeError,
      "does not accept",
    );
    let reads = 0;
    const hostile = Object.defineProperty({}, "value", {
      get() {
        reads++;
        return true;
      },
    });
    assertThrows(() => factory(hostile), TypeError, "does not accept");
    assertEquals(reads, 0);
  });
});
