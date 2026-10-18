import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ensureNpmNodeModulesLinks } from "../../tests/ensure-npm-links.mjs";
import { executorBootstrapTestPatterns } from "../../tests/integration/agent/executor-node-bootstrap-groups.fixture.ts";
import { buildRuntimeTestProcessEnv } from "./runtime-env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_FILES = [
  "src/platform/compat/react-paths.ts",
  "src/react/compat/ssr-adapter/server-loader.ts",
  "src/transforms/esm/http-cache-helpers.ts",
  "src/transforms/esm/package-registry.ts",
  "src/platform/compat/native-stream-file.ts",
  "src/agent/hosted/executor-allocator-client.ts",
  "src/agent/hosted/executor-node-bootstrap.ts",
  "src/agent/hosted/executor-runtime-entrypoint.ts",
  "src/server/isolated-http/application-runtime.ts",
  "src/agent/hosted/executor-node-transport.ts",
  "src/security/http/native-body-processing.ts",
  "src/security/http/native-header-processing.ts",
  "src/security/http/native-request-processing.ts",
];
const TEST_FILES = [
  "tests/integration/runtime/compat/react-paths.test.ts",
  "tests/integration/runtime/compat/renderer-peer-cache.test.ts",
  "tests/integration/transforms/ssr-local-react.test.ts",
  "tests/integration/semantic-unit-boundary/src/platform/compat/native-stream-file.test.ts",
  "tests/integration/agent/executor-allocator-client.test.ts",
  "tests/integration/agent/executor-node-bootstrap.test.ts",
  "tests/integration/agent/executor-node-transport.test.ts",
  "tests/integration/agent/service-header-boundary.test.ts",
  "tests/integration/agent/service-request-defaults.test.ts",
  "tests/integration/agent/service-native-invocation.test.ts",
  "tests/integration/security/application-request.test.ts",
];

/** Build the same native coverage command for the fixed lane and its mapping regression. */
export function buildNativeCoverageArgs(
  { root, reportPath, sourceFiles, testFiles, timeoutMs = 30_000 },
) {
  return [
    "--enable-source-maps",
    "--import",
    resolve(root, "tests/node/resolver.mjs"),
    "--experimental-test-coverage",
    "--test",
    "--test-concurrency=1",
    `--test-timeout=${timeoutMs}`,
    ...sourceFiles.map((source) => `--test-coverage-include=${source}`),
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${reportPath}`,
    ...testFiles,
  ];
}

/** Every real test file retains its own budget; cold installs share port 8081. */
export function buildNativeCoverageGroups() {
  const bootstrap = "tests/integration/agent/executor-node-bootstrap.test.ts";
  return [
    {
      testFiles: TEST_FILES.filter((file) => file !== bootstrap),
      pattern: "",
      expectedTests: 191,
    },
    ...executorBootstrapTestPatterns().map((pattern, index) => ({
      testFiles: [bootstrap],
      pattern,
      expectedTests: index === 3 ? 22 : 1,
    })),
  ];
}

/** Owned children inherit the collector's V8 directory for range-aware merging. */
export async function runNativeCoverageGroups(root = ROOT, groups = buildNativeCoverageGroups()) {
  if (!process.env.NODE_V8_COVERAGE) throw new Error("Native coverage collector is required");
  for (const group of groups) {
    // An owned child is a new test runner, while V8 coverage remains inherited.
    const env = buildRuntimeTestProcessEnv(process.env);
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [
      "--enable-source-maps",
      "--import",
      resolve(root, "tests/node/resolver.mjs"),
      "--test",
      "--test-concurrency=1",
      "--test-timeout=30000",
      "--test-reporter=spec",
      ...(group.pattern ? [`--test-name-pattern=${group.pattern}`] : []),
      ...group.testFiles,
    ], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    const timer = group.pattern ? setTimeout(() => child.kill("SIGKILL"), 25_000) : undefined;
    try {
      const code = await new Promise((resolveCode, reject) => {
        child.once("error", reject);
        child.once("close", resolveCode);
      });
      const count = Number(/^ℹ tests (\d+)$/m.exec(output)?.[1]);
      const complete = ["fail", "cancelled", "skipped", "todo"].every((key) =>
        output.includes(`ℹ ${key} 0\n`)
      );
      if (
        code !== 0 || count !== group.expectedTests || !complete ||
        !output.includes(`ℹ pass ${count}\n`)
      ) {
        throw new Error("Incomplete native executor coverage group");
      }
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
    }
  }
}

function sourcePath(root, value) {
  return value.startsWith("file:") ? fileURLToPath(value) : resolve(root, value);
}

/** Reject missing, empty, truncated, or generated-position coverage before upload. */
export async function validateNativeCoverage(
  { root, reportPath, sourceFiles },
) {
  const records = new Map();
  let record;
  for (const line of (await readFile(reportPath, "utf8")).split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      record = {
        source: sourcePath(root, line.slice(3)),
        lines: new Map(),
        functions: new Map(),
      };
    } else if (record && line.startsWith("DA:")) {
      const match = /^DA:(\d+),(\d+)(?:,.*)?$/.exec(line);
      if (match) record.lines.set(Number(match[1]), Number(match[2]));
    } else if (record && line.startsWith("FN:")) {
      const match = /^FN:(\d+),(.+)$/.exec(line);
      if (match) {
        const positions = record.functions.get(match[2]) ?? [];
        positions.push(Number(match[1]));
        record.functions.set(match[2], positions);
      }
    } else if (record && line === "end_of_record") {
      records.set(record.source, record);
      record = undefined;
    }
  }
  const summaries = [];
  for (const source of sourceFiles) {
    const entry = records.get(sourcePath(root, source));
    if (
      !entry?.lines.size || ![...entry.lines.values()].some((hits) => hits > 0)
    ) {
      throw new Error(`Missing native coverage record: ${basename(source)}`);
    }
    const lines = (await readFile(sourcePath(root, source), "utf8")).split(
      /\r?\n/,
    );
    const declarations = lines.flatMap((line, index) => {
      const match = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/.exec(
        line,
      );
      return match ? [{ name: match[1], line: index + 1 }] : [];
    });
    const anchor = declarations.at(-1);
    let first = anchor?.line ?? 1;
    // V8 function ranges can include the preceding closing brace and intervening
    // comments. Source-map lookup can therefore point just before the declaration.
    while (first > 1 && /^\s*(?:$|\/\/|\/\*|\*)/.test(lines[first - 2])) {
      first--;
    }
    first = Math.max(1, first - 1);
    const functionEndOffset = anchor &&
      lines.slice(anchor.line).findIndex((line) => line === "}");
    const functionEnd = functionEndOffset === -1 || !anchor
      ? undefined
      : anchor.line + functionEndOffset + 1;
    const mappedLines = anchor && entry.functions.get(anchor.name);
    const hasOriginalFunctionPosition = mappedLines?.some((line) =>
      functionEnd !== undefined && line >= first && line <= functionEnd
    ) === true;
    if (
      !anchor || !hasOriginalFunctionPosition ||
      [...entry.lines.keys()].some((line) =>
        line < 1 || line > lines.length
      )
    ) {
      throw new Error(
        `Native coverage is not mapped to original source: ${basename(source)}`,
      );
    }
    summaries.push({
      source,
      linesHit: [...entry.lines.values()].filter((hits) => hits > 0).length,
      linesFound: entry.lines.size,
    });
  }
  return summaries;
}

async function main() {
  const reportPath = resolve(ROOT, "coverage/node-executor/lcov.info");
  await mkdir(dirname(reportPath), { recursive: true });
  await rm(reportPath, { force: true });
  ensureNpmNodeModulesLinks(ROOT);
  const child = spawn(
    process.execPath,
    buildNativeCoverageArgs({
      root: ROOT,
      reportPath,
      sourceFiles: SOURCE_FILES,
      // This file only orchestrates bounded children; it does not run fixtures itself.
      testFiles: ["tests/integration/ci/node-executor-coverage.fixture.mjs"],
      timeoutMs: 180_000,
    }),
    {
      cwd: ROOT,
      env: buildRuntimeTestProcessEnv(process.env),
      stdio: "inherit",
    },
  );
  const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
  try {
    const code = await new Promise((resolveCode, reject) => {
      child.once("error", reject);
      child.once("close", resolveCode);
    });
    if (code !== 0) throw new Error("Native executor coverage tests failed");
  } finally {
    clearTimeout(timer);
  }
  const summaries = await validateNativeCoverage({
    root: ROOT,
    reportPath,
    sourceFiles: SOURCE_FILES,
  });
  console.log(JSON.stringify({ nativeExecutorCoverage: summaries }));
}

if (
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
