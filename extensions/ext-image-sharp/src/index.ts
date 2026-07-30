/**
 * Sharp implementation of the dependency-free ImageOptimizationEngine.
 *
 * @module extensions/ext-image-sharp
 */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  type ImageOptimizationEngine,
  ImageOptimizationEngineName,
  type ImageOptimizationFormat,
  type ImageOptimizationRequest,
  type ImageOptimizationResult,
  MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "veryfront/extensions/image";
import sharp from "sharp";
import extensionPackage from "../deno.json" with { type: "json" };

const ENGINE_SEMANTICS_VERSION = "veryfront.image-sharp.v1";
const MAX_DECODED_IMAGE_PIXELS = 100_000_000;
const MAX_IMAGE_DIMENSION = 32_768;
const SUPPORTED_FORMATS = new Set<ImageOptimizationFormat>([
  "webp",
  "avif",
  "jpeg",
  "png",
]);

function dependencyVersion(specifier: string): string {
  const match = specifier.match(/@([^@/]+)$/);
  if (!match?.[1]) {
    throw new TypeError("ext-image-sharp dependency versions must be exact");
  }
  return match[1];
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Image optimization was cancelled");
}

function assertDimension(value: unknown, label: string): asserts value is number {
  if (
    !Number.isInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_IMAGE_DIMENSION
  ) {
    throw new TypeError(`${label} is outside the supported image dimensions`);
  }
}

function encodeVariant(
  pipeline: sharp.Sharp,
  format: ImageOptimizationFormat,
  quality: number,
): sharp.Sharp {
  if (format === "webp") return pipeline.webp({ quality });
  if (format === "avif") return pipeline.avif({ quality });
  if (format === "jpeg") {
    return pipeline.jpeg({ quality, progressive: true });
  }
  if (format === "png") {
    return pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      quality,
    });
  }
  throw new TypeError(`Unsupported image output format: ${String(format)}`);
}

/** Native image decoder, resizer, and encoder supplied by this extension. */
export class SharpImageOptimizationEngine implements ImageOptimizationEngine {
  readonly cacheIdentity: string;

  constructor() {
    const sharpSpecifier = extensionPackage.imports.sharp;
    const identity = [
      `ext-image-sharp@${extensionPackage.version}`,
      `sharp@${dependencyVersion(sharpSpecifier)}`,
      ENGINE_SEMANTICS_VERSION,
    ].join("|");
    if (identity.length > MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS) {
      throw new TypeError("ext-image-sharp cache identity exceeds the core limit");
    }
    this.cacheIdentity = identity;
  }

  async optimize(
    request: ImageOptimizationRequest,
  ): Promise<ImageOptimizationResult> {
    assertNotAborted(request.signal);
    if (!(request.input instanceof Uint8Array) || request.input.byteLength === 0) {
      throw new TypeError("ext-image-sharp input must be non-empty bytes");
    }
    if (!Array.isArray(request.variants) || request.variants.length === 0) {
      throw new TypeError("ext-image-sharp requires at least one output variant");
    }

    const source = sharp(request.input, {
      failOn: "warning",
      limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
      sequentialRead: true,
    }).autoOrient();
    const sourceMetadata = await source.metadata();
    assertNotAborted(request.signal);
    const sourceWidth = sourceMetadata.autoOrient?.width;
    const sourceHeight = sourceMetadata.autoOrient?.height;
    assertDimension(sourceWidth, "Auto-oriented image width");
    assertDimension(sourceHeight, "Auto-oriented image height");
    if (sourceWidth * sourceHeight > MAX_DECODED_IMAGE_PIXELS) {
      throw new TypeError(
        `Decoded image exceeds ${MAX_DECODED_IMAGE_PIXELS} pixels`,
      );
    }

    const variants = [];
    for (const variant of request.variants) {
      assertNotAborted(request.signal);
      if (
        !SUPPORTED_FORMATS.has(variant.format) ||
        !Number.isInteger(variant.width) ||
        variant.width <= 0 ||
        variant.width > MAX_IMAGE_DIMENSION ||
        !Number.isInteger(variant.quality) ||
        variant.quality < 1 ||
        variant.quality > 100
      ) {
        throw new TypeError("ext-image-sharp received an invalid variant request");
      }

      const resized = source.clone().resize(variant.width, null, {
        fit: "inside",
        withoutEnlargement: false,
      });
      const data = await encodeVariant(
        resized,
        variant.format,
        variant.quality,
      ).toBuffer();
      assertNotAborted(request.signal);
      const metadata = await sharp(data, {
        failOn: "warning",
        limitInputPixels: MAX_DECODED_IMAGE_PIXELS,
        sequentialRead: true,
      }).metadata();
      assertNotAborted(request.signal);
      assertDimension(metadata.width, "Encoded image width");
      assertDimension(metadata.height, "Encoded image height");
      if (metadata.width !== variant.width) {
        throw new TypeError(
          `Sharp encoded ${metadata.width}px for requested ${variant.width}px output`,
        );
      }
      variants.push(Object.freeze({
        format: variant.format,
        width: metadata.width,
        height: metadata.height,
        data,
      }));
    }

    return Object.freeze({
      sourceWidth,
      sourceHeight,
      variants: Object.freeze(variants),
    });
  }
}

function readConfig(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("ext-image-sharp config must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("ext-image-sharp config could not be inspected", {
      cause,
    });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("ext-image-sharp config must not inherit configuration");
  }
  if (keys.length !== 0) {
    throw new TypeError("ext-image-sharp does not accept configuration properties");
  }
}

const factory: ExtensionFactory = (config?: unknown) => {
  readConfig(config);
  const engine = new SharpImageOptimizationEngine();
  return {
    name: "ext-image-sharp",
    version: extensionPackage.version,
    capabilities: [
      {
        type: "env:read",
        keys: ["npm_package_config_libvips"],
      },
      { type: "native:ffi" },
    ],
    contracts: {
      provides: [ImageOptimizationEngineName],
    },
    setup(ctx) {
      ctx.provide(ImageOptimizationEngineName, engine);
      ctx.logger.debug(
        `[ext-image-sharp] ${ImageOptimizationEngineName} registered`,
      );
    },
  };
};

export default factory;
