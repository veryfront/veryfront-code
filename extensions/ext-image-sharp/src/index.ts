/**
 * Sharp implementation of the dependency-free ImageOptimizationEngine.
 *
 * @module extensions/ext-image-sharp
 */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  type ImageOptimizationEngine,
  ImageOptimizationEngineName,
  type ImageOptimizationRequest,
  type ImageOptimizationResult,
  MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "veryfront/extensions/image";
import { arch, platform } from "node:process";
import sharp from "sharp";
import extensionPackage from "../deno.json" with { type: "json" };
import {
  BoundSharpImageOptimizationEngine,
  captureSharpRuntime,
  SHARP_IMAGE_LIMITS,
} from "./sharp-runtime.ts";

const ENGINE_SEMANTICS_VERSION = "veryfront.image-sharp.v2";
const SHARP_VERSION_PATTERN = /^npm:sharp@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const VERSION_COMPONENTS = [
  "vips",
  "aom",
  "ffi",
  "heif",
  "mozjpeg",
  "png",
  "webp",
  "zlib-ng",
] as const;
const executeRegularExpression = RegExp.prototype.exec;
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayJoin = Array.prototype.join;
const arrayPush = Array.prototype.push;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const standardObjectPrototype = Object.prototype;

const sharpRuntime = captureSharpRuntime(sharp);

function exactSharpVersion(specifier: string): string {
  const match = apply(executeRegularExpression, SHARP_VERSION_PATTERN, [specifier]);
  if (!match?.[1]) {
    throw new TypeError("ext-image-sharp requires an exact Sharp dependency version");
  }
  return match[1];
}

function createCacheIdentity(): string {
  const components = [
    `ext-image-sharp@${extensionPackage.version}`,
    `sharp@${exactSharpVersion(extensionPackage.imports.sharp)}`,
    ENGINE_SEMANTICS_VERSION,
    `runtime@${platform}-${arch}`,
  ];
  for (let index = 0; index < VERSION_COMPONENTS.length; index++) {
    const name = VERSION_COMPONENTS[index]!;
    const version = sharpRuntime.versions[name];
    if (typeof version !== "string" || version.length === 0) {
      throw new TypeError(`Sharp did not report its ${name} backend version`);
    }
    apply(arrayPush, components, [`${name}@${version}`]);
  }
  apply(arrayPush, components, [
    `limits@${SHARP_IMAGE_LIMITS.maxDecodedPixels}:` +
    `${SHARP_IMAGE_LIMITS.maxOutputBytesPerVariant}:` +
    `${SHARP_IMAGE_LIMITS.maxTotalOutputBytes}`,
  ]);
  const identity = apply(arrayJoin, components, ["|"]) as string;
  if (identity.length > MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS) {
    throw new TypeError("ext-image-sharp cache identity exceeds the core limit");
  }
  return identity;
}

const CACHE_IDENTITY = createCacheIdentity();

/** Native image decoder, resizer, and encoder supplied by this extension. */
export class SharpImageOptimizationEngine implements ImageOptimizationEngine {
  readonly cacheIdentity!: string;
  readonly #engine: BoundSharpImageOptimizationEngine;

  constructor() {
    this.#engine = new BoundSharpImageOptimizationEngine(
      sharpRuntime,
      CACHE_IDENTITY,
    );
    defineProperty(this, "cacheIdentity", {
      value: CACHE_IDENTITY,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    freeze(this);
  }

  optimize(request: ImageOptimizationRequest): Promise<ImageOptimizationResult> {
    return this.#engine.optimize(request);
  }
}

freeze(SharpImageOptimizationEngine.prototype);
freeze(SharpImageOptimizationEngine);

function readConfig(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("ext-image-sharp config must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = getPrototypeOf(value);
    keys = ownKeys(getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("ext-image-sharp config could not be inspected", {
      cause,
    });
  }
  if (prototype !== standardObjectPrototype && prototype !== null) {
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
        type: "fs:read",
        paths: ["/proc/self/exe", "/usr/bin/ldd"],
      },
      {
        type: "env:read",
        keys: ["MALLOC_ARENA_MAX", "npm_package_config_libvips"],
      },
      { type: "native:ffi" },
    ],
    contracts: {
      provides: ["ImageOptimizationEngine"],
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
