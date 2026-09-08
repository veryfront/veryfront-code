import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ensureNpmNodeModulesLinks } from "../../tests/ensure-npm-links.mjs";
import { buildRuntimeTestProcessEnv } from "./runtime-env.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_FILES = [
  "src/agent/hosted/executor-allocator-client.ts",
  "src/agent/hosted/executor-node-bootstrap.ts",
  "src/agent/hosted/executor-runtime-entrypoint.ts",
  "src/agent/hosted/executor-node-transport.ts",
  "src/security/http/native-header-processing.ts",
  "src/security/http/native-request-processing.ts",
];
const TEST_FILES = [
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
  { root, reportPath, sourceFiles, testFiles },
) {
  return [
    "--enable-source-maps",
    "--import",
    resolve(root, "tests/node/resolver.mjs"),
    "--experimental-test-coverage",
    "--test",
    "--test-concurrency=1",
    "--test-timeout=30000",
    ...sourceFiles.map((source) => `--test-coverage-include=${source}`),
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${reportPath}`,
    ...testFiles,
  ];
}

function sourcePath(root, value) {
  return value.startsWith("file:")
    ? fileURLToPath(value)
    : resolve(root, value);
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
      if (match) record.functions.set(match[2], Number(match[1]));
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
    const functionEndOffset = anchor && lines.slice(anchor.line).findIndex((line) => line === "}");
    const functionEnd = functionEndOffset === -1 || !anchor
      ? undefined
      : anchor.line + functionEndOffset + 1;
    const mappedLine = anchor && entry.functions.get(anchor.name);
    if (
      !anchor || mappedLine === undefined || mappedLine < first ||
      // Node LCOV can repeat a named function and place the later record at
      // its first executable body range. Bound that retained record to the
      // final top-level function's actual closing brace, never trailing code.
      functionEnd === undefined || mappedLine > functionEnd ||
      [...entry.lines.keys()].some((line) => line < 1 || line > lines.length)
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
      testFiles: TEST_FILES,
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
