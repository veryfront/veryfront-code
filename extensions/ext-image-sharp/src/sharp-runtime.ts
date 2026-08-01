/**
 * Descriptor-safe Sharp runtime capture and bounded image optimization.
 *
 * This module is intentionally not a package entry point. The public extension
 * binds it to the exact Sharp dependency declared by the extension manifest.
 */

import type {
  ImageOptimizationEngine,
  ImageOptimizationFormat,
  ImageOptimizationRequest,
  ImageOptimizationResult,
  ImageOptimizationVariantResult,
} from "veryfront/extensions/image";

const apply = Reflect.apply;
const arrayIncludes = Array.prototype.includes;
const arrayIsArray = Array.isArray;
const arrayPush = Array.prototype.push;
const arraySort = Array.prototype.sort;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const numberIsInteger = Number.isInteger;
const numberIsSafeInteger = Number.isSafeInteger;
const ownKeys = Reflect.ownKeys;
const promiseResolve = Promise.resolve;
const promiseThen = Promise.prototype.then;
const PromiseConstructor = Promise;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const SetConstructor = Set;
const setBytes = Uint8Array.prototype.set;
const sortNumbers = (left: number, right: number): number => left - right;
const standardArrayPrototype = Array.prototype;
const standardObjectPrototype = Object.prototype;
const Uint8ArrayConstructor = Uint8Array;

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
const SUPPORTED_FORMATS = freeze(
  [
    "webp",
    "avif",
    "jpeg",
    "png",
  ] as const satisfies readonly ImageOptimizationFormat[],
);
const MAX_SHARP_PROTOTYPE_DEPTH = 16;

/** Provider-level resource limits, independent of core's stricter boundary. */
export const SHARP_IMAGE_LIMITS = freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxDecodedPixels: 100_000_000,
  maxDimension: 32_768,
  maxTargetWidths: 64,
  maxFormats: SUPPORTED_FORMATS.length,
  maxVariants: 256,
  maxOutputBytesPerVariant: 64 * 1024 * 1024,
  maxTotalOutputBytes: 256 * 1024 * 1024,
});

export interface SharpImageLimits {
  readonly maxInputBytes: number;
  readonly maxDecodedPixels: number;
  readonly maxDimension: number;
  readonly maxTargetWidths: number;
  readonly maxFormats: number;
  readonly maxVariants: number;
  readonly maxOutputBytesPerVariant: number;
  readonly maxTotalOutputBytes: number;
}

type UnknownFunction = (...args: never[]) => unknown;

/** Captured calls into one exact Sharp module implementation. */
export interface CapturedSharpRuntime {
  readonly versions: Readonly<Record<string, string>>;
  create(input: Uint8Array, options: Readonly<Record<string, unknown>>): object;
  autoOrient(pipeline: object): object;
  metadata(pipeline: object): unknown;
  clone(pipeline: object): object;
  resize(pipeline: object, options: Readonly<Record<string, unknown>>): object;
  webp(pipeline: object, options: Readonly<Record<string, unknown>>): object;
  avif(pipeline: object, options: Readonly<Record<string, unknown>>): object;
  jpeg(pipeline: object, options: Readonly<Record<string, unknown>>): object;
  png(pipeline: object, options: Readonly<Record<string, unknown>>): object;
  toBuffer(pipeline: object, options: Readonly<Record<string, unknown>>): unknown;
}

interface RequestSnapshot {
  readonly input: Uint8Array;
  readonly targetWidths: readonly number[];
  readonly formats: readonly ImageOptimizationFormat[];
  readonly quality: number;
  readonly signal: AbortSignal;
}

interface Dimensions {
  readonly width: number;
  readonly height: number;
}

function invoke<T>(
  method: UnknownFunction,
  receiver: unknown,
  args: readonly unknown[],
): T {
  return apply(method, receiver, args) as T;
}

function ownDescriptors(value: object, label: string): PropertyDescriptorMap {
  try {
    return getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} properties could not be inspected`, { cause });
  }
}

function readDataProperty(
  descriptors: PropertyDescriptorMap,
  property: string,
  label: string,
): unknown {
  const descriptor = descriptors[property];
  if (descriptor === undefined || !hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} ${property} must be a data property`);
  }
  return descriptor.value;
}

function readOptionalDataProperty(
  descriptors: PropertyDescriptorMap,
  property: string,
  label: string,
): unknown {
  const descriptor = descriptors[property];
  if (descriptor === undefined) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new TypeError(`${label} ${property} must be a data property`);
  }
  return descriptor.value;
}

function assertPlainRecord(value: object, label: string): void {
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
  maximumLength: number,
  label: string,
): unknown[] {
  if (!arrayIsArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  let prototype: object | null;
  try {
    prototype = getPrototypeOf(value);
  } catch (cause) {
    throw new TypeError(`${label} prototype could not be inspected`, { cause });
  }
  if (prototype !== standardArrayPrototype) {
    throw new TypeError(`${label} must use the standard array prototype`);
  }

  const descriptors = ownDescriptors(value, label);
  const length = readDataProperty(descriptors, "length", label);
  if (
    !numberIsSafeInteger(length) ||
    (length as number) < 0 ||
    (length as number) > maximumLength
  ) {
    throw new TypeError(`${label} exceeds its supported length`);
  }

  const entries: unknown[] = [];
  for (let index = 0; index < (length as number); index++) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
    invoke(arrayPush, entries, [descriptor.value]);
  }
  if (ownKeys(descriptors).length !== entries.length + 1) {
    throw new TypeError(`${label} must not define custom properties`);
  }
  return entries;
}

function byteLength(value: unknown, label: string): number {
  try {
    return invoke<number>(byteLengthGetter!, value, []);
  } catch (cause) {
    throw new TypeError(`${label} must be a Uint8Array`, { cause });
  }
}

function copyBytes(
  value: unknown,
  maximumLength: number,
  label: string,
): Uint8Array {
  let typedArrayName: unknown;
  try {
    typedArrayName = invoke(typedArrayNameGetter!, value, []);
  } catch (cause) {
    throw new TypeError(`${label} must be a Uint8Array`, { cause });
  }
  if (typedArrayName !== "Uint8Array") {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  const length = byteLength(value, label);
  if (length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  if (length > maximumLength) {
    throw new TypeError(`${label} exceeds ${maximumLength} bytes`);
  }
  try {
    const copy = new Uint8ArrayConstructor(length);
    invoke(setBytes, copy, [value]);
    return copy;
  } catch (cause) {
    throw new TypeError(`${label} could not be copied`, { cause });
  }
}

function isAborted(signal: AbortSignal): boolean {
  return invoke<boolean>(abortedGetter!, signal, []);
}

function snapshotAbortSignal(value: unknown): AbortSignal {
  try {
    invoke<boolean>(abortedGetter!, value, []);
  } catch (cause) {
    throw new TypeError("Image optimization signal must be an AbortSignal", {
      cause,
    });
  }
  return value as AbortSignal;
}

function cancellationError(): Error {
  return new Error("Image optimization was cancelled or exceeded its deadline");
}

function throwIfAborted(signal: AbortSignal): void {
  if (isAborted(signal)) throw cancellationError();
}

async function awaitAbortable<T>(
  value: unknown,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const operation = invoke<Promise<T>>(promiseResolve, Promise, [value]);

  return await new PromiseConstructor<T>((resolve, reject) => {
    let settled = false;
    let listening = false;
    const cleanup = (): void => {
      if (!listening) return;
      listening = false;
      invoke(removeEventListener, signal, ["abort", onAbort]);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        cleanup();
      } catch (cause) {
        reject(
          new TypeError("Image optimization signal listener could not be removed", {
            cause,
          }),
        );
        return;
      }
      callback();
    };
    const onAbort = (): void => settle(() => reject(cancellationError()));

    try {
      invoke(addEventListener, signal, ["abort", onAbort, { once: true }]);
      listening = true;
    } catch (cause) {
      settle(() =>
        reject(
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

    invoke(promiseThen, operation, [
      (result: T) => settle(() => resolve(result)),
      (cause: unknown) => settle(() => reject(cause)),
    ]);
  });
}

function snapshotRequest(
  value: ImageOptimizationRequest,
  limits: SharpImageLimits,
): RequestSnapshot {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("Image optimization request must be an object");
  }
  assertPlainRecord(value, "Image optimization request");
  const descriptors = ownDescriptors(value, "Image optimization request");
  assertExactProperties(
    descriptors,
    REQUEST_PROPERTIES,
    "Image optimization request",
  );

  const signal = snapshotAbortSignal(
    readDataProperty(descriptors, "signal", "Image optimization request"),
  );
  throwIfAborted(signal);
  const input = copyBytes(
    readDataProperty(descriptors, "input", "Image optimization request"),
    limits.maxInputBytes,
    "Image optimization input",
  );
  const targetWidthEntries = denseDataArray(
    readDataProperty(
      descriptors,
      "targetWidths",
      "Image optimization request",
    ),
    limits.maxTargetWidths,
    "Image optimization target widths",
  );
  const targetWidths: number[] = [];
  for (let index = 0; index < targetWidthEntries.length; index++) {
    const width = targetWidthEntries[index];
    if (
      !numberIsInteger(width) ||
      (width as number) <= 0 ||
      (width as number) > limits.maxDimension
    ) {
      throw new TypeError(
        `Image optimization target widths must be integers from 1 through ${limits.maxDimension}`,
      );
    }
    if (!invoke<boolean>(arrayIncludes, targetWidths, [width])) {
      invoke(arrayPush, targetWidths, [width]);
    }
  }

  const formatEntries = denseDataArray(
    readDataProperty(descriptors, "formats", "Image optimization request"),
    limits.maxFormats,
    "Image optimization formats",
  );
  if (formatEntries.length === 0) {
    throw new TypeError("Image optimization formats must not be empty");
  }
  const requestedFormats = new SetConstructor<ImageOptimizationFormat>();
  for (let index = 0; index < formatEntries.length; index++) {
    const format = formatEntries[index];
    if (
      format !== "webp" && format !== "avif" && format !== "jpeg" &&
      format !== "png"
    ) {
      throw new TypeError("Image optimization format is unsupported");
    }
    if (invoke<boolean>(setHas, requestedFormats, [format])) {
      throw new TypeError("Image optimization formats must be unique");
    }
    invoke(setAdd, requestedFormats, [format]);
  }
  const formats: ImageOptimizationFormat[] = [];
  for (let index = 0; index < SUPPORTED_FORMATS.length; index++) {
    const format = SUPPORTED_FORMATS[index]!;
    if (invoke<boolean>(setHas, requestedFormats, [format])) {
      invoke(arrayPush, formats, [format]);
    }
  }

  const quality = readDataProperty(
    descriptors,
    "quality",
    "Image optimization request",
  );
  if (!numberIsInteger(quality) || (quality as number) < 1 || (quality as number) > 100) {
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

function findMethod(
  prototype: object,
  property: string,
): UnknownFunction {
  const visited = new SetConstructor<object>();
  let owner: object | null = prototype;
  let depth = 0;
  while (owner !== null) {
    if (
      depth >= MAX_SHARP_PROTOTYPE_DEPTH ||
      invoke<boolean>(setHas, visited, [owner])
    ) {
      throw new TypeError("Sharp has an invalid prototype chain");
    }
    invoke(setAdd, visited, [owner]);
    const descriptor = getOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!hasOwn(descriptor, "value") || typeof descriptor.value !== "function") {
        throw new TypeError(`Sharp ${property} must be a data-property method`);
      }
      return descriptor.value as UnknownFunction;
    }
    owner = getPrototypeOf(owner);
    depth++;
  }
  throw new TypeError(`Sharp does not implement ${property}()`);
}

function snapshotVersions(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("Sharp versions must be an object");
  }
  const descriptors = ownDescriptors(value, "Sharp versions");
  const versions: Record<string, string> = createObject(null);
  for (const property of ownKeys(descriptors)) {
    if (typeof property !== "string") {
      throw new TypeError("Sharp versions must not contain symbol properties");
    }
    const version = readDataProperty(descriptors, property, "Sharp versions");
    if (
      typeof version !== "string" || version.length === 0 ||
      version.length > 64
    ) {
      throw new TypeError(`Sharp reported an invalid ${property} version`);
    }
    defineProperty(versions, property, {
      value: version,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return freeze(versions);
}

function requirePipeline(value: unknown, operation: string): object {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError(`Sharp ${operation} did not return an image pipeline`);
  }
  return value;
}

/** Capture Sharp's callable, versions, and prototype methods exactly once. */
export function captureSharpRuntime(value: unknown): CapturedSharpRuntime {
  if (typeof value !== "function") {
    throw new TypeError("Sharp must export an image constructor function");
  }
  let prototypeDescriptor: PropertyDescriptor | undefined;
  let versionsDescriptor: PropertyDescriptor | undefined;
  try {
    prototypeDescriptor = getOwnPropertyDescriptor(value, "prototype");
    versionsDescriptor = getOwnPropertyDescriptor(value, "versions");
  } catch (cause) {
    throw new TypeError("Sharp export could not be inspected", { cause });
  }
  if (
    prototypeDescriptor === undefined ||
    !hasOwn(prototypeDescriptor, "value") ||
    typeof prototypeDescriptor.value !== "object" ||
    prototypeDescriptor.value === null
  ) {
    throw new TypeError("Sharp prototype must be an own data property");
  }
  if (versionsDescriptor === undefined || !hasOwn(versionsDescriptor, "value")) {
    throw new TypeError("Sharp versions must be an own data property");
  }

  const callable = value as UnknownFunction;
  const prototype = prototypeDescriptor.value as object;
  const methods = freeze({
    autoOrient: findMethod(prototype, "autoOrient"),
    metadata: findMethod(prototype, "metadata"),
    clone: findMethod(prototype, "clone"),
    resize: findMethod(prototype, "resize"),
    webp: findMethod(prototype, "webp"),
    avif: findMethod(prototype, "avif"),
    jpeg: findMethod(prototype, "jpeg"),
    png: findMethod(prototype, "png"),
    toBuffer: findMethod(prototype, "toBuffer"),
  });
  const versions = snapshotVersions(versionsDescriptor.value);

  return freeze({
    versions,
    create(
      input: Uint8Array,
      options: Readonly<Record<string, unknown>>,
    ): object {
      return requirePipeline(invoke(callable, undefined, [input, options]), "constructor");
    },
    autoOrient(pipeline: object): object {
      return requirePipeline(invoke(methods.autoOrient, pipeline, []), "autoOrient");
    },
    metadata(pipeline: object): unknown {
      return invoke(methods.metadata, pipeline, []);
    },
    clone(pipeline: object): object {
      return requirePipeline(invoke(methods.clone, pipeline, []), "clone");
    },
    resize(
      pipeline: object,
      options: Readonly<Record<string, unknown>>,
    ): object {
      return requirePipeline(invoke(methods.resize, pipeline, [options]), "resize");
    },
    webp(
      pipeline: object,
      options: Readonly<Record<string, unknown>>,
    ): object {
      return requirePipeline(invoke(methods.webp, pipeline, [options]), "webp");
    },
    avif(
      pipeline: object,
      options: Readonly<Record<string, unknown>>,
    ): object {
      return requirePipeline(invoke(methods.avif, pipeline, [options]), "avif");
    },
    jpeg(
      pipeline: object,
      options: Readonly<Record<string, unknown>>,
    ): object {
      return requirePipeline(invoke(methods.jpeg, pipeline, [options]), "jpeg");
    },
    png(
      pipeline: object,
      options: Readonly<Record<string, unknown>>,
    ): object {
      return requirePipeline(invoke(methods.png, pipeline, [options]), "png");
    },
    toBuffer(
      pipeline: object,
      options: Readonly<Record<string, unknown>>,
    ): unknown {
      return invoke(methods.toBuffer, pipeline, [options]);
    },
  });
}

function assertDimension(
  value: unknown,
  label: string,
  limits: SharpImageLimits,
): asserts value is number {
  if (
    !numberIsInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > limits.maxDimension
  ) {
    throw new TypeError(
      `${label} must be an integer from 1 through ${limits.maxDimension}`,
    );
  }
}

function readDimensions(
  value: unknown,
  label: string,
  limits: SharpImageLimits,
): Dimensions {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const descriptors = ownDescriptors(value, label);
  const width = readDataProperty(descriptors, "width", label);
  const height = readDataProperty(descriptors, "height", label);
  assertDimension(width, `${label} width`, limits);
  assertDimension(height, `${label} height`, limits);
  if (width * height > limits.maxDecodedPixels) {
    throw new TypeError(`${label} exceeds ${limits.maxDecodedPixels} pixels`);
  }
  return freeze({ width, height });
}

function sourceDimensions(
  value: unknown,
  limits: SharpImageLimits,
): Dimensions {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("Sharp metadata must be an object");
  }
  const descriptors = ownDescriptors(value, "Sharp metadata");
  const oriented = readOptionalDataProperty(
    descriptors,
    "autoOrient",
    "Sharp metadata",
  );
  if (oriented !== undefined) {
    return readDimensions(oriented, "Auto-oriented image", limits);
  }
  return readDimensions(value, "Source image", limits);
}

function outputWidths(
  configured: readonly number[],
  sourceWidth: number,
  limits: SharpImageLimits,
): readonly number[] {
  const widths: number[] = [];
  for (let index = 0; index < configured.length; index++) {
    const width = configured[index]!;
    if (width <= sourceWidth) invoke(arrayPush, widths, [width]);
  }
  if (!invoke<boolean>(arrayIncludes, widths, [sourceWidth])) {
    invoke(arrayPush, widths, [sourceWidth]);
  }
  invoke(arraySort, widths, [sortNumbers]);
  if (widths.length > limits.maxTargetWidths) {
    throw new TypeError(
      `Image optimization produces more than ${limits.maxTargetWidths} output widths`,
    );
  }
  return freeze(widths);
}

function encode(
  runtime: CapturedSharpRuntime,
  pipeline: object,
  format: ImageOptimizationFormat,
  quality: number,
): object {
  if (format === "webp") return runtime.webp(pipeline, freeze({ quality }));
  if (format === "avif") return runtime.avif(pipeline, freeze({ quality }));
  if (format === "jpeg") {
    return runtime.jpeg(pipeline, freeze({ quality, progressive: true }));
  }
  return runtime.png(
    pipeline,
    freeze({ quality, compressionLevel: 9, adaptiveFiltering: true }),
  );
}

function readOutput(
  value: unknown,
  format: ImageOptimizationFormat,
  width: number,
  sourceHeight: number,
  aggregate: { value: number },
  limits: SharpImageLimits,
): ImageOptimizationVariantResult {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    throw new TypeError("Sharp output must be an object");
  }
  const descriptors = ownDescriptors(value, "Sharp output");
  const dataValue = readDataProperty(descriptors, "data", "Sharp output");
  const infoValue = readDataProperty(descriptors, "info", "Sharp output");
  const dataLength = byteLength(dataValue, "Sharp output data");
  if (dataLength === 0) throw new TypeError("Sharp returned an empty image");
  if (dataLength > limits.maxOutputBytesPerVariant) {
    throw new TypeError(
      `Sharp output exceeds ${limits.maxOutputBytesPerVariant} bytes`,
    );
  }
  if (typeof infoValue !== "object" || infoValue === null || arrayIsArray(infoValue)) {
    throw new TypeError("Sharp output info must be an object");
  }
  const infoDescriptors = ownDescriptors(infoValue, "Sharp output info");
  const outputWidth = readDataProperty(
    infoDescriptors,
    "width",
    "Sharp output info",
  );
  const outputHeight = readDataProperty(
    infoDescriptors,
    "height",
    "Sharp output info",
  );
  const outputSize = readDataProperty(
    infoDescriptors,
    "size",
    "Sharp output info",
  );
  const outputFormat = readDataProperty(
    infoDescriptors,
    "format",
    "Sharp output info",
  );
  assertDimension(outputWidth, "Sharp output width", limits);
  assertDimension(outputHeight, "Sharp output height", limits);
  if (outputWidth !== width) {
    throw new TypeError(
      `Sharp encoded ${outputWidth}px for requested ${width}px output`,
    );
  }
  if (outputHeight > sourceHeight) {
    throw new TypeError("Sharp enlarged the image height unexpectedly");
  }
  if (!numberIsSafeInteger(outputSize) || outputSize !== dataLength) {
    throw new TypeError("Sharp output size metadata does not match its bytes");
  }
  if (
    outputFormat !== format &&
    !(format === "avif" && outputFormat === "heif")
  ) {
    throw new TypeError(`Sharp returned ${String(outputFormat)} for ${format} output`);
  }
  aggregate.value += dataLength;
  if (
    !numberIsSafeInteger(aggregate.value) ||
    aggregate.value > limits.maxTotalOutputBytes
  ) {
    throw new TypeError(
      `Sharp outputs exceed ${limits.maxTotalOutputBytes} bytes in total`,
    );
  }

  return freeze({
    format,
    width,
    height: outputHeight,
    data: copyBytes(
      dataValue,
      limits.maxOutputBytesPerVariant,
      "Sharp output data",
    ),
  });
}

const SHARP_INPUT_OPTIONS = freeze({
  failOn: "warning",
  limitInputPixels: SHARP_IMAGE_LIMITS.maxDecodedPixels,
  pages: 1,
  sequentialRead: true,
});
const SHARP_OUTPUT_OPTIONS = freeze({ resolveWithObject: true });

/**
 * Internal engine used by the public extension and focused fake-runtime tests.
 * Every call snapshots one request and creates an independent Sharp pipeline.
 */
export class BoundSharpImageOptimizationEngine implements ImageOptimizationEngine {
  readonly cacheIdentity!: string;
  readonly #runtime: CapturedSharpRuntime;
  readonly #limits: SharpImageLimits;

  constructor(
    runtime: CapturedSharpRuntime,
    cacheIdentity: string,
    limits: SharpImageLimits = SHARP_IMAGE_LIMITS,
  ) {
    this.#runtime = runtime;
    this.#limits = limits;
    defineProperty(this, "cacheIdentity", {
      value: cacheIdentity,
      enumerable: true,
      configurable: false,
      writable: false,
    });
    freeze(this);
  }

  async optimize(
    request: ImageOptimizationRequest,
  ): Promise<ImageOptimizationResult> {
    const snapshot = snapshotRequest(request, this.#limits);
    throwIfAborted(snapshot.signal);

    let source = this.#runtime.create(snapshot.input, SHARP_INPUT_OPTIONS);
    throwIfAborted(snapshot.signal);
    source = this.#runtime.autoOrient(source);
    throwIfAborted(snapshot.signal);
    const metadata = await awaitAbortable<unknown>(
      this.#runtime.metadata(source),
      snapshot.signal,
    );
    const sourceSize = sourceDimensions(metadata, this.#limits);
    const widths = outputWidths(
      snapshot.targetWidths,
      sourceSize.width,
      this.#limits,
    );
    if (widths.length * snapshot.formats.length > this.#limits.maxVariants) {
      throw new TypeError(
        `Image optimization produces more than ${this.#limits.maxVariants} variants`,
      );
    }

    const variants: ImageOptimizationVariantResult[] = [];
    const aggregate = { value: 0 };
    for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
      const width = widths[widthIndex]!;
      for (
        let formatIndex = 0;
        formatIndex < snapshot.formats.length;
        formatIndex++
      ) {
        const format = snapshot.formats[formatIndex]!;
        throwIfAborted(snapshot.signal);
        let pipeline = this.#runtime.clone(source);
        pipeline = this.#runtime.resize(
          pipeline,
          freeze({ width, fit: "inside", withoutEnlargement: true }),
        );
        pipeline = encode(this.#runtime, pipeline, format, snapshot.quality);
        const output = await awaitAbortable<unknown>(
          this.#runtime.toBuffer(pipeline, SHARP_OUTPUT_OPTIONS),
          snapshot.signal,
        );
        throwIfAborted(snapshot.signal);
        invoke(arrayPush, variants, [
          readOutput(
            output,
            format,
            width,
            sourceSize.height,
            aggregate,
            this.#limits,
          ),
        ]);
      }
    }

    return freeze({
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      variants: freeze(variants),
    });
  }
}

freeze(BoundSharpImageOptimizationEngine.prototype);
freeze(BoundSharpImageOptimizationEngine);
