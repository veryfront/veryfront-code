/** Validated invocation boundary for extension-provided CSS purging engines. */

import {
  captureCSSPurgingEngine,
  type CSSPurgeContentSource,
  type CSSPurgingEngine,
  CSSPurgingEngineName,
  type CSSPurgingRequest,
  type CSSPurgingResult,
} from "#veryfront/extensions/css/index.ts";
import { resolve } from "#veryfront/extensions/contracts.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import {
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_PURGE_SAFELIST_ENTRIES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_TOTAL_BYTES,
  MAX_CSS_TOTAL_OUTPUT_BYTES,
} from "./constants.ts";

const encoder = new TextEncoder();
const REQUEST_KEYS = new Set<PropertyKey>([
  "css",
  "content",
  "safelist",
  "includeRejectedCSS",
]);
const CONTENT_KEYS = new Set<PropertyKey>(["raw", "extension"]);
const RESULT_KEYS = new Set<PropertyKey>(["css", "rejectedCSS"]);

export interface CSSPurgingSession {
  readonly cacheIdentity: string;
  run(request: CSSPurgingRequest): Promise<CSSPurgingResult>;
}

function descriptors(value: object, label: string): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} properties could not be inspected`, { cause });
  }
}

function rejectUnknown(
  values: PropertyDescriptorMap,
  allowed: ReadonlySet<PropertyKey>,
  label: string,
): void {
  if (Reflect.ownKeys(values).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} contains unsupported properties`);
  }
}

function dataProperty(
  values: PropertyDescriptorMap,
  key: string,
  label: string,
  optional = false,
): unknown {
  const descriptor = values[key];
  if (descriptor === undefined) {
    if (optional) return undefined;
    throw new TypeError(`${label} must define ${key}`);
  }
  if (!("value" in descriptor)) {
    throw new TypeError(`${label} ${key} must be a data property`);
  }
  return descriptor.value;
}

function denseArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const values = descriptors(value, label);
  const length = dataProperty(values, "length", label);
  if (!Number.isSafeInteger(length) || (length as number) > maximum) {
    throw new TypeError(`${label} exceeds ${maximum} entries`);
  }
  for (const key of Reflect.ownKeys(values)) {
    if (typeof key !== "string" || (key !== "length" && !/^\d+$/.test(key))) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
  }
  for (let index = 0; index < (length as number); index++) {
    const descriptor = values[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
  }
  if (Reflect.ownKeys(values).length !== (length as number) + 1) {
    throw new TypeError(`${label} must be a dense data-property array`);
  }
  return Array.from({ length: length as number }, (_, index) => values[String(index)]!.value);
}

function snapshotContent(value: unknown): readonly CSSPurgeContentSource[] {
  const candidates = denseArray(value, MAX_CSS_FILES, "CSS purge content");
  if (candidates.length === 0) {
    throw new TypeError("CSS purging requires at least one content source");
  }
  let totalBytes = 0;
  const result: CSSPurgeContentSource[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new TypeError("CSS purge content source is malformed");
    }
    const values = descriptors(candidate, "CSS purge content source");
    rejectUnknown(values, CONTENT_KEYS, "CSS purge content source");
    const raw = dataProperty(values, "raw", "CSS purge content source");
    const extension = dataProperty(values, "extension", "CSS purge content source");
    if (
      typeof raw !== "string" ||
      typeof extension !== "string" ||
      extension.length === 0 ||
      extension.length > 32 ||
      !/^[a-z0-9]+$/.test(extension)
    ) {
      throw new TypeError("CSS purge content source is malformed");
    }
    const bytes = encoder.encode(raw).length;
    if (bytes > MAX_CSS_FILE_BYTES) {
      throw new TypeError(`CSS purge content exceeds ${MAX_CSS_FILE_BYTES} bytes`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_CSS_TOTAL_BYTES) {
      throw new TypeError(`CSS purge content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`);
    }
    result.push(Object.freeze({ raw, extension }));
  }
  return Object.freeze(result);
}

function snapshotSafelist(value: unknown): readonly string[] {
  const candidates = denseArray(
    value,
    MAX_CSS_PURGE_SAFELIST_ENTRIES,
    "CSS purge safelist",
  );
  const result: string[] = [];
  for (const candidate of candidates) {
    if (
      typeof candidate !== "string" ||
      candidate.length === 0 ||
      candidate.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
      candidate.normalize("NFC") !== candidate ||
      hasControlCharacters(candidate) ||
      /\s/u.test(candidate)
    ) {
      throw new TypeError("CSS purge safelist contains an unsafe token");
    }
    result.push(candidate);
  }
  return Object.freeze(result);
}

function snapshotRequest(value: CSSPurgingRequest): CSSPurgingRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("CSS purging request must be an object");
  }
  const values = descriptors(value, "CSS purging request");
  rejectUnknown(values, REQUEST_KEYS, "CSS purging request");
  const css = dataProperty(values, "css", "CSS purging request");
  const includeRejectedCSS = dataProperty(
    values,
    "includeRejectedCSS",
    "CSS purging request",
  );
  if (typeof css !== "string" || encoder.encode(css).length > MAX_CSS_FILE_BYTES) {
    throw new TypeError(`CSS purge input must be a string of at most ${MAX_CSS_FILE_BYTES} bytes`);
  }
  if (typeof includeRejectedCSS !== "boolean") {
    throw new TypeError("CSS purging includeRejectedCSS must be a boolean");
  }
  return Object.freeze({
    css,
    content: snapshotContent(dataProperty(values, "content", "CSS purging request")),
    safelist: snapshotSafelist(dataProperty(values, "safelist", "CSS purging request")),
    includeRejectedCSS,
  });
}

function snapshotResult(value: unknown, includeRejectedCSS: boolean): CSSPurgingResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("CSSPurgingEngine returned an invalid result");
  }
  const values = descriptors(value, "CSS purging result");
  rejectUnknown(values, RESULT_KEYS, "CSS purging result");
  const css = dataProperty(values, "css", "CSS purging result");
  const rejectedCSS = dataProperty(values, "rejectedCSS", "CSS purging result", true);
  if (typeof css !== "string") {
    throw new TypeError("CSSPurgingEngine result css must be a string");
  }
  if (includeRejectedCSS ? typeof rejectedCSS !== "string" : rejectedCSS !== undefined) {
    throw new TypeError(
      includeRejectedCSS
        ? "CSSPurgingEngine did not return requested rejected CSS"
        : "CSSPurgingEngine returned unrequested rejected CSS",
    );
  }
  const cssBytes = encoder.encode(css).length;
  const rejectedBytes = typeof rejectedCSS === "string" ? encoder.encode(rejectedCSS).length : 0;
  if (
    cssBytes > MAX_CSS_OUTPUT_FILE_BYTES ||
    rejectedBytes > MAX_CSS_OUTPUT_FILE_BYTES ||
    cssBytes + rejectedBytes > MAX_CSS_TOTAL_OUTPUT_BYTES
  ) {
    throw new TypeError("CSS purging output exceeds the configured resource limits");
  }
  return Object.freeze({ css, ...(typeof rejectedCSS === "string" ? { rejectedCSS } : {}) });
}

export function createCSSPurgingSession(engine: CSSPurgingEngine): CSSPurgingSession {
  const captured = captureCSSPurgingEngine(engine);
  return Object.freeze({
    cacheIdentity: captured.cacheIdentity,
    async run(request: CSSPurgingRequest): Promise<CSSPurgingResult> {
      const input = snapshotRequest(request);
      const result = await captured.purge(input);
      return snapshotResult(result, input.includeRejectedCSS);
    },
  });
}

export function acquireConfiguredCSSPurging(): CSSPurgingSession {
  return createCSSPurgingSession(resolve<CSSPurgingEngine>(CSSPurgingEngineName));
}
