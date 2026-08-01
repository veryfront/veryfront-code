import {
  MAX_CSS_SELECTOR_EVIDENCE_BYTES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
} from "./constants/css.ts";
import { isProxy as isProxyWithoutHooks } from "node:util/types";
import { utf8ByteLength } from "./utf8-byte-length.ts";

const whitespacePattern = /\s/u;
const apply = Reflect.apply;
const ArrayConstructor = Array;
const SetConstructor = Set;
const NativeTypeError = TypeError;
const isArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const NumberConstructor = Number;
const StringConstructor = String;
const arrayPush = Array.prototype.push;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const ownKeys = Reflect.ownKeys;
const regexpExec = RegExp.prototype.exec;
const stringCharCodeAt = String.prototype.charCodeAt;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setSizeGetter = (() => {
  const getter = getOwnPropertyDescriptor(SetConstructor.prototype, "size")?.get;
  if (typeof getter !== "function") {
    throw new NativeTypeError("Required Set size intrinsic is unavailable");
  }
  return getter;
})();
const setValues = SetConstructor.prototype.values;
const setIteratorNext = getPrototypeOf(
  apply(setValues, new SetConstructor(), []) as SetIterator<unknown>,
).next as (
  this: SetIterator<unknown>,
) => IteratorResult<unknown>;

function containsWhitespaceOrControl(value: string): boolean {
  if (apply(regexpExec, whitespacePattern, [value]) !== null) return true;
  for (let index = 0; index < value.length; index++) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

/** Validate one provider-neutral class/selector candidate token. */
export function assertCSSCandidateToken(
  value: unknown,
  label = "CSS candidate",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
    containsWhitespaceOrControl(value)
  ) {
    throw new NativeTypeError(
      `${label} must be a non-empty token of at most ${MAX_CSS_SELECTOR_TOKEN_CHARACTERS} characters without whitespace or control characters`,
    );
  }
  return value;
}

function snapshotCandidateArray(value: unknown[], label: string): unknown[] {
  const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : undefined;
  if (
    !numberIsSafeInteger(length) ||
    length < 0 ||
    length > MAX_CSS_SELECTOR_TOKENS
  ) {
    throw new NativeTypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
  }

  const keys = ownKeys(value);
  if (keys.length !== length + 1) {
    throw new NativeTypeError(`${label} must be a dense data-property array`);
  }

  const snapshot = new ArrayConstructor<unknown>(length);
  for (let index = 0; index < length; index++) {
    const descriptor = getOwnPropertyDescriptor(value, StringConstructor(index));
    if (
      descriptor === undefined ||
      !hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new NativeTypeError(`${label} must be a dense data-property array`);
    }
    snapshot[index] = descriptor.value;
  }

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex];
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw new NativeTypeError(`${label} must be a dense data-property array`);
    }
    const index = NumberConstructor(key);
    if (
      !numberIsSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      StringConstructor(index) !== key
    ) {
      throw new NativeTypeError(`${label} must be a dense data-property array`);
    }
  }

  return snapshot;
}

function readIteratorResult(
  result: IteratorResult<unknown>,
  expectedDone: boolean,
  label: string,
): unknown {
  const done = getOwnPropertyDescriptor(result, "done");
  const value = getOwnPropertyDescriptor(result, "value");
  if (
    done === undefined ||
    !hasOwn(done, "value") ||
    done.value !== expectedDone ||
    (expectedDone ? value !== undefined && !hasOwn(value, "value") : value === undefined) ||
    (value !== undefined && !hasOwn(value, "value"))
  ) {
    throw new NativeTypeError(`${label} Set iterator returned an invalid result`);
  }
  return value && hasOwn(value, "value") ? value.value : undefined;
}

function snapshotCandidateSet(value: object, label: string): unknown[] {
  let size: unknown;
  let iterator: SetIterator<unknown>;
  try {
    size = apply(setSizeGetter, value, []);
    iterator = apply(setValues, value, []) as SetIterator<unknown>;
  } catch (cause) {
    throw new NativeTypeError(`${label} must be an array or genuine Set`, { cause });
  }
  if (!numberIsSafeInteger(size) || (size as number) < 0) {
    throw new NativeTypeError(`${label} Set size is invalid`);
  }
  if ((size as number) > MAX_CSS_SELECTOR_TOKENS) {
    throw new NativeTypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
  }

  const snapshot = new ArrayConstructor<unknown>(size as number);
  for (let index = 0; index < snapshot.length; index++) {
    const result = apply(setIteratorNext, iterator, []) as IteratorResult<unknown>;
    snapshot[index] = readIteratorResult(result, false, label);
  }
  readIteratorResult(
    apply(setIteratorNext, iterator, []) as IteratorResult<unknown>,
    true,
    label,
  );
  return snapshot;
}

/** Snapshot, validate, and deduplicate compiler candidate input. */
export function normalizeCSSCandidates(
  value: unknown,
  label = "CSS candidates",
): string[] {
  if (isProxyWithoutHooks(value)) {
    throw new NativeTypeError(`${label} must not be a Proxy`);
  }
  if (typeof value !== "object" || value === null) {
    throw new NativeTypeError(`${label} must be an array or Set`);
  }
  const input = isArray(value)
    ? snapshotCandidateArray(value, label)
    : snapshotCandidateSet(value, label);

  const seenCandidates = new SetConstructor<string>();
  const candidates: string[] = [];
  let evidenceBytes = 0;
  for (let index = 0; index < input.length; index++) {
    const rawCandidate = input[index];
    const candidate = assertCSSCandidateToken(rawCandidate, label);
    if (apply(setHas, seenCandidates, [candidate])) continue;
    if (candidates.length >= MAX_CSS_SELECTOR_TOKENS) {
      throw new NativeTypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
    }
    const remainingBytes = MAX_CSS_SELECTOR_EVIDENCE_BYTES - evidenceBytes;
    const candidateBytes = utf8ByteLength(candidate, remainingBytes);
    if (candidateBytes > remainingBytes) {
      throw new NativeTypeError(
        `${label} cannot exceed ${MAX_CSS_SELECTOR_EVIDENCE_BYTES} UTF-8 bytes`,
      );
    }
    evidenceBytes += candidateBytes;
    apply(setAdd, seenCandidates, [candidate]);
    apply(arrayPush, candidates, [candidate]);
  }
  return candidates;
}
