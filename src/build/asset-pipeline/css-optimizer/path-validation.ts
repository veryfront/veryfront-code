import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";

const apply = Reflect.apply;
const charCodeAtString = String.prototype.charCodeAt;
const isWellFormedString = String.prototype.isWellFormed;
const normalizeString = String.prototype.normalize;
const indexOfString = String.prototype.indexOf;
const sliceString = String.prototype.slice;
const executeRegularExpression = RegExp.prototype.exec;
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

function hasControlOrLineSeparator(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = apply(charCodeAtString, value, [index]);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return true;
    }
  }
  return false;
}

function hasUnsafeSegment(value: string): boolean {
  let start = 0;
  while (start <= value.length) {
    const separator = apply(indexOfString, value, ["/", start]);
    const end = separator < 0 ? value.length : separator;
    const segment = apply(sliceString, value, [start, end]);
    if (segment.length === 0 || segment === "." || segment === "..") {
      return true;
    }
    if (separator < 0) return false;
    start = separator + 1;
  }
  return true;
}

/** Return whether a path is canonical, portable, project-relative CSS metadata. */
export function isSafeCSSRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    !apply(isWellFormedString, value, []) ||
    value !== apply(normalizeString, value, ["NFC"]) ||
    hasControlOrLineSeparator(value) ||
    value[0] === "/" ||
    value[0] === "\\" ||
    apply(executeRegularExpression, WINDOWS_ABSOLUTE_PATH, [value]) !== null ||
    apply(indexOfString, value, ["\\"]) >= 0
  ) {
    return false;
  }

  return !hasUnsafeSegment(value);
}
