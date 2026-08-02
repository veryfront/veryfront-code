import { MAX_CSS_FILE_BYTES, MAX_CSS_OUTPUT_FILE_BYTES } from "./constants/css.ts";
import { utf8ByteLength } from "./utf8-byte-length.ts";

function assertBoundedCSSContent(
  value: unknown,
  maximumBytes: number,
  label: string,
): number {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  // Every UTF-16 code unit contributes at least one UTF-8 byte. Reject this
  // common oversized case without walking an already-unacceptable string.
  if (value.length > maximumBytes) {
    throw new TypeError(`${label} exceeds ${maximumBytes} bytes`);
  }
  const bytes = utf8ByteLength(value, maximumBytes);
  if (bytes > maximumBytes) {
    throw new TypeError(`${label} exceeds ${maximumBytes} bytes`);
  }
  return bytes;
}

/** Validate one authored CSS input and return its exact UTF-8 byte length. */
export function assertCSSFileContent(value: unknown, label = "CSS input"): number {
  return assertBoundedCSSContent(value, MAX_CSS_FILE_BYTES, label);
}

/** Validate one emitted CSS asset and return its exact UTF-8 byte length. */
export function assertCSSOutputContent(value: unknown, label = "CSS output"): number {
  return assertBoundedCSSContent(value, MAX_CSS_OUTPUT_FILE_BYTES, label);
}
