const originalObjectValues = Object.values;
const originalObjectToJSON = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
let output = "";

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

  // Initialize the serializer while the intrinsic is hostile so the logger's
  // degraded fallback path is exercised after the global is restored.
  await import("./serialization.ts");
  Object.values = originalObjectValues;

  Deno.env.set("LOG_FORMAT", "json");
  const { __resetLoggerConfigForTests, getBaseLogger } = await import("./logger.ts");
  __resetLoggerConfigForTests();

  const originalConsoleLog = console.log;
  try {
    console.log = (value: unknown) => {
      output = String(value);
    };
    getBaseLogger("SERVER")
      .component("token=synthetic-component-secret")
      .info("Fallback probe", { ok: true });
  } finally {
    console.log = originalConsoleLog;
  }
} finally {
  Object.values = originalObjectValues;
  if (originalObjectToJSON !== undefined) {
    Object.defineProperty(Object.prototype, "toJSON", originalObjectToJSON);
  } else {
    delete (Object.prototype as { toJSON?: unknown }).toJSON;
  }
}

console.log(output);
