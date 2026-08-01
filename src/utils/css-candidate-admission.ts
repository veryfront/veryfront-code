import {
  MAX_CSS_SELECTOR_EVIDENCE_BYTES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
} from "./constants/css.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { utf8ByteLength } from "./utf8-byte-length.ts";

const whitespacePattern = /\s/u;
const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;
const setSizeGetter = (() => {
  const getter = getOwnPropertyDescriptor(Set.prototype, "size")?.get;
  if (typeof getter !== "function") {
    throw new TypeError("Required Set size intrinsic is unavailable");
  }
  return getter;
})();
const setValues = Set.prototype.values;
const setIteratorNext = Object.getPrototypeOf(new Set().values()).next as (
  this: SetIterator<unknown>,
) => IteratorResult<unknown>;

function containsWhitespaceOrControl(value: string): boolean {
  if (whitespacePattern.test(value)) return true;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
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
    throw new TypeError(
      `${label} must be a non-empty token of at most ${MAX_CSS_SELECTOR_TOKEN_CHARACTERS} characters without whitespace or control characters`,
    );
  }
  return value;
}

function snapshotCandidateArray(value: unknown[], label: string): unknown[] {
  const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_CSS_SELECTOR_TOKENS
  ) {
    throw new TypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
  }

  const keys = ownKeys(value);
  if (keys.length !== length + 1) {
    throw new TypeError(`${label} must be a dense data-property array`);
  }

  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index++) {
    const descriptor = getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
    snapshot[index] = descriptor.value;
  }

  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw new TypeError(`${label} must be a dense data-property array`);
    }
    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      throw new TypeError(`${label} must be a dense data-property array`);
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
    !("value" in done) ||
    done.value !== expectedDone ||
    (expectedDone ? value !== undefined && !("value" in value) : value === undefined) ||
    (value !== undefined && !("value" in value))
  ) {
    throw new TypeError(`${label} Set iterator returned an invalid result`);
  }
  return value && "value" in value ? value.value : undefined;
}

function snapshotCandidateSet(value: object, label: string): unknown[] {
  let size: unknown;
  let iterator: SetIterator<unknown>;
  try {
    size = apply(setSizeGetter, value, []);
    iterator = apply(setValues, value, []) as SetIterator<unknown>;
  } catch (cause) {
    throw new TypeError(`${label} must be an array or genuine Set`, { cause });
  }
  if (!Number.isSafeInteger(size) || (size as number) < 0) {
    throw new TypeError(`${label} Set size is invalid`);
  }
  if ((size as number) > MAX_CSS_SELECTOR_TOKENS) {
    throw new TypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
  }

  const snapshot = new Array<unknown>(size as number);
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
    throw new TypeError(`${label} must not be a Proxy`);
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} must be an array or Set`);
  }
  const input = Array.isArray(value)
    ? snapshotCandidateArray(value, label)
    : snapshotCandidateSet(value, label);

  const candidates = new Set<string>();
  let evidenceBytes = 0;
  for (const rawCandidate of input) {
    const candidate = assertCSSCandidateToken(rawCandidate, label);
    if (candidates.has(candidate)) continue;
    if (candidates.size >= MAX_CSS_SELECTOR_TOKENS) {
      throw new TypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
    }
    const remainingBytes = MAX_CSS_SELECTOR_EVIDENCE_BYTES - evidenceBytes;
    const candidateBytes = utf8ByteLength(candidate, remainingBytes);
    if (candidateBytes > remainingBytes) {
      throw new TypeError(
        `${label} cannot exceed ${MAX_CSS_SELECTOR_EVIDENCE_BYTES} UTF-8 bytes`,
      );
    }
    evidenceBytes += candidateBytes;
    candidates.add(candidate);
  }
  return [...candidates];
}
