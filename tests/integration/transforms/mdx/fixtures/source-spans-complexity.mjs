import process from "node:process";

const targetModuleUrl = process.env.VERYFRONT_TEST_SOURCE_SPANS_URL;
const mode = process.env.VERYFRONT_TEST_SOURCE_SPANS_MODE;

async function main() {
  if (mode !== "static" && mode !== "side-effect" && mode !== "dynamic") {
    throw new Error(
      "VERYFRONT_TEST_SOURCE_SPANS_MODE must be static, side-effect, or dynamic",
    );
  }
  if (!targetModuleUrl) {
    throw new Error("VERYFRONT_TEST_SOURCE_SPANS_URL must be an absolute module URL");
  }

  let parsedTargetUrl;
  try {
    parsedTargetUrl = new URL(targetModuleUrl);
  } catch {
    throw new Error("VERYFRONT_TEST_SOURCE_SPANS_URL must be an absolute module URL");
  }

  const method = mode === "dynamic" ? "indexOf" : "startsWith";
  const originalDescriptor = Object.getOwnPropertyDescriptor(String.prototype, method);
  const original = String.prototype[method];
  let calls = 0;

  Object.defineProperty(String.prototype, method, {
    configurable: true,
    writable: true,
    value(...args) {
      calls++;
      return Reflect.apply(original, this, args);
    },
  });

  let sourceSpans;
  try {
    sourceSpans = await import(parsedTargetUrl.href);
  } finally {
    Object.defineProperty(String.prototype, method, originalDescriptor);
  }

  let source;
  let scanner;
  let expectedPaths;
  if (mode === "static" || mode === "side-effect") {
    const repeated = Array.from(
      { length: 3_000 },
      (_, index) => `const value${index} = <Type${index}>input${index};`,
    ).join("\n");
    source = mode === "static"
      ? `${repeated}\nimport real from "./real.js";`
      : `${repeated}\nimport "./real.js";`;
    scanner = mode === "static"
      ? sourceSpans.findStaticImportFromSpans
      : sourceSpans.findStaticSideEffectImportSpans;
    expectedPaths = ["./real.js"];
  } else {
    source = "type Value = unknown;\nconst values = [" +
      Array.from({ length: 8_000 }, (_, index) => `<T${index}>value`).join(",") +
      "];";
    scanner = sourceSpans.findDynamicImportSpans;
    expectedPaths = [];
  }

  if (typeof scanner !== "function") {
    throw new Error(`Source-spans module does not export the scanner for mode ${mode}`);
  }

  const matchRelative = (specifier) => specifier.startsWith("./") ? specifier : null;
  calls = 0;
  const spans = scanner(source, matchRelative, Number.MAX_SAFE_INTEGER);
  const paths = spans.map((span) => span.path);

  if (calls <= 0) {
    throw new Error(`Expected ${method} to be called while scanning in ${mode} mode`);
  }
  const callLimit = mode === "dynamic" ? source.length : source.length * 3;
  if (calls >= callLimit) {
    throw new Error(
      `Expected ${method} calls (${calls}) to be below ${callLimit} in ${mode} mode`,
    );
  }
  if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `Unexpected paths in ${mode} mode: ${JSON.stringify(paths)}; expected ${
        JSON.stringify(expectedPaths)
      }`,
    );
  }

  console.log(JSON.stringify({ mode, calls, sourceLength: source.length, paths }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`source-spans complexity fixture failed: ${message}`);
  process.exitCode = 1;
});
