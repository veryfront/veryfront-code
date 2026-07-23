import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";

/** Maximum UTF-8 size of one generated HTML document. */
export const MAX_HTML_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_HTML_HYDRATION_DATA_BYTES = 4 * 1024 * 1024;
/** Maximum entries in any one JSON container embedded in hydration data. */
export const MAX_HTML_HYDRATION_JSON_CONTAINER_ENTRIES = 10_000;
/** Aggregate entry budget across user-controlled hydration JSON fields. */
export const MAX_HTML_HYDRATION_JSON_TOTAL_ENTRIES = 5 * MAX_HTML_HYDRATION_JSON_CONTAINER_ENTRIES;
export const MAX_HTML_HYDRATION_JSON_DEPTH = 64;
export const MAX_HTML_HYDRATION_PARAMS = 100;
export const MAX_HTML_HYDRATION_PARAM_VALUES = 100;
export const MAX_HTML_PATH_BYTES = 4096;
export const MAX_HTML_SLUG_BYTES = 2048;
export const MAX_HTML_NONCE_BYTES = 4096;
export const MAX_HTML_RELEASE_ID_BYTES = 256;
export const MAX_HTML_SOURCE_HASH_BYTES = 256;
export const MAX_HTML_NESTED_LAYOUTS = 64;
export const MAX_HTML_HEADINGS = 1000;
export const MAX_HTML_METADATA_TEXT_BYTES = 16 * 1024;
export const MAX_HTML_MODULE_PRELOAD_HINTS = 512;
export const MAX_HTML_IMPORT_MAP_ENTRIES = 1024;
export const MAX_HTML_IMPORT_SPECIFIER_BYTES = 4096;
export const MAX_HTML_IMPORT_VALUE_BYTES = 4096;
export const MAX_HTML_IMPORT_MAP_BYTES = 1024 * 1024;

const textEncoder = new TextEncoder();

export function getUTF8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function assertBoundedHTMLText(
  value: unknown,
  label: string,
  maxBytes: number,
  options: { allowEmpty?: boolean } = {},
): asserts value is string {
  if (typeof value !== "string" || (!options.allowEmpty && value.length === 0)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} must be a string` });
  }
  if (value.length > maxBytes || getUTF8ByteLength(value) > maxBytes) {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} exceeds the size limit` });
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      throw INPUT_VALIDATION_FAILED.create({ detail: `${label} contains control characters` });
    }
  }
}

function sizeLimitError(label: string): Error {
  return INPUT_VALIDATION_FAILED.create({
    detail: `${label} exceeds the size limit`,
  });
}

export function assertHTMLStringSize(
  value: unknown,
  label: string,
  maxBytes = MAX_HTML_OUTPUT_BYTES,
): asserts value is string {
  if (typeof value !== "string") {
    throw INPUT_VALIDATION_FAILED.create({ detail: `${label} must be a string` });
  }
  if (value.length > maxBytes || getUTF8ByteLength(value) > maxBytes) {
    throw sizeLimitError(label);
  }
}

export function assertHTMLPartsSize(
  parts: readonly string[],
  label = "Generated HTML",
): void {
  let bytes = 0;
  for (const part of parts) {
    bytes += getUTF8ByteLength(part);
    if (bytes > MAX_HTML_OUTPUT_BYTES) throw sizeLimitError(label);
  }
}

/**
 * UTF-8 output is never smaller than its UTF-16 code-unit count. This check
 * safely rejects explosive template replacement before allocating the result.
 */
export function assertHTMLProjectedLength(
  codeUnits: number,
  label = "Generated HTML",
): void {
  if (!Number.isSafeInteger(codeUnits) || codeUnits > MAX_HTML_OUTPUT_BYTES) {
    throw sizeLimitError(label);
  }
}
