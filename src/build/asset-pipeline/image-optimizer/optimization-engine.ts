/** Validated invocation boundary for extension-provided image optimizers. */

import {
  captureImageOptimizationEngine,
  type ImageOptimizationEngine,
  ImageOptimizationEngineName,
  type ImageOptimizationFormat,
  type ImageOptimizationRequest,
  type ImageOptimizationResult,
  type ImageOptimizationVariantResult,
} from "#veryfront/extensions/image/index.ts";
import { resolve } from "#veryfront/extensions/contracts.ts";
import { resolveImageVariantWidths } from "#veryfront/utils/image-variant-widths.ts";
import {
  MAX_IMAGE_DECODED_PIXELS,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_BYTES_PER_VARIANT,
  MAX_IMAGE_OUTPUT_SIZES,
  MAX_IMAGE_TOTAL_OUTPUT_BYTES,
  SUPPORTED_FORMATS,
} from "./constants.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayPush = Array.prototype.push;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const isSafeInteger = Number.isSafeInteger;
const ownKeys = Reflect.ownKeys;
const promiseResolve = Promise.resolve;
const promiseThen = Promise.prototype.then;
const PromiseConstructor = Promise;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const SetConstructor = Set;
const setBytes = Uint8Array.prototype.set;
const Uint8ArrayConstructor = Uint8Array;
const standardArrayPrototype = Array.prototype;
const standardObjectPrototype = Object.prototype;
const typedArrayPrototype = getPrototypeOf(Uint8Array.prototype);
const byteLengthGetter = getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayNameGetter = getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const abortedGetter = getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const addEventListener = EventTarget.prototype.addEventListener;
const removeEventListener = EventTarget.prototype.removeEventListener;

if (!byteLengthGetter || !typedArrayNameGetter || !abortedGetter) {
  throw new TypeError("Required image optimization intrinsics are unavailable");
}

const REQUEST_PROPERTIES = freeze(
  [
    "input",
    "targetWidths",
    "formats",
    "quality",
    "signal",
  ] as const,
);
const RESULT_PROPERTIES = freeze(
  [
    "sourceWidth",
    "sourceHeight",
    "variants",
  ] as const,
);
const VARIANT_PROPERTIES = freeze(
  [
    "format",
    "width",
    "height",
    "data",
  ] as const,
);
const MAX_IMAGE_VARIANTS = (MAX_IMAGE_OUTPUT_SIZES + 1) * SUPPORTED_FORMATS.length;

interface RequestSnapshot extends ImageOptimizationRequest {
  readonly targetWidths: readonly number[];
  readonly formats: readonly ImageOptimizationFormat[];
}

/** Immutable captured engine identity and validated operation runner. */
export interface ImageOptimizationSession {
  readonly cacheIdentity: string;
  run(request: ImageOptimizationRequest): Promise<ImageOptimizationResult>;
}

function ownDescriptors(value: object, label: string): PropertyDescriptorMap {
  try {
    return getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} properties could not be inspected`, { cause });
  }
}

function assertPlainObject(value: object, label: string): void {
  let prototype: object | null;
  try {
    prototype = getPrototypeOf(value);
  } catch (cause) {
    throw new TypeError(`${label} prototype could not be inspected`, { cause });
  }
  if (prototype !== standardObjectPrototype && prototype !== null) {
    throw new TypeError(`${label} must not inherit custom behavior`);
  }
}

function readDataProperty(
  descriptors: PropertyDescriptorMap,
  property: string,
  label: string,
): unknown {
  const descriptor = descriptors[property];
  if (descriptor === undefined || !hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} ${property} must be an own data property`);
  }
  return descriptor.value;
}

function assertExactProperties(
  descriptors: PropertyDescriptorMap,
  expected: readonly string[],
  label: string,
): void {
  const keys = ownKeys(descriptors);
  if (keys.length !== expected.length) {
    throw new TypeError(`${label} contains unsupported properties`);
  }
  for (let index = 0; index < expected.length; index++) {
    if (!hasOwn(descriptors, expected[index]!)) {
      throw new TypeError(`${label} contains unsupported properties`);
    }
  }
}

function denseDataArray(
  value: unknown,
  maximum: number,
  label: string,
): unknown[] {
  let isArray: boolean;
  try {
    isArray = arrayIsArray(value);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (!isArray) throw new TypeError(`${label} must be an array`);
  let prototype: object | null;
  try {
    prototype = getPrototypeOf(value);
  } catch (cause) {
    throw new TypeError(`${label} prototype could not be inspected`, { cause });
  }
  if (prototype !== standardArrayPrototype) {
    throw new TypeError(`${label} must use the standard array prototype`);
  }
  const descriptors = ownDescriptors(value as unknown[], label);
  const length = readDataProperty(descriptors, "length", label);
  if (
    !isSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > maximum ||
    ownKeys(descriptors).length !== (length as number) + 1
  ) {
    throw new TypeError(`${label} must be a bounded dense data-property array`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < (length as number); index++) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(`${label} must be a bounded dense data-property array`);
    }
    apply(arrayPush, result, [descriptor.value]);
  }
  return result;
}

function byteLength(value: unknown, label: string): number {
  try {
    return apply(byteLengthGetter!, value, []) as number;
  } catch (cause) {
    throw new TypeError(`${label} must be a Uint8Array`, { cause });
  }
}

function copyBytes(
  value: unknown,
  maximum: number,
  label: string,
): Uint8Array {
  let typedArrayName: unknown;
  try {
    typedArrayName = apply(typedArrayNameGetter!, value, []);
  } catch (cause) {
    throw new TypeError(`${label} must be a Uint8Array`, { cause });
  }
  if (typedArrayName !== "Uint8Array") {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  const length = byteLength(value, label);
  if (length === 0) throw new TypeError(`${label} must not be empty`);
  if (length > maximum) {
    throw new TypeError(`${label} exceeds ${maximum} bytes`);
  }
  try {
    const copy = new Uint8ArrayConstructor(length);
    apply(setBytes, copy, [value]);
    return copy;
  } catch (cause) {
    throw new TypeError(`${label} could not be copied`, { cause });
  }
}

function isAborted(signal: AbortSignal): boolean {
  try {
    return apply(abortedGetter!, signal, []) as boolean;
  } catch (cause) {
    throw new TypeError("Image optimization signal must be an AbortSignal", {
      cause,
    });
  }
}

function cancellationError(): Error {
  return new Error("Image optimization was cancelled or exceeded its deadline");
}

async function awaitAbortable<T>(
  value: unknown,
  signal: AbortSignal,
): Promise<T> {
  if (isAborted(signal)) throw cancellationError();
  const operation = apply(promiseResolve, PromiseConstructor, [value]) as Promise<T>;
  return await new PromiseConstructor<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    let listening = false;
    const cleanup = (): void => {
      if (!listening) return;
      listening = false;
      apply(removeEventListener, signal, ["abort", onAbort]);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        cleanup();
      } catch (cause) {
        rejectPromise(
          new TypeError(
            "Image optimization signal listener could not be removed",
            { cause },
          ),
        );
        return;
      }
      callback();
    };
    const onAbort = (): void => settle(() => rejectPromise(cancellationError()));
    apply(promiseThen, operation, [
      (result: T) => settle(() => resolvePromise(result)),
      (cause: unknown) => settle(() => rejectPromise(cause)),
    ]);
    try {
      apply(addEventListener, signal, ["abort", onAbort, { once: true }]);
      listening = true;
    } catch (cause) {
      settle(() =>
        rejectPromise(
          new TypeError("Image optimization signal could not be observed", {
            cause,
          }),
        )
      );
      return;
    }
    if (isAborted(signal)) {
      onAbort();
      return;
    }
  });
}

function snapshotRequest(value: ImageOptimizationRequest): RequestSnapshot {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("Image optimization request must be an object");
  }
  assertPlainObject(value, "Image optimization request");
  const descriptors = ownDescriptors(value, "Image optimization request");
  assertExactProperties(descriptors, REQUEST_PROPERTIES, "Image optimization request");
  const signal = readDataProperty(
    descriptors,
    "signal",
    "Image optimization request",
  ) as AbortSignal;
  isAborted(signal);
  const input = copyBytes(
    readDataProperty(descriptors, "input", "Image optimization request"),
    MAX_IMAGE_INPUT_BYTES,
    "Image optimization input",
  );

  const widthEntries = denseDataArray(
    readDataProperty(descriptors, "targetWidths", "Image optimization request"),
    MAX_IMAGE_OUTPUT_SIZES,
    "Image optimization target widths",
  );
  const targetWidths: number[] = [];
  const seenWidths = new SetConstructor<number>();
  for (let index = 0; index < widthEntries.length; index++) {
    const width = widthEntries[index];
    if (
      !isSafeInteger(width) ||
      (width as number) <= 0 ||
      (width as number) > MAX_IMAGE_DIMENSION ||
      apply(setHas, seenWidths, [width])
    ) {
      throw new TypeError("Image optimization target widths must be unique supported integers");
    }
    apply(setAdd, seenWidths, [width as number]);
    apply(arrayPush, targetWidths, [width]);
  }

  const formatEntries = denseDataArray(
    readDataProperty(descriptors, "formats", "Image optimization request"),
    SUPPORTED_FORMATS.length,
    "Image optimization formats",
  );
  if (formatEntries.length === 0) {
    throw new TypeError("Image optimization formats must not be empty");
  }
  const formats: ImageOptimizationFormat[] = [];
  const seenFormats = new SetConstructor<ImageOptimizationFormat>();
  for (let index = 0; index < formatEntries.length; index++) {
    const format = formatEntries[index];
    if (
      (format !== "webp" && format !== "avif" && format !== "jpeg" &&
        format !== "png") ||
      apply(setHas, seenFormats, [format])
    ) {
      throw new TypeError("Image optimization formats must be unique and supported");
    }
    apply(setAdd, seenFormats, [format]);
    apply(arrayPush, formats, [format]);
  }
  const quality = readDataProperty(
    descriptors,
    "quality",
    "Image optimization request",
  );
  if (!isSafeInteger(quality) || (quality as number) < 1 || (quality as number) > 100) {
    throw new TypeError("Image optimization quality must be an integer from 1 through 100");
  }
  return freeze({
    input,
    targetWidths: freeze(targetWidths),
    formats: freeze(formats),
    quality: quality as number,
    signal,
  });
}

function assertDimension(value: unknown, label: string): asserts value is number {
  if (
    !isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_IMAGE_DIMENSION
  ) {
    throw new TypeError(`${label} must be a supported positive integer`);
  }
}

function expectedHeight(
  width: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  return Math.max(1, Math.round(sourceHeight * width / sourceWidth));
}

function snapshotResult(
  value: unknown,
  request: RequestSnapshot,
): ImageOptimizationResult {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("ImageOptimizationEngine returned an invalid result");
  }
  assertPlainObject(value, "Image optimization result");
  const descriptors = ownDescriptors(value, "Image optimization result");
  assertExactProperties(descriptors, RESULT_PROPERTIES, "Image optimization result");
  const sourceWidth = readDataProperty(
    descriptors,
    "sourceWidth",
    "Image optimization result",
  );
  const sourceHeight = readDataProperty(
    descriptors,
    "sourceHeight",
    "Image optimization result",
  );
  assertDimension(sourceWidth, "Image optimization source width");
  assertDimension(sourceHeight, "Image optimization source height");
  if (sourceWidth * sourceHeight > MAX_IMAGE_DECODED_PIXELS) {
    throw new TypeError(
      `Image optimization source exceeds ${MAX_IMAGE_DECODED_PIXELS} decoded pixels`,
    );
  }

  const widths = resolveImageVariantWidths(sourceWidth, request.targetWidths);
  const expectedVariants = widths.length * request.formats.length;
  const entries = denseDataArray(
    readDataProperty(descriptors, "variants", "Image optimization result"),
    MAX_IMAGE_VARIANTS,
    "Image optimization variants",
  );
  if (entries.length !== expectedVariants) {
    throw new TypeError("ImageOptimizationEngine returned an incomplete variant matrix");
  }

  const expectedPairs = new SetConstructor<string>();
  for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
    for (let formatIndex = 0; formatIndex < request.formats.length; formatIndex++) {
      apply(setAdd, expectedPairs, [
        `${widths[widthIndex]}\0${request.formats[formatIndex]}`,
      ]);
    }
  }
  const variantsByPair = new Map<string, ImageOptimizationVariantResult>();
  let totalOutputBytes = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (typeof entry !== "object" || entry === null || arrayIsArray(entry)) {
      throw new TypeError("Image optimization variant must be an object");
    }
    assertPlainObject(entry, "Image optimization variant");
    const variantDescriptors = ownDescriptors(entry, "Image optimization variant");
    assertExactProperties(
      variantDescriptors,
      VARIANT_PROPERTIES,
      "Image optimization variant",
    );
    const format = readDataProperty(
      variantDescriptors,
      "format",
      "Image optimization variant",
    );
    const width = readDataProperty(
      variantDescriptors,
      "width",
      "Image optimization variant",
    );
    const height = readDataProperty(
      variantDescriptors,
      "height",
      "Image optimization variant",
    );
    assertDimension(width, "Image optimization variant width");
    assertDimension(height, "Image optimization variant height");
    if (height !== expectedHeight(width, sourceWidth, sourceHeight)) {
      throw new TypeError(
        "ImageOptimizationEngine did not preserve the source aspect ratio",
      );
    }
    if (
      format !== "webp" && format !== "avif" && format !== "jpeg" &&
      format !== "png"
    ) {
      throw new TypeError("ImageOptimizationEngine returned an unsupported format");
    }
    const pair = `${width}\0${format}`;
    if (
      !apply(setHas, expectedPairs, [pair]) ||
      variantsByPair.has(pair)
    ) {
      throw new TypeError("ImageOptimizationEngine returned an unexpected variant");
    }
    const data = copyBytes(
      readDataProperty(
        variantDescriptors,
        "data",
        "Image optimization variant",
      ),
      MAX_IMAGE_OUTPUT_BYTES_PER_VARIANT,
      "Image optimization variant data",
    );
    totalOutputBytes += data.length;
    if (
      !isSafeInteger(totalOutputBytes) ||
      totalOutputBytes > MAX_IMAGE_TOTAL_OUTPUT_BYTES
    ) {
      throw new TypeError(
        `Image optimization outputs exceed ${MAX_IMAGE_TOTAL_OUTPUT_BYTES} bytes`,
      );
    }
    variantsByPair.set(
      pair,
      freeze({
        format,
        width,
        height,
        data,
      }),
    );
  }

  const variants: ImageOptimizationVariantResult[] = [];
  for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
    for (let formatIndex = 0; formatIndex < request.formats.length; formatIndex++) {
      const pair = `${widths[widthIndex]}\0${request.formats[formatIndex]}`;
      const variant = variantsByPair.get(pair);
      if (variant === undefined) {
        throw new TypeError("ImageOptimizationEngine omitted a requested variant");
      }
      apply(arrayPush, variants, [variant]);
    }
  }
  return freeze({
    sourceWidth,
    sourceHeight,
    variants: freeze(variants),
  });
}

/** Capture a provider and validate every request/result crossing its boundary. */
export function createImageOptimizationSession(
  engine: ImageOptimizationEngine,
): ImageOptimizationSession {
  const captured = captureImageOptimizationEngine(engine);
  return freeze({
    cacheIdentity: captured.cacheIdentity,
    async run(request: ImageOptimizationRequest): Promise<ImageOptimizationResult> {
      const input = snapshotRequest(request);
      const result = await awaitAbortable<ImageOptimizationResult>(
        captured.optimize(input),
        input.signal,
      );
      return snapshotResult(result, input);
    },
  });
}

/** Resolve and capture the configured image provider for one publication. */
export function acquireConfiguredImageOptimization(): ImageOptimizationSession {
  return createImageOptimizationSession(
    resolve<ImageOptimizationEngine>(ImageOptimizationEngineName),
  );
}
