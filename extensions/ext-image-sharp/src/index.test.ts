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
        type: "env:read",
        keys: ["npm_package_config_libvips"],
      },
      { type: "native:ffi" },
    ]);
  });

  it("registers one captured Sharp engine", async () => {
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

  it("encodes exact requested dimensions and applies quality", async () => {
    const engine = new SharpImageOptimizationEngine();
    assertStringIncludes(engine.cacheIdentity, "sharp@0.34.5");
    const result = await engine.optimize({
      input: pixel,
      variants: Object.freeze([
        Object.freeze({ format: "webp", width: 2, quality: 67 }),
        Object.freeze({ format: "jpeg", width: 3, quality: 91 }),
      ]),
      signal: new AbortController().signal,
    });
    assertEquals(result.sourceWidth, 1);
    assertEquals(result.sourceHeight, 1);
    assertEquals(
      result.variants.map((variant) => [
        variant.format,
        variant.width,
        variant.height,
      ]),
      [
        ["webp", 2, 2],
        ["jpeg", 3, 3],
      ],
    );
    assertEquals(result.variants.every((variant) => variant.data.length > 0), true);
  });

  it("fails before work when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await assertRejects(
      () =>
        new SharpImageOptimizationEngine().optimize({
          input: pixel,
          variants: [{ format: "png", width: 1, quality: 80 }],
          signal: controller.signal,
        }),
      Error,
      "cancelled",
    );
  });

  it("reports dimensions after EXIF orientation is applied", async () => {
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
      variants: [{ format: "webp", width: 6, quality: 80 }],
      signal: new AbortController().signal,
    });

    assertEquals([result.sourceWidth, result.sourceHeight], [3, 2]);
    assertEquals(
      [result.variants[0]?.width, result.variants[0]?.height],
      [6, 4],
    );
  });

  it("rejects inherited and unknown factory configuration", () => {
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
  });
});
