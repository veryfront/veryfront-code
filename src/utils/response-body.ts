export interface ResponseTextPrefix {
  text: string;
  /** True when the byte limit was reached before EOF was observed. */
  truncated: boolean;
}

const NativeUint8Array = Uint8Array;
const NativeTextDecoder = TextDecoder;
const ReflectApply = Reflect.apply;
const typedArrayPrototype = Object.getPrototypeOf(NativeUint8Array.prototype);
const typedArrayBufferGetter = requireTypedArrayGetter("buffer");
const typedArrayByteLengthGetter = requireTypedArrayGetter("byteLength");
const typedArrayByteOffsetGetter = requireTypedArrayGetter("byteOffset");
const Uint8ArrayPrototypeSet = NativeUint8Array.prototype.set;
const TextDecoderPrototypeDecode = NativeTextDecoder.prototype.decode;
const StringFromCharCode = String.fromCharCode;
const ArrayPrototypeJoin = Array.prototype.join;
const arrayBufferByteLengthGetterCandidate = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const arrayBufferResizableGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get;

if (typeof arrayBufferByteLengthGetterCandidate !== "function") {
  throw new TypeError("Required ArrayBuffer byteLength intrinsic is unavailable");
}
const arrayBufferByteLengthGetter = arrayBufferByteLengthGetterCandidate;

function requireTypedArrayGetter(
  property: "buffer" | "byteLength" | "byteOffset",
): (this: Uint8Array) => unknown {
  const getter = Object.getOwnPropertyDescriptor(typedArrayPrototype, property)?.get;
  if (typeof getter !== "function") {
    throw new TypeError(`Required Uint8Array ${property} intrinsic is unavailable`);
  }
  return getter;
}

function byteLengthOf(bytes: Uint8Array): number {
  const byteLength = ReflectApply(typedArrayByteLengthGetter, bytes, []);
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 0) {
    throw new InvalidResponseBodyChunkError("Response body chunk has an invalid byte length");
  }
  return byteLength as number;
}

function viewBytes(bytes: Uint8Array, start: number, length: number): Uint8Array {
  const byteLength = byteLengthOf(bytes);
  if (
    !Number.isSafeInteger(start) || start < 0 ||
    !Number.isSafeInteger(length) || length < 0 ||
    start > byteLength - length
  ) {
    throw new InvalidResponseBodyChunkError(
      "Response body byte view is outside its source buffer",
    );
  }
  const buffer = ReflectApply(typedArrayBufferGetter, bytes, []);
  try {
    ReflectApply(arrayBufferByteLengthGetter, buffer as object, []);
  } catch (cause) {
    throw new InvalidResponseBodyChunkError(
      "Response body chunks must use a fixed ArrayBuffer",
      { cause },
    );
  }
  if (
    arrayBufferResizableGetter !== undefined &&
    ReflectApply(arrayBufferResizableGetter, buffer as object, []) === true
  ) {
    throw new InvalidResponseBodyChunkError(
      "Response body chunks must use a fixed ArrayBuffer",
    );
  }
  const byteOffset = ReflectApply(typedArrayByteOffsetGetter, bytes, []) as number;
  return new NativeUint8Array(buffer as ArrayBuffer, byteOffset + start, length);
}

function setBytes(target: Uint8Array, source: Uint8Array): void {
  ReflectApply(Uint8ArrayPrototypeSet, target, [source]);
}

function decodeBytes(
  decoder: TextDecoder,
  input?: Uint8Array,
  options?: TextDecodeOptions,
): string {
  return input === undefined
    ? ReflectApply(TextDecoderPrototypeDecode, decoder, []) as string
    : ReflectApply(TextDecoderPrototypeDecode, decoder, [input, options]) as string;
}

/** Base class for deterministic response-protocol violations. */
export class InvalidResponseBodyError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidResponseBodyError";
  }
}

/** Raised when a response stream yields an invalid byte chunk. */
export class InvalidResponseBodyChunkError extends InvalidResponseBodyError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidResponseBodyChunkError";
  }
}

/** Raised when response metadata cannot describe a bounded body safely. */
export class InvalidResponseBodyMetadataError extends InvalidResponseBodyError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidResponseBodyMetadataError";
  }
}

/** Raised when a streamed JSON envelope is malformed or has the wrong shape. */
export class InvalidResponseBodyJsonError extends InvalidResponseBodyError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidResponseBodyJsonError";
  }
}

/** Raised when streamed JSON nesting exceeds the parser's structural bound. */
export class InvalidResponseBodyJsonNestingError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseBodyJsonNestingError";
  }
}

/** Raised when strict response decoding encounters malformed UTF-8. */
export class InvalidResponseBodyUtf8Error extends InvalidResponseBodyError {
  constructor(options?: ErrorOptions) {
    super("Response body is not valid UTF-8", options);
    this.name = "InvalidResponseBodyUtf8Error";
  }
}

/** Raised when one streamed JSON string exceeds its admitted logical UTF-8 size. */
export class JsonStringValueTooLargeError extends RangeError {
  readonly maximumBytes: number;

  constructor(maximumBytes: number) {
    super(`JSON string value exceeds ${maximumBytes} UTF-8 bytes`);
    this.name = "JsonStringValueTooLargeError";
    this.maximumBytes = maximumBytes;
  }
}

/** Raised when JSON bytes outside the selected string exceed their policy budget. */
export class JsonNonValueBytesTooLargeError extends RangeError {
  readonly maximumBytes: number;

  constructor(maximumBytes: number) {
    super(`JSON content outside the selected string exceeds ${maximumBytes} bytes`);
    this.name = "JsonNonValueBytesTooLargeError";
    this.maximumBytes = maximumBytes;
  }
}

/** Raised when a response exceeds its independent whole-body transport ceiling. */
export class ResponseBodyTooLargeError extends RangeError {
  readonly maximumBytes: number;

  constructor(maximumBytes: number) {
    super(`Response body exceeds ${maximumBytes} bytes`);
    this.name = "ResponseBodyTooLargeError";
    this.maximumBytes = maximumBytes;
  }
}

type JsonObjectState = "key-or-end" | "key" | "colon" | "value" | "comma-or-end";
type JsonArrayState = "value-or-end" | "value" | "comma-or-end";

type JsonFrame =
  | {
    kind: "object";
    state: JsonObjectState;
    currentKeyIsTarget: boolean;
  }
  | {
    kind: "array";
    state: JsonArrayState;
  };

type JsonNumberState =
  | "sign"
  | "zero"
  | "integer"
  | "dot"
  | "fraction"
  | "exponent"
  | "exponent-sign"
  | "exponent-digits";

const MAX_STREAMED_JSON_NESTING_DEPTH = 128;
const STREAMED_JSON_DECODE_CHUNK_BYTES = 64 * 1024;
const STRING_DECODE_CHUNK_CODE_UNITS = 8 * 1024;
// A JSON encoder may represent one single-byte code point as `\u00xx`.
// No valid JSON string representation can use more wire bytes per decoded
// logical UTF-8 byte; supplementary code points use at most 12 / 4 = 3x.
const MAX_JSON_STRING_WIRE_BYTES_PER_LOGICAL_UTF8_BYTE = 6;

/**
 * Derive a hard JSON-document ceiling that admits every string within its
 * logical UTF-8 limit plus a separate policy budget for keys, metadata,
 * delimiters, and other non-value bytes.
 */
export function maximumJsonStringDocumentBytes(
  maximumValueBytes: number,
  maximumNonValueBytes: number,
): number {
  const valueLimit = validateJsonStringReadLimit(
    maximumValueBytes,
    "JSON string byte limit",
    true,
  );
  const nonValueLimit = validateJsonStringReadLimit(
    maximumNonValueBytes,
    "JSON non-value byte limit",
    true,
  );
  if (
    valueLimit >
      (Number.MAX_SAFE_INTEGER - nonValueLimit) /
        MAX_JSON_STRING_WIRE_BYTES_PER_LOGICAL_UTF8_BYTE
  ) {
    throw new RangeError("Combined JSON response byte limit exceeds the safe integer range");
  }
  return nonValueLimit +
    valueLimit * MAX_JSON_STRING_WIRE_BYTES_PER_LOGICAL_UTF8_BYTE;
}

function jsonSyntaxError(detail: string): InvalidResponseBodyJsonError {
  return new InvalidResponseBodyJsonError(`Response body is not valid JSON: ${detail}`);
}

function isJsonWhitespace(codeUnit: number): boolean {
  return codeUnit === 0x20 || codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d;
}

function isJsonDigit(codeUnit: number): boolean {
  return codeUnit >= 0x30 && codeUnit <= 0x39;
}

function decodedJsonSourceCodeUnitByteLength(
  text: string,
  index: number,
  codeUnit: number,
): number {
  if (codeUnit <= 0x7f) return 1;
  if (codeUnit <= 0x7ff) return 2;
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
    const lowSurrogate = text.charCodeAt(index + 1);
    if (!(lowSurrogate >= 0xdc00 && lowSurrogate <= 0xdfff)) {
      throw new InvalidResponseBodyUtf8Error();
    }
    return 4;
  }
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
    const highSurrogate = text.charCodeAt(index - 1);
    if (!(highSurrogate >= 0xd800 && highSurrogate <= 0xdbff)) {
      throw new InvalidResponseBodyUtf8Error();
    }
    return 0;
  }
  return 3;
}

function isJsonValueDelimiter(codeUnit: number): boolean {
  return isJsonWhitespace(codeUnit) || codeUnit === 0x2c || codeUnit === 0x5d ||
    codeUnit === 0x7d;
}

function hexDigitValue(codeUnit: number): number {
  if (codeUnit >= 0x30 && codeUnit <= 0x39) return codeUnit - 0x30;
  if (codeUnit >= 0x41 && codeUnit <= 0x46) return codeUnit - 0x41 + 10;
  if (codeUnit >= 0x61 && codeUnit <= 0x66) return codeUnit - 0x61 + 10;
  return -1;
}

class BoundedUtf8Writer {
  private bytes: Uint8Array;
  private length = 0;
  private pendingHighSurrogate: number | null = null;

  constructor(
    private readonly maximumBytes: number,
    private readonly preserveLoneSurrogates: boolean,
  ) {
    this.bytes = new NativeUint8Array(Math.min(maximumBytes, 8 * 1024));
  }

  appendCodeUnit(codeUnit: number): void {
    if (this.pendingHighSurrogate !== null) {
      const high = this.pendingHighSurrogate;
      this.pendingHighSurrogate = null;
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        const codePoint = 0x10000 + ((high - 0xd800) << 10) + (codeUnit - 0xdc00);
        this.appendCodePoint(codePoint);
        return;
      }
      this.appendCodePoint(this.preserveLoneSurrogates ? high : 0xfffd);
    }

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      this.pendingHighSurrogate = codeUnit;
      return;
    }
    this.appendCodePoint(
      codeUnit >= 0xdc00 && codeUnit <= 0xdfff && !this.preserveLoneSurrogates ? 0xfffd : codeUnit,
    );
  }

  finish(): Uint8Array {
    if (this.pendingHighSurrogate !== null) {
      const high = this.pendingHighSurrogate;
      this.pendingHighSurrogate = null;
      this.appendCodePoint(this.preserveLoneSurrogates ? high : 0xfffd);
    }
    if (this.length === byteLengthOf(this.bytes)) return this.bytes;
    const tight = new NativeUint8Array(this.length);
    setBytes(tight, viewBytes(this.bytes, 0, this.length));
    return tight;
  }

  private appendCodePoint(codePoint: number): void {
    const width = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (width > this.maximumBytes - this.length) {
      throw new JsonStringValueTooLargeError(this.maximumBytes);
    }
    this.ensureCapacity(this.length + width);
    if (width === 1) {
      this.bytes[this.length++] = codePoint;
      return;
    }
    if (width === 2) {
      this.bytes[this.length++] = 0xc0 | (codePoint >>> 6);
      this.bytes[this.length++] = 0x80 | (codePoint & 0x3f);
      return;
    }
    if (width === 3) {
      this.bytes[this.length++] = 0xe0 | (codePoint >>> 12);
      this.bytes[this.length++] = 0x80 | ((codePoint >>> 6) & 0x3f);
      this.bytes[this.length++] = 0x80 | (codePoint & 0x3f);
      return;
    }
    this.bytes[this.length++] = 0xf0 | (codePoint >>> 18);
    this.bytes[this.length++] = 0x80 | ((codePoint >>> 12) & 0x3f);
    this.bytes[this.length++] = 0x80 | ((codePoint >>> 6) & 0x3f);
    this.bytes[this.length++] = 0x80 | (codePoint & 0x3f);
  }

  private ensureCapacity(required: number): void {
    if (required <= byteLengthOf(this.bytes)) return;
    let capacity = byteLengthOf(this.bytes);
    while (capacity < required) {
      capacity = Math.min(
        this.maximumBytes,
        Math.max(required, capacity === 0 ? 64 : capacity * 2),
      );
    }
    const grown = new NativeUint8Array(capacity);
    setBytes(grown, viewBytes(this.bytes, 0, this.length));
    this.bytes = grown;
  }
}

/** Decode the canonical WTF-8 emitted by BoundedUtf8Writer without losing lone surrogates. */
function decodePreservedJsonStringBytes(source: Uint8Array): string {
  const chunks: string[] = [];
  const codeUnits: number[] = [];
  const end = byteLengthOf(source);
  let offset = 0;
  const flush = () => {
    if (codeUnits.length === 0) return;
    chunks[chunks.length] = ReflectApply(
      StringFromCharCode,
      undefined,
      codeUnits,
    ) as string;
    codeUnits.length = 0;
  };

  while (offset < end) {
    const first = source[offset++]!;
    let codePoint: number;
    if (first <= 0x7f) {
      codePoint = first;
    } else if (first <= 0xdf) {
      codePoint = ((first & 0x1f) << 6) |
        (source[offset++]! & 0x3f);
    } else if (first <= 0xef) {
      codePoint = ((first & 0x0f) << 12) |
        ((source[offset++]! & 0x3f) << 6) |
        (source[offset++]! & 0x3f);
    } else {
      codePoint = ((first & 0x07) << 18) |
        ((source[offset++]! & 0x3f) << 12) |
        ((source[offset++]! & 0x3f) << 6) |
        (source[offset++]! & 0x3f);
    }

    if (codePoint <= 0xffff) {
      codeUnits[codeUnits.length] = codePoint;
    } else {
      const scalar = codePoint - 0x10000;
      codeUnits[codeUnits.length] = 0xd800 + (scalar >>> 10);
      codeUnits[codeUnits.length] = 0xdc00 + (scalar & 0x3ff);
    }
    if (codeUnits.length >= STRING_DECODE_CHUNK_CODE_UNITS) flush();
  }
  flush();
  return ReflectApply(ArrayPrototypeJoin, chunks, [""]) as string;
}

/**
 * Incrementally validates one JSON document while retaining only a selected
 * top-level string field. The selected value is UTF-8 encoded as it is parsed,
 * so an oversized logical value fails before the remaining response is read.
 */
class TopLevelJsonStringReader {
  private readonly frames: JsonFrame[] = [];
  private rootState: "value" | "done" = "value";
  private mode: "normal" | "string" | "escape" | "unicode" | "number" | "literal" = "normal";
  private stringRole: "key" | "selected-value" | "discard" = "discard";
  private keyMatches = false;
  private keyIndex = 0;
  private unicodeValue = 0;
  private unicodeDigits = 0;
  private numberState: JsonNumberState = "integer";
  private literal = "";
  private literalIndex = 0;
  private literalIsSelected = false;
  private selectedSeen = false;
  private selectedValue: Uint8Array | null | undefined;
  private selectedWriter: BoundedUtf8Writer | undefined;
  private totalSourceBytes = 0;
  private selectedSourceBytes = 0;

  constructor(
    private readonly fieldName: string,
    private readonly maximumValueBytes: number,
    private readonly preserveLoneSurrogates: boolean,
    private readonly maximumNonValueBytes?: number,
  ) {}

  feed(text: string): void {
    for (let index = 0; index < text.length; index++) {
      const codeUnit = text.charCodeAt(index);
      const sourceByteLength = decodedJsonSourceCodeUnitByteLength(text, index, codeUnit);
      if (this.mode === "string") {
        const selected = this.stringRole === "selected-value" && codeUnit !== 0x22;
        this.consumeString(codeUnit);
        this.recordSourceBytes(sourceByteLength, selected);
        continue;
      }
      if (this.mode === "escape") {
        const selected = this.stringRole === "selected-value";
        this.consumeEscape(codeUnit);
        this.recordSourceBytes(sourceByteLength, selected);
        continue;
      }
      if (this.mode === "unicode") {
        const selected = this.stringRole === "selected-value";
        this.consumeUnicode(codeUnit);
        this.recordSourceBytes(sourceByteLength, selected);
        continue;
      }
      if (this.mode === "literal") {
        this.consumeLiteral(codeUnit);
        this.recordSourceBytes(sourceByteLength, false);
        continue;
      }
      if (this.mode === "number") {
        if (this.consumeNumber(codeUnit)) {
          this.recordSourceBytes(sourceByteLength, false);
          continue;
        }
        index--;
        continue;
      }
      this.consumeNormal(codeUnit);
      this.recordSourceBytes(sourceByteLength, false);
    }
  }

  private recordSourceBytes(sourceByteLength: number, selected: boolean): void {
    this.totalSourceBytes += sourceByteLength;
    if (selected) this.selectedSourceBytes += sourceByteLength;
    if (
      this.maximumNonValueBytes !== undefined &&
      this.totalSourceBytes - this.selectedSourceBytes > this.maximumNonValueBytes
    ) {
      throw new JsonNonValueBytesTooLargeError(this.maximumNonValueBytes);
    }
  }

  finish(): Uint8Array | null {
    if (this.mode === "number") {
      if (!this.numberCanEnd()) throw jsonSyntaxError("incomplete number");
      this.mode = "normal";
      this.completeValue();
    } else if (this.mode !== "normal") {
      throw jsonSyntaxError("incomplete token");
    }
    if (this.frames.length !== 0 || this.rootState !== "done") {
      throw jsonSyntaxError("incomplete document");
    }
    if (!this.selectedSeen || this.selectedValue === undefined) {
      throw new InvalidResponseBodyJsonError(
        `Response body is missing top-level JSON field ${this.fieldName}`,
      );
    }
    return this.selectedValue;
  }

  private consumeNormal(codeUnit: number): void {
    if (isJsonWhitespace(codeUnit)) return;
    if (this.rootState === "done" && this.frames.length === 0) {
      throw jsonSyntaxError("data follows the root value");
    }

    switch (codeUnit) {
      case 0x7b:
        this.beginValue("object");
        this.pushFrame({ kind: "object", state: "key-or-end", currentKeyIsTarget: false });
        return;
      case 0x5b:
        this.beginValue("array");
        this.pushFrame({ kind: "array", state: "value-or-end" });
        return;
      case 0x7d:
        this.closeObject();
        return;
      case 0x5d:
        this.closeArray();
        return;
      case 0x3a:
        this.consumeColon();
        return;
      case 0x2c:
        this.consumeComma();
        return;
      case 0x22:
        this.startString();
        return;
      case 0x74:
        this.startLiteral("true");
        return;
      case 0x66:
        this.startLiteral("false");
        return;
      case 0x6e:
        this.startLiteral("null");
        return;
      case 0x2d:
        this.startNumber("sign");
        return;
      default:
        if (codeUnit === 0x30) {
          this.startNumber("zero");
          return;
        }
        if (codeUnit >= 0x31 && codeUnit <= 0x39) {
          this.startNumber("integer");
          return;
        }
        throw jsonSyntaxError("unexpected character");
    }
  }

  private startString(): void {
    const frame = this.frames.at(-1);
    if (frame?.kind === "object" && (frame.state === "key-or-end" || frame.state === "key")) {
      this.stringRole = "key";
      this.keyMatches = true;
      this.keyIndex = 0;
    } else {
      const selected = this.beginValue("string");
      this.stringRole = selected ? "selected-value" : "discard";
      this.selectedWriter = selected
        ? new BoundedUtf8Writer(
          this.maximumValueBytes,
          this.preserveLoneSurrogates,
        )
        : undefined;
    }
    this.mode = "string";
  }

  private consumeString(codeUnit: number): void {
    if (codeUnit === 0x22) {
      this.finishString();
      return;
    }
    if (codeUnit === 0x5c) {
      this.mode = "escape";
      return;
    }
    if (codeUnit < 0x20) throw jsonSyntaxError("unescaped control character in string");
    this.acceptStringCodeUnit(codeUnit);
  }

  private consumeEscape(codeUnit: number): void {
    let decoded: number;
    switch (codeUnit) {
      case 0x22:
      case 0x2f:
      case 0x5c:
        decoded = codeUnit;
        break;
      case 0x62:
        decoded = 0x08;
        break;
      case 0x66:
        decoded = 0x0c;
        break;
      case 0x6e:
        decoded = 0x0a;
        break;
      case 0x72:
        decoded = 0x0d;
        break;
      case 0x74:
        decoded = 0x09;
        break;
      case 0x75:
        this.unicodeValue = 0;
        this.unicodeDigits = 0;
        this.mode = "unicode";
        return;
      default:
        throw jsonSyntaxError("invalid string escape");
    }
    this.acceptStringCodeUnit(decoded);
    this.mode = "string";
  }

  private consumeUnicode(codeUnit: number): void {
    const digit = hexDigitValue(codeUnit);
    if (digit < 0) throw jsonSyntaxError("invalid Unicode escape");
    this.unicodeValue = this.unicodeValue * 16 + digit;
    this.unicodeDigits++;
    if (this.unicodeDigits === 4) {
      this.acceptStringCodeUnit(this.unicodeValue);
      this.mode = "string";
    }
  }

  private acceptStringCodeUnit(codeUnit: number): void {
    if (this.stringRole === "key") {
      if (
        this.keyIndex >= this.fieldName.length ||
        this.fieldName.charCodeAt(this.keyIndex) !== codeUnit
      ) {
        this.keyMatches = false;
      }
      this.keyIndex++;
      return;
    }
    this.selectedWriter?.appendCodeUnit(codeUnit);
  }

  private finishString(): void {
    this.mode = "normal";
    if (this.stringRole === "key") {
      const frame = this.frames.at(-1);
      if (
        frame?.kind !== "object" ||
        (frame.state !== "key-or-end" && frame.state !== "key")
      ) {
        throw jsonSyntaxError("object key in invalid position");
      }
      frame.currentKeyIsTarget = this.keyMatches && this.keyIndex === this.fieldName.length;
      if (frame.currentKeyIsTarget && this.frames.length === 1 && this.selectedSeen) {
        throw new InvalidResponseBodyJsonError(
          `Response body has duplicate top-level JSON field ${this.fieldName}`,
        );
      }
      frame.state = "colon";
      return;
    }
    if (this.stringRole === "selected-value") {
      this.selectedValue = this.selectedWriter!.finish();
      this.selectedWriter = undefined;
    }
    this.completeValue();
  }

  private startLiteral(literal: "true" | "false" | "null"): void {
    const selected = this.beginValue(literal);
    this.literal = literal;
    this.literalIndex = 1;
    this.literalIsSelected = selected;
    this.mode = "literal";
    if (literal.length === 1) this.finishLiteral();
  }

  private consumeLiteral(codeUnit: number): void {
    if (codeUnit !== this.literal.charCodeAt(this.literalIndex)) {
      throw jsonSyntaxError("invalid literal");
    }
    this.literalIndex++;
    if (this.literalIndex === this.literal.length) this.finishLiteral();
  }

  private finishLiteral(): void {
    this.mode = "normal";
    if (this.literalIsSelected) this.selectedValue = null;
    this.completeValue();
  }

  private startNumber(state: JsonNumberState): void {
    this.beginValue("number");
    this.numberState = state;
    this.mode = "number";
  }

  /** Return false when the current delimiter must be processed again normally. */
  private consumeNumber(codeUnit: number): boolean {
    switch (this.numberState) {
      case "sign":
        if (codeUnit === 0x30) this.numberState = "zero";
        else if (codeUnit >= 0x31 && codeUnit <= 0x39) this.numberState = "integer";
        else throw jsonSyntaxError("invalid number");
        return true;
      case "zero":
        if (codeUnit === 0x2e) this.numberState = "dot";
        else if (codeUnit === 0x65 || codeUnit === 0x45) this.numberState = "exponent";
        else if (isJsonDigit(codeUnit)) throw jsonSyntaxError("leading zero in number");
        else return this.finishNumberAtDelimiter(codeUnit);
        return true;
      case "integer":
        if (isJsonDigit(codeUnit)) return true;
        if (codeUnit === 0x2e) this.numberState = "dot";
        else if (codeUnit === 0x65 || codeUnit === 0x45) this.numberState = "exponent";
        else return this.finishNumberAtDelimiter(codeUnit);
        return true;
      case "dot":
        if (!isJsonDigit(codeUnit)) throw jsonSyntaxError("fraction has no digits");
        this.numberState = "fraction";
        return true;
      case "fraction":
        if (isJsonDigit(codeUnit)) return true;
        if (codeUnit === 0x65 || codeUnit === 0x45) this.numberState = "exponent";
        else return this.finishNumberAtDelimiter(codeUnit);
        return true;
      case "exponent":
        if (codeUnit === 0x2b || codeUnit === 0x2d) this.numberState = "exponent-sign";
        else if (isJsonDigit(codeUnit)) this.numberState = "exponent-digits";
        else throw jsonSyntaxError("exponent has no digits");
        return true;
      case "exponent-sign":
        if (!isJsonDigit(codeUnit)) throw jsonSyntaxError("exponent has no digits");
        this.numberState = "exponent-digits";
        return true;
      case "exponent-digits":
        if (isJsonDigit(codeUnit)) return true;
        return this.finishNumberAtDelimiter(codeUnit);
    }
  }

  private finishNumberAtDelimiter(codeUnit: number): false {
    if (!isJsonValueDelimiter(codeUnit)) throw jsonSyntaxError("invalid number suffix");
    this.mode = "normal";
    this.completeValue();
    return false;
  }

  private numberCanEnd(): boolean {
    return this.numberState === "zero" || this.numberState === "integer" ||
      this.numberState === "fraction" || this.numberState === "exponent-digits";
  }

  private beginValue(
    kind: "object" | "array" | "string" | "number" | "true" | "false" | "null",
  ): boolean {
    let selected = false;
    const frame = this.frames.at(-1);
    if (frame === undefined) {
      if (this.rootState !== "value") throw jsonSyntaxError("unexpected value");
    } else if (frame.kind === "object") {
      if (frame.state !== "value") throw jsonSyntaxError("object value in invalid position");
      selected = this.frames.length === 1 && frame.currentKeyIsTarget;
    } else if (frame.state !== "value-or-end" && frame.state !== "value") {
      throw jsonSyntaxError("array value in invalid position");
    }

    if (selected) {
      if (this.selectedSeen) {
        throw new InvalidResponseBodyJsonError(
          `Response body has duplicate top-level JSON field ${this.fieldName}`,
        );
      }
      this.selectedSeen = true;
      if (kind !== "string" && kind !== "null") {
        throw new InvalidResponseBodyJsonError(
          `Top-level JSON field ${this.fieldName} must be a string or null`,
        );
      }
    }
    return selected;
  }

  private completeValue(): void {
    const frame = this.frames.at(-1);
    if (frame === undefined) {
      if (this.rootState !== "value") throw jsonSyntaxError("unexpected completed value");
      this.rootState = "done";
      return;
    }
    if (frame.kind === "object") {
      if (frame.state !== "value") throw jsonSyntaxError("object value completed out of order");
      frame.state = "comma-or-end";
      frame.currentKeyIsTarget = false;
      return;
    }
    if (frame.state !== "value-or-end" && frame.state !== "value") {
      throw jsonSyntaxError("array value completed out of order");
    }
    frame.state = "comma-or-end";
  }

  private closeObject(): void {
    const frame = this.frames.at(-1);
    if (
      frame?.kind !== "object" ||
      (frame.state !== "key-or-end" && frame.state !== "comma-or-end")
    ) {
      throw jsonSyntaxError("unexpected object close");
    }
    this.frames.pop();
    this.completeValue();
  }

  private closeArray(): void {
    const frame = this.frames.at(-1);
    if (
      frame?.kind !== "array" ||
      (frame.state !== "value-or-end" && frame.state !== "comma-or-end")
    ) {
      throw jsonSyntaxError("unexpected array close");
    }
    this.frames.pop();
    this.completeValue();
  }

  private consumeColon(): void {
    const frame = this.frames.at(-1);
    if (frame?.kind !== "object" || frame.state !== "colon") {
      throw jsonSyntaxError("unexpected colon");
    }
    frame.state = "value";
  }

  private consumeComma(): void {
    const frame = this.frames.at(-1);
    if (frame?.state !== "comma-or-end") throw jsonSyntaxError("unexpected comma");
    frame.state = frame.kind === "object" ? "key" : "value";
  }

  private pushFrame(frame: JsonFrame): void {
    if (this.frames.length >= MAX_STREAMED_JSON_NESTING_DEPTH) {
      throw new InvalidResponseBodyJsonNestingError(
        `Response JSON nesting depth exceeds ${MAX_STREAMED_JSON_NESTING_DEPTH}`,
      );
    }
    this.frames.push(frame);
  }
}

function validateJsonStringReadLimit(value: number, label: string, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new RangeError(
      `${label} must be ${allowZero ? "a non-negative" : "a positive"} safe integer`,
    );
  }
  return value;
}

function cancelResponseBody(response: Response, reason: unknown): void {
  const body = response.body;
  if (!body) return;
  try {
    const reader = body.getReader();
    void reader.cancel(reason).catch(() => {});
    reader.releaseLock();
  } catch {
    // Best effort only; the caller has already failed closed.
  }
}

/**
 * Read one top-level JSON string as exact UTF-8 bytes without retaining or
 * parsing the complete response envelope. Other JSON fields are validated and
 * discarded incrementally. When supplied, `maximumNonValueBytes` independently
 * bounds every source byte outside the selected string's encoded contents.
 */
export async function readResponseJsonStringBytesWithinLimit(
  response: Response,
  fieldName: string,
  maximumValueBytes: number,
  maximumResponseBytes: number,
  abortSignal?: AbortSignal,
  maximumNonValueBytes?: number,
): Promise<Uint8Array | null> {
  return await readResponseJsonStringEncodedWithinLimit(
    response,
    fieldName,
    maximumValueBytes,
    maximumResponseBytes,
    false,
    abortSignal,
    maximumNonValueBytes,
  );
}

/**
 * Read one top-level JSON string losslessly while bounding its logical UTF-8
 * size. Escaped lone surrogates retain the same UTF-16 code units JSON.parse
 * would return; the byte-oriented helper intentionally uses replacement bytes.
 * `maximumNonValueBytes` has the same independent envelope semantics as above.
 */
export async function readResponseJsonStringWithinLimit(
  response: Response,
  fieldName: string,
  maximumValueBytes: number,
  maximumResponseBytes: number,
  abortSignal?: AbortSignal,
  maximumNonValueBytes?: number,
): Promise<string | null> {
  const encoded = await readResponseJsonStringEncodedWithinLimit(
    response,
    fieldName,
    maximumValueBytes,
    maximumResponseBytes,
    true,
    abortSignal,
    maximumNonValueBytes,
  );
  return encoded === null ? null : decodePreservedJsonStringBytes(encoded);
}

async function readResponseJsonStringEncodedWithinLimit(
  response: Response,
  fieldName: string,
  maximumValueBytes: number,
  maximumResponseBytes: number,
  preserveLoneSurrogates: boolean,
  abortSignal?: AbortSignal,
  maximumNonValueBytes?: number,
): Promise<Uint8Array | null> {
  if (typeof fieldName !== "string" || fieldName.length === 0) {
    throw new TypeError("JSON field name must be a non-empty string");
  }
  const valueLimit = validateJsonStringReadLimit(
    maximumValueBytes,
    "JSON string byte limit",
    true,
  );
  const responseLimit = validateJsonStringReadLimit(
    maximumResponseBytes,
    "Response body byte limit",
    false,
  );
  const nonValueLimit = maximumNonValueBytes === undefined
    ? undefined
    : validateJsonStringReadLimit(
      maximumNonValueBytes,
      "JSON non-value byte limit",
      true,
    );
  abortSignal?.throwIfAborted();

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    if (!/^\d+$/.test(contentLengthHeader)) {
      cancelResponseBody(response, "invalid content-length");
      throw new InvalidResponseBodyMetadataError(
        "Response body has an invalid Content-Length",
      );
    }
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength)) {
      cancelResponseBody(response, "invalid content-length");
      throw new InvalidResponseBodyMetadataError(
        "Response body has an invalid Content-Length",
      );
    }
    if (contentLength > responseLimit) {
      cancelResponseBody(response, "response body exceeds limit");
      throw new ResponseBodyTooLargeError(responseLimit);
    }
  }

  const parser = new TopLevelJsonStringReader(
    fieldName,
    valueLimit,
    preserveLoneSurrogates,
    nonValueLimit,
  );
  const body = response.body;
  if (!body) return parser.finish();
  const reader = body.getReader();
  const decoder = new NativeTextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let completed = false;
  let failure: unknown;

  try {
    while (true) {
      const { done, value } = await readChunk(reader, abortSignal);
      if (done) {
        completed = true;
        break;
      }
      const chunkByteLength = byteLengthOf(value);
      if (chunkByteLength > responseLimit - totalBytes) {
        throw new ResponseBodyTooLargeError(responseLimit);
      }
      totalBytes += chunkByteLength;
      for (
        let offset = 0;
        offset < chunkByteLength;
        offset += STREAMED_JSON_DECODE_CHUNK_BYTES
      ) {
        const sliceLength = Math.min(
          chunkByteLength - offset,
          STREAMED_JSON_DECODE_CHUNK_BYTES,
        );
        const chunkSlice = viewBytes(value, offset, sliceLength);
        let decoded: string;
        try {
          decoded = decodeBytes(decoder, chunkSlice, { stream: true });
        } catch (cause) {
          throw new InvalidResponseBodyUtf8Error({ cause });
        }
        parser.feed(decoded);
      }
    }
    let finalDecoded: string;
    try {
      finalDecoded = decodeBytes(decoder);
    } catch (cause) {
      throw new InvalidResponseBodyUtf8Error({ cause });
    }
    parser.feed(finalDecoded);
    return parser.finish();
  } catch (error) {
    failure = error;
    if (error instanceof TypeError || error instanceof RangeError) throw error;
    throw error;
  } finally {
    if (!completed) {
      try {
        void reader.cancel(failure).catch(() => {});
      } catch {
        // Cancellation is best effort; the bounded read has already failed.
      }
    }
    reader.releaseLock();
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!abortSignal) return await reader.read();
  abortSignal.throwIfAborted();

  return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = () => reject(abortSignal.reason);
    abortSignal.addEventListener("abort", onAbort, { once: true });
    if (abortSignal.aborted) onAbort();

    reader.read().then(resolve, reject).finally(() => {
      abortSignal.removeEventListener("abort", onAbort);
    });
  });
}

/** Read at most maxBytes from a response body and cancel any unread remainder. */
export async function readResponseTextPrefix(
  response: Response,
  maxBytes: number,
  abortSignal?: AbortSignal,
  options: { fatalUtf8?: boolean } = {},
): Promise<ResponseTextPrefix> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
  abortSignal?.throwIfAborted();

  const body = response.body;
  if (!body) return { text: "", truncated: false };

  const limit = maxBytes;
  const reader = body.getReader();
  const decoder = new NativeTextDecoder("utf-8", { fatal: options.fatalUtf8 ?? false });
  let remaining = limit;
  let text = "";
  let completed = false;
  let truncated = false;

  try {
    while (remaining > 0) {
      const { done, value } = await readChunk(reader, abortSignal);
      if (done) {
        completed = true;
        break;
      }

      const chunkByteLength = byteLengthOf(value);
      const used = Math.min(chunkByteLength, remaining);
      const chunkSlice = viewBytes(value, 0, used);
      try {
        text += decodeBytes(decoder, chunkSlice, { stream: true });
      } catch (cause) {
        throw new InvalidResponseBodyUtf8Error({ cause });
      }
      remaining -= used;

      if (used < chunkByteLength) {
        truncated = true;
        break;
      }
    }
    if (!completed && remaining === 0) truncated = true;
  } finally {
    if (!completed) {
      try {
        const cancellation = reader.cancel();
        // A response stream controls its cancellation promise. Awaiting that
        // untrusted cleanup can defeat the caller's body timeout, including
        // after an exact-limit read, so initiate cancellation and detach it.
        void cancellation.catch(() => {});
      } catch {
        /* cancellation is best-effort cleanup */
      }
    }
    reader.releaseLock();
  }

  if (truncated) return { text, truncated };
  try {
    return { text: text + decodeBytes(decoder), truncated };
  } catch (cause) {
    throw new InvalidResponseBodyUtf8Error({ cause });
  }
}
