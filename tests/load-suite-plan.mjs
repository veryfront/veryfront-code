import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PLANNER_PATH = fileURLToPath(
  new URL("../scripts/test/run-suite.ts", import.meta.url),
);
const PLANNER_CONFIG_PATH = fileURLToPath(
  new URL("../scripts/test.deno.json", import.meta.url),
);

/**
 * Resolve one runtime suite through the canonical TypeScript planner.
 * Runtime adapters retain process ownership; this helper only crosses the
 * TypeScript/JavaScript module boundary with a versioned JSON value.
 */
export function loadSuitePlan({
  suite,
  patterns = [],
  include = [],
  exclude = [],
  cwd = process.cwd(),
}) {
  const args = [
    "run",
    `--config=${PLANNER_CONFIG_PATH}`,
    "--allow-read",
    PLANNER_PATH,
    "plan",
    `--suite=${suite}`,
    `--root=${cwd}`,
    ...include.map((pattern) => `--include=${pattern}`),
    ...exclude.map((pattern) => `--exclude=${pattern}`),
    ...(patterns.length > 0 ? ["--", ...patterns] : []),
  ];
  const result = spawnSync("deno", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Unable to start suite planner: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Suite planner failed for ${suite} (exit ${result.status}): ${
        result.stderr.trim() || "no diagnostic"
      }`,
    );
  }

  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Suite planner returned invalid JSON for ${suite}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return validateSuitePlan(value, suite);
}

export function validateSuitePlan(value, expectedSuite) {
  const expectedRunner = expectedSuite === "runtime:node"
    ? "node"
    : expectedSuite === "runtime:bun"
    ? "bun"
    : undefined;
  const files = Array.isArray(value?.files) ? value.files : undefined;
  const safeFiles = files?.every(isSafeRelativePlanPath) ?? false;
  const sortedFiles = safeFiles
    ? [...files].sort((left, right) => left.localeCompare(right))
    : undefined;
  if (
    !value || typeof value !== "object" || value.version !== 1 ||
    value.suite !== expectedSuite || value.runner !== expectedRunner ||
    !files || !safeFiles ||
    new Set(files).size !== files.length ||
    files.some((path, index) => path !== sortedFiles[index])
  ) {
    throw new Error(`Invalid suite plan for ${expectedSuite}`);
  }
  return value.files;
}

function isSafeRelativePlanPath(path) {
  if (
    typeof path !== "string" || path.length === 0 || path.includes("\\") ||
    path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:\//.test(path)
  ) {
    return false;
  }
  return path.split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}
