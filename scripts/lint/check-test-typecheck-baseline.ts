/**
 * Test-file typecheck ratchet.
 *
 * CI's typecheck leg only covers source entry points and test runs use
 * --no-check, so type errors in *.test.ts(x) are invisible — latent call-
 * signature rot accumulates silently (426 errors across 113 files at the
 * time this baseline was cut). This gate typechecks every test file and
 * compares failures against the committed baseline:
 *
 *  - a failing file not in the baseline fails the gate (no new rot);
 *  - a baseline file that now passes fails the gate until it is removed
 *    from the baseline (shrink-only ratchet).
 *
 * A single repository-wide `deno check` is not sufficient: Deno stops emitting
 * diagnostics after its cap, so errors in later entry points can be invisible.
 * Baseline files are checked individually, while expected-clean files run in
 * bounded batches. Failed batches are inspected for test-file diagnostics and
 * recursively split if the diagnostic cap is reached. A small worker pool keeps
 * this deterministic strategy practical in CI.
 */
const decoder = new TextDecoder();
const CLEAN_BATCH_SIZE = 32;
const MAX_PARALLEL_CHECKS = 4;
const DIAGNOSTIC_EXCERPT_LIMIT = 6_000;

function listTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of Deno.readDirSync(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(path);
    }
  };
  walk(root);
  return out;
}

const testFiles = [...listTestFiles("src"), ...listTestFiles("cli")].sort();
const baseline = new Set<string>(
  JSON.parse(
    Deno.readTextFileSync("scripts/lint/test-typecheck-baseline.json"),
  ) as string[],
);

interface CheckJob {
  kind: "baseline" | "clean";
  files: string[];
}

interface CheckResult extends CheckJob {
  success: boolean;
  output: string;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function check(job: CheckJob): Promise<CheckResult> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["check", "--no-lock", ...job.files],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);
  return {
    ...job,
    success: result.success,
    output: output.replace(/\x1b\[[0-9;]*m/g, ""),
  };
}

async function runChecks(jobs: CheckJob[]): Promise<CheckResult[]> {
  const results = new Array<CheckResult>(jobs.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(MAX_PARALLEL_CHECKS, jobs.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= jobs.length) return;
        results[index] = await check(jobs[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function failingTestFiles(output: string): Set<string> {
  const failing = new Set<string>();
  for (
    const match of output.matchAll(
      /file:\/\/[^\s:]+?\/((?:src|cli)\/[^\s:]+\.test\.tsx?)/g,
    )
  ) {
    failing.add(match[1]!);
  }
  return failing;
}

function diagnosticCount(output: string): number {
  return (output.match(/TS\d+ \[ERROR\]/g) ?? []).length;
}

function reachedDiagnosticCap(output: string): boolean {
  return diagnosticCount(output) >= 100;
}

async function resolveCleanResults(
  initial: CheckResult[],
): Promise<CheckResult[]> {
  const resolved: CheckResult[] = [];
  let current = initial;
  while (current.length > 0) {
    const nextJobs: CheckJob[] = [];
    for (const result of current) {
      if (
        !result.success &&
        failingTestFiles(result.output).size === 0 &&
        (reachedDiagnosticCap(result.output) ||
          diagnosticCount(result.output) === 0) &&
        result.files.length > 1
      ) {
        const midpoint = Math.ceil(result.files.length / 2);
        nextJobs.push(
          { kind: "clean", files: result.files.slice(0, midpoint) },
          { kind: "clean", files: result.files.slice(midpoint) },
        );
      } else {
        resolved.push(result);
      }
    }
    current = await runChecks(nextJobs);
  }
  return resolved;
}

const knownFiles = new Set(testFiles);
const baselineFiles = testFiles.filter((file) => baseline.has(file));
const cleanFiles = testFiles.filter((file) => !baseline.has(file));
const jobs: CheckJob[] = [
  ...baselineFiles.map((file): CheckJob => ({
    kind: "baseline",
    files: [file],
  })),
  ...chunk(cleanFiles, CLEAN_BATCH_SIZE).map((files): CheckJob => ({
    kind: "clean",
    files,
  })),
];
const initialResults = await runChecks(jobs);
const baselineResults = initialResults.filter((result) =>
  result.kind === "baseline"
);
const cleanResults = await resolveCleanResults(
  initialResults.filter((result) => result.kind === "clean"),
);
const newRot = new Set<string>();
const newRotResults = new Set<CheckResult>();
const inconclusiveResults = baselineResults.filter((result) => {
  if (result.success || failingTestFiles(result.output).has(result.files[0]!)) {
    return false;
  }
  return reachedDiagnosticCap(result.output) ||
    diagnosticCount(result.output) === 0;
});
for (const result of cleanResults) {
  const unexpected = [...failingTestFiles(result.output)].filter((file) =>
    !baseline.has(file)
  );
  for (const file of unexpected) newRot.add(file);
  if (unexpected.length > 0) newRotResults.add(result);
  if (
    !result.success && unexpected.length === 0 && result.files.length === 1 &&
    (reachedDiagnosticCap(result.output) ||
      diagnosticCount(result.output) === 0)
  ) {
    inconclusiveResults.push(result);
  }
}
const fixed = [
  ...[...baseline].filter((file) => !knownFiles.has(file)),
  ...baselineResults
    .filter((result) =>
      !failingTestFiles(result.output).has(result.files[0]!) &&
      !inconclusiveResults.includes(result)
    )
    .flatMap((result) => result.files),
].sort();
const failingBaselineCount =
  baselineResults.filter((result) =>
    failingTestFiles(result.output).has(result.files[0]!)
  ).length;

if (newRot.size > 0 || inconclusiveResults.length > 0) {
  if (newRot.size > 0) {
    console.error(
      `Test files with NEW type errors (not in baseline):\n  ${
        [...newRot].sort().join("\n  ")
      }`,
    );
  }
  if (inconclusiveResults.length > 0) {
    console.error(
      `Typecheck could not conclusively classify these individual files:\n  ${
        inconclusiveResults.flatMap((result) => result.files).join("\n  ")
      }`,
    );
  }
  for (
    const [index, result] of [...newRotResults, ...inconclusiveResults]
      .entries()
  ) {
    console.error(
      `\nFailure ${index + 1} entry points:\n  ${result.files.join("\n  ")}`,
    );
    console.error(
      `\nDiagnostic excerpt:\n${
        result.output.slice(0, DIAGNOSTIC_EXCERPT_LIMIT)
      }`,
    );
  }
  console.error(
    "Fix the errors, or run `deno check --no-lock <file>` on the reported files.",
  );
  Deno.exit(1);
}
if (fixed.length > 0) {
  console.error(
    `Baseline test files now typecheck cleanly — remove them from scripts/lint/test-typecheck-baseline.json to lock it in:\n  ${
      fixed.join("\n  ")
    }`,
  );
  Deno.exit(1);
}
console.log(
  `Test typecheck baseline holds: ${failingBaselineCount} grandfathered files, 0 new.`,
);
