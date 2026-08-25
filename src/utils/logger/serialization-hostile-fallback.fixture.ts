const originalObjectValues = Object.values;
const originalObjectToJSON = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");

try {
  Object.values = () => {
    throw new Error("polluted Object.values");
  };
  Object.defineProperty(Object.prototype, "toJSON", {
    configurable: true,
    value() {
      throw new Error("inherited serializer must not run");
    },
  });

  const { stringifyRedactedJson } = await import("./serialization.ts");
  const hostileFallback = {
    toJSON() {
      throw new Error("hostile fallback serializer");
    },
  };

  console.log(stringifyRedactedJson({ ok: true }, hostileFallback));
} finally {
  Object.values = originalObjectValues;
  if (originalObjectToJSON !== undefined) {
    Object.defineProperty(Object.prototype, "toJSON", originalObjectToJSON);
  } else {
    delete (Object.prototype as { toJSON?: unknown }).toJSON;
  }
}
