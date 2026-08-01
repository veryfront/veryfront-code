/**
 * Log-safe quoting for untrusted extension paths, names, and error text.
 *
 * @module extensions/diagnostic-string
 */

const jsonStringify = JSON.stringify;
const numberToString = Number.prototype.toString;
const reflectApply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringPadStart = String.prototype.padStart;
const stringSlice = String.prototype.slice;

function isBidiControl(code: number): boolean {
  return code === 0x061c || code === 0x200e || code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069);
}

function unicodeEscape(code: number): string {
  const hex = reflectApply(numberToString, code, [16]) as string;
  return `\\u${reflectApply(stringPadStart, hex, [4, "0"]) as string}`;
}

/** Quote a value without leaving record-shaping or bidi controls in diagnostics. */
export function quoteDiagnosticString(value: string): string {
  const quoted = reflectApply(jsonStringify, undefined, [value]) as string;
  let escaped = "";
  for (let index = 0; index < quoted.length; index++) {
    const code = reflectApply(stringCharCodeAt, quoted, [index]) as number;
    if (
      code === 0x007f || (code >= 0x0080 && code <= 0x009f) ||
      code === 0x2028 || code === 0x2029 || isBidiControl(code)
    ) {
      escaped += unicodeEscape(code);
    } else {
      escaped += reflectApply(stringSlice, quoted, [index, index + 1]) as string;
    }
  }
  return escaped;
}
