/** JSON operations captured before project discovery can replace global methods. */
export const privateJsonParse = JSON.parse;
const stringify = JSON.stringify;
const apply = Reflect.apply;
const ownKeys = Reflect.ownKeys;
const descriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const setPrototypeOf = Object.setPrototypeOf;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const NativeSet = Set;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const getPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const NativeTypeError = TypeError;
const dateTime = Date.prototype.getTime;
const dateIso = Date.prototype.toISOString;
const urlHref = descriptor(URL.prototype, "href")!.get!;
const numberValue = Number.prototype.valueOf;
const stringValue = String.prototype.valueOf;
const booleanValue = Boolean.prototype.valueOf;
const bigintValue = BigInt.prototype.valueOf;
const finite = Number.isFinite;
const notScalar = Symbol("not-native-json-scalar");

function nativeScalar(value: unknown): unknown {
  try {
    const time = apply(dateTime, value, []) as number;
    return finite(time) ? apply(dateIso, value, []) : null;
  } catch { /* Not a native date. */ }
  try {
    return apply(urlHref, value, []);
  } catch { /* Not a native URL. */ }
  try {
    return apply(numberValue, value, []);
  } catch { /* Not a boxed number. */ }
  try {
    return apply(stringValue, value, []);
  } catch { /* Not a boxed string. */ }
  try {
    return apply(booleanValue, value, []);
  } catch { /* Not a boxed boolean. */ }
  try {
    return apply(bigintValue, value, []);
  } catch { /* Not a boxed bigint. */ }
  return notScalar;
}

/** Serialize own data without invoking accessors or inherited or own toJSON methods. */
export function privateJsonStringify(
  value: unknown,
  _replacer: null = null,
  space?: string | number,
) {
  if (_replacer !== null) {
    throw new NativeTypeError("Private JSON supports data-only serialization");
  }
  const ancestors = new NativeSet<object>();
  let remaining = 100_000;
  const copy = (input: unknown, depth = 0): unknown => {
    if (--remaining < 0 || depth > 128) {
      throw new NativeTypeError("Private JSON data exceeds its structural limit");
    }
    if (typeof input === "function") return undefined;
    if (typeof input === "bigint") throw new NativeTypeError("Cannot serialize bigint data");
    if (input === null || typeof input !== "object") return input;
    const array = isArray(input);
    const prototype = getPrototypeOf(input);
    if (!array && prototype !== null && prototype !== objectPrototype) {
      const scalar = nativeScalar(input);
      if (scalar !== notScalar) return copy(scalar, depth + 1);
    }
    if (array && input.length > 100_000) {
      throw new NativeTypeError("Private JSON data exceeds its structural limit");
    }
    if (apply(setHas, ancestors, [input])) {
      throw new NativeTypeError("Cannot serialize circular data");
    }
    apply(setAdd, ancestors, [input]);
    try {
      const output = isArray(input) ? [] : {};
      setPrototypeOf(output, null);
      const keys = ownKeys(input);
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!;
        if (typeof key !== "string") continue;
        const property = descriptor(input, key);
        if (!property || (!property.enumerable && !(isArray(input) && key === "length"))) continue;
        if (!hasOwn(property, "value")) {
          throw new NativeTypeError("Private JSON requires data properties");
        }
        const copiedProperty = {
          __proto__: null,
          value: copy(property.value, depth + 1),
          enumerable: property.enumerable,
          writable: true,
          configurable: key !== "length" || !isArray(input),
        };
        defineProperty(output, key, copiedProperty);
      }
      return output;
    } finally {
      apply(setDelete, ancestors, [input]);
    }
  };
  return stringify(copy(value), null, space);
}
