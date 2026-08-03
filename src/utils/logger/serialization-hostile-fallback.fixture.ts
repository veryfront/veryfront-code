const originalObjectValues = Object.values;

try {
  Object.values = () => {
    throw new Error("polluted Object.values");
  };

  const { stringifyRedactedJson } = await import("./serialization.ts");
  const hostileFallback = {
    toJSON() {
      throw new Error("hostile fallback serializer");
    },
  };

  console.log(stringifyRedactedJson({ ok: true }, hostileFallback));
} finally {
  Object.values = originalObjectValues;
}
