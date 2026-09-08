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

/** Serialize own data without invoking accessors or inherited or own toJSON methods. */
export function privateJsonStringify(
  value: unknown,
  _replacer: null = null,
  space?: string | number,
) {
  const ancestors = new NativeSet<object>();
  const copy = (input: unknown): unknown => {
    if (typeof input === "function") return undefined;
    if (typeof input === "bigint") throw new TypeError("Cannot serialize bigint data");
    if (input === null || typeof input !== "object") return input;
    if (apply(setHas, ancestors, [input])) throw new TypeError("Cannot serialize circular data");
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
          throw new TypeError("Private JSON requires data properties");
        }
        const copiedProperty = {
          __proto__: null,
          value: copy(property.value),
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
