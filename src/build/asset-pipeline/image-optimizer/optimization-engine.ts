/**
 * Validated invocation boundary for extension-provided image optimizers.
 *
 * @module build/asset-pipeline/image-optimizer/optimization-engine
 */

import { resolve } from "#veryfront/extensions/contracts.ts";
import {
  captureImageOptimizationEngine,
  type ImageOptimizationEngine,
  ImageOptimizationEngineName,
  type ImageOptimizationFormat,
  type ImageOptimizationRequest,
  type ImageOptimizationResult,
  type ImageOptimizationVariantRequest,
  type ImageOptimizationVariantResult,
} from "#veryfront/extensions/image/index.ts";
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_ENGINE_OPERATION_MS,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_BYTES_PER_VARIANT,
  MAX_IMAGE_OUTPUT_SIZES,
  MAX_IMAGE_TOTAL_OUTPUT_BYTES_PER_INPUT,
  SUPPORTED_FORMATS,
} from "./constants.ts";

const REQUEST_PROPERTIES = new Set<PropertyKey>([
  "input",
  "variants",
  "signal",
]);
const VARIANT_REQUEST_PROPERTIES = new Set<PropertyKey>([
  "format",
  "width",
  "quality",
]);
const RESULT_PROPERTIES = new Set<PropertyKey>([
  "sourceWidth",
  "sourceHeight",
  "variants",
]);
const VARIANT_RESULT_PROPERTIES = new Set<PropertyKey>([
  "format",
  "width",
  "height",
  "data",
]);
const supportedFormats = new Set<ImageOptimizationFormat>(SUPPORTED_FORMATS);
const typedArraySlice = Uint8Array.prototype.slice;

/** Immutable pairing of one captured engine identity and validated runner. */
export interface ImageOptimizationSession {
  readonly cacheIdentity: string;
  run(
    input: Uint8Array,
    variants: readonly ImageOptimizationVariantRequest[],
    signal?: AbortSignal,
  ): Promise<ImageOptimizationResult>;
}

export interface ImageOptimizationSessionOptions {
  /** Shorter deadline for callers and deterministic tests. Core caps it. */
  readonly operationTimeoutMs?: number;
}

function ownDescriptors(value: object, label: string): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} properties could not be inspected`, { cause });
  }
}

function rejectUnknownProperties(
  descriptors: PropertyDescriptorMap,
  allowed: ReadonlySet<PropertyKey>,
  label: string,
): void {
  if (Reflect.ownKeys(descriptors).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} contains unsupported properties`);
  }
}

function readDataProperty(
  descriptors: PropertyDescriptorMap,
  property: string,
  label: string,
): unknown {
  const descriptor = descriptors[property];
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`${label} ${property} must be a data property`);
  }
  return descriptor.value;
}

function copyBytes(value: unknown, label: string): Uint8Array {
  try {
    const copy = Reflect.apply(typedArraySlice, value, []) as Uint8Array;
    if (Object.getPrototypeOf(copy) !== Uint8Array.prototype) {
      throw new TypeError(`${label} must be a Uint8Array`);
    }
    return copy;
  } catch (cause) {
    if (cause instanceof TypeError && cause.message === `${label} must be a Uint8Array`) {
      throw cause;
    }
    throw new TypeError(`${label} must be a Uint8Array`, { cause });
  }
}

function assertDimension(value: unknown, label: string): asserts value is number {
  if (
    !Number.isInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAX_IMAGE_DIMENSION
  ) {
    throw new TypeError(
      `${label} must be a positive integer no larger than ${MAX_IMAGE_DIMENSION}`,
    );
  }
}

function denseDataArray(
  value: unknown,
  maximumLength: number,
  label: string,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const descriptors = ownDescriptors(value, label);
  const length = readDataProperty(descriptors, "length", label);
  if (
    !Number.isSafeInteger(length) ||
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
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
    entries.push(descriptor.value);
  }
  if (
    Reflect.ownKeys(descriptors).some((key) =>
      typeof key !== "string" ||
      (key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key))
    ) ||
    Reflect.ownKeys(descriptors).length !== entries.length + 1
  ) {
    throw new TypeError(`${label} must not define custom properties`);
  }
  return entries;
}

function snapshotVariantRequests(
  value: readonly ImageOptimizationVariantRequest[],
): readonly ImageOptimizationVariantRequest[] {
  const maximumVariants = SUPPORTED_FORMATS.length * MAX_IMAGE_OUTPUT_SIZES;
  const entries = denseDataArray(value, maximumVariants, "Image optimization variants");
  if (entries.length === 0) {
    throw new TypeError("Image optimization variants must not be empty");
  }

  const identities = new Set<string>();
  const variants = entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new TypeError("Image optimization variant request must be an object");
    }
    const descriptors = ownDescriptors(entry, "Image optimization variant request");
    rejectUnknownProperties(
      descriptors,
      VARIANT_REQUEST_PROPERTIES,
      "Image optimization variant request",
    );
    const format = readDataProperty(
      descriptors,
      "format",
      "Image optimization variant request",
    );
    const width = readDataProperty(
      descriptors,
      "width",
      "Image optimization variant request",
    );
    const quality = readDataProperty(
      descriptors,
      "quality",
      "Image optimization variant request",
    );
    if (typeof format !== "string" || !supportedFormats.has(format as ImageOptimizationFormat)) {
      throw new TypeError("Image optimization variant format is unsupported");
    }
    assertDimension(width, "Image optimization variant width");
    if (!Number.isInteger(quality) || (quality as number) < 1 || (quality as number) > 100) {
      throw new TypeError("Image optimization quality must be an integer from 1 through 100");
    }
    const identity = `${format}\0${width}`;
    if (identities.has(identity)) {
      throw new TypeError("Image optimization variant requests must be unique");
    }
    identities.add(identity);
    return Object.freeze({
      format: format as ImageOptimizationFormat,
      width,
      quality: quality as number,
    });
  });
  return Object.freeze(variants);
}

function snapshotRequest(
  input: Uint8Array,
  variants: readonly ImageOptimizationVariantRequest[],
  signal: AbortSignal,
): ImageOptimizationRequest {
  const inputCopy = copyBytes(input, "Image optimization input");
  if (inputCopy.length === 0) {
    throw new TypeError("Image optimization input must not be empty");
  }
  if (inputCopy.length > MAX_IMAGE_INPUT_BYTES) {
    throw new TypeError(`Image optimization input exceeds ${MAX_IMAGE_INPUT_BYTES} bytes`);
  }
  return Object.freeze({
    input: inputCopy,
    variants: snapshotVariantRequests(variants),
    signal,
  });
}

function snapshotVariantResult(
  value: unknown,
  request: ImageOptimizationVariantRequest,
  aggregateBytes: { value: number },
): ImageOptimizationVariantResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Image optimization variant result must be an object");
  }
  const descriptors = ownDescriptors(value, "Image optimization variant result");
  rejectUnknownProperties(
    descriptors,
    VARIANT_RESULT_PROPERTIES,
    "Image optimization variant result",
  );
  const format = readDataProperty(
    descriptors,
    "format",
    "Image optimization variant result",
  );
  const width = readDataProperty(
    descriptors,
    "width",
    "Image optimization variant result",
  );
  const height = readDataProperty(
    descriptors,
    "height",
    "Image optimization variant result",
  );
  const data = copyBytes(
    readDataProperty(descriptors, "data", "Image optimization variant result"),
    "Image optimization variant data",
  );
  if (format !== request.format || width !== request.width) {
    throw new TypeError("Image optimization engine returned a variant that was not requested");
  }
  assertDimension(width, "Image optimization result width");
  assertDimension(height, "Image optimization result height");
  if (data.length === 0) {
    throw new TypeError("Image optimization engine returned an empty variant");
  }
  if (data.length > MAX_IMAGE_OUTPUT_BYTES_PER_VARIANT) {
    throw new TypeError(
      `Image optimization variant exceeds ${MAX_IMAGE_OUTPUT_BYTES_PER_VARIANT} bytes`,
    );
  }
  aggregateBytes.value += data.length;
  if (
    !Number.isSafeInteger(aggregateBytes.value) ||
    aggregateBytes.value > MAX_IMAGE_TOTAL_OUTPUT_BYTES_PER_INPUT
  ) {
    throw new TypeError(
      `Image optimization result exceeds ${MAX_IMAGE_TOTAL_OUTPUT_BYTES_PER_INPUT} bytes`,
    );
  }
  return Object.freeze({
    format: request.format,
    width: request.width,
    height,
    data,
  });
}

function snapshotResult(
  value: unknown,
  requests: readonly ImageOptimizationVariantRequest[],
): ImageOptimizationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Image optimization result must be an object");
  }
  const descriptors = ownDescriptors(value, "Image optimization result");
  rejectUnknownProperties(descriptors, RESULT_PROPERTIES, "Image optimization result");
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
  assertDimension(sourceWidth, "Image source width");
  assertDimension(sourceHeight, "Image source height");
  const results = denseDataArray(
    readDataProperty(descriptors, "variants", "Image optimization result"),
    requests.length,
    "Image optimization result variants",
  );
  if (results.length !== requests.length) {
    throw new TypeError("Image optimization engine returned an incomplete variant set");
  }
  const aggregateBytes = { value: 0 };
  const variants = results.map((result, index) =>
    snapshotVariantResult(result, requests[index]!, aggregateBytes)
  );
  return Object.freeze({
    sourceWidth,
    sourceHeight,
    variants: Object.freeze(variants),
  });
}

function operationAbortError(timedOut: boolean, timeoutMs: number): Error {
  return new Error(
    timedOut ? `Image optimization exceeded ${timeoutMs} ms` : "Image optimization was cancelled",
  );
}

async function invokeWithDeadline(
  engine: ImageOptimizationEngine,
  request: ImageOptimizationRequest,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<unknown> {
  if (callerSignal?.aborted) throw operationAbortError(false, timeoutMs);

  const controller = new AbortController();
  let settled = false;
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = (timeout: boolean): void => {
    if (settled || controller.signal.aborted) return;
    controller.abort();
    rejectAbort?.(operationAbortError(timeout, timeoutMs));
  };
  const onCallerAbort = (): void => abort(false);
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const timeout = setTimeout(() => abort(true), timeoutMs);

  const engineRequest: ImageOptimizationRequest = Object.freeze({
    ...request,
    signal: controller.signal,
  });
  const operation = Promise.resolve().then(() => engine.optimize(engineRequest));
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    settled = true;
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Create a session around an explicitly supplied engine implementation. */
export function createImageOptimizationSession(
  value: unknown,
  options: ImageOptimizationSessionOptions = {},
): ImageOptimizationSession {
  const engine = captureImageOptimizationEngine(value);
  const operationTimeoutMs = options.operationTimeoutMs ??
    MAX_IMAGE_ENGINE_OPERATION_MS;
  if (
    !Number.isSafeInteger(operationTimeoutMs) ||
    operationTimeoutMs < 1 ||
    operationTimeoutMs > MAX_IMAGE_ENGINE_OPERATION_MS
  ) {
    throw new TypeError(
      `Image optimization timeout must be an integer from 1 through ${MAX_IMAGE_ENGINE_OPERATION_MS}`,
    );
  }
  return Object.freeze({
    cacheIdentity: engine.cacheIdentity,
    async run(
      input: Uint8Array,
      variants: readonly ImageOptimizationVariantRequest[],
      signal?: AbortSignal,
    ): Promise<ImageOptimizationResult> {
      const controller = new AbortController();
      const request = snapshotRequest(input, variants, controller.signal);
      const result = await invokeWithDeadline(
        engine,
        request,
        operationTimeoutMs,
        signal,
      );
      return snapshotResult(result, request.variants);
    },
  });
}

/** Resolve and capture the image engine registered by an explicit extension. */
export function acquireConfiguredImageOptimization(): ImageOptimizationSession {
  return createImageOptimizationSession(
    resolve<unknown>(ImageOptimizationEngineName),
  );
}

/** @internal exposed for adversarial request-shape tests. */
export function assertImageOptimizationRequestShape(value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Image optimization request must be an object");
  }
  const descriptors = ownDescriptors(value, "Image optimization request");
  rejectUnknownProperties(descriptors, REQUEST_PROPERTIES, "Image optimization request");
}
