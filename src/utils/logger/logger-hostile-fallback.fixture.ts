const originalObjectValues = Object.values;

try {
  Object.values = () => {
    throw new Error("polluted Object.values");
  };

  // Initialize the serializer while the intrinsic is hostile so the logger's
  // degraded fallback path is exercised after the global is restored.
  await import("./serialization.ts");
} finally {
  Object.values = originalObjectValues;
}

Deno.env.set("LOG_FORMAT", "json");
const { __resetLoggerConfigForTests, getBaseLogger } = await import("./logger.ts");
__resetLoggerConfigForTests();

let output = "";
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

console.log(output);
