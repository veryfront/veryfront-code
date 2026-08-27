/**
 * Test-file typecheck ratchet.
 *
 * CI's source typecheck does not cover test entry points. This gate checks the
 * complete test surface and compares failures with the committed baseline:
 *
 *  - expected-clean tests first run as one repository-wide happy-path check;
 *  - a failed clean check is recursively split until every failing entry point
 *    is isolated, so Deno's diagnostic cap cannot hide a later failure;
 *  - baseline tests run in moderate batches and split only when a result is
 *    capped or cannot be attributed conclusively;
 *  - every child has a hard deadline and any unexplained non-zero exit fails
 *    closed instead of being mistaken for a clean result.
 */
const decoder = new TextDecoder();
const BASELINE_BATCH_SIZE = 16;
const MAX_PARALLEL_CHECKS = 4;
const CHECK_DEADLINE_MS = 180_000;
const DIAGNOSTIC_EXCERPT_LIMIT = 6_000;
const ANSI_COLOR_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "g",
);

export interface CheckJob {
  kind: "baseline" | "clean";
  files: string[];
}

export interface CheckResult extends CheckJob {
  success: boolean;
  output: string;
  timedOut?: boolean;
}

export type CheckRunner = (job: CheckJob) => Promise<CheckResult>;

export interface RatchetOutcome {
  failingBaselineCount: number;
  fixed: string[];
  inconclusiveBaselineResults: CheckResult[];
  newRot: string[];
  newRotResults: CheckResult[];
  unattributedCleanResults: CheckResult[];
}

interface CommandOptions {
  executable?: string;
  prefixArgs?: string[];
  timeoutMs?: number;
}

/** Sort strings by UTF-16 code unit so baseline ordering stays byte-stable. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

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

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function splitJob(job: CheckJob): [CheckJob, CheckJob] {
  const midpoint = Math.ceil(job.files.length / 2);
  return [
    { kind: job.kind, files: job.files.slice(0, midpoint) },
    { kind: job.kind, files: job.files.slice(midpoint) },
  ];
}

function stripAnsi(output: string): string {
  return output.replace(ANSI_COLOR_SEQUENCE, "");
}

/** Execute one Deno check and kill it if its individual deadline expires. */
export async function runDenoCheck(
  job: CheckJob,
  options: CommandOptions = {},
): Promise<CheckResult> {
  const timeoutMs = options.timeoutMs ?? CHECK_DEADLINE_MS;
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(options.executable ?? Deno.execPath(), {
      args: [...(options.prefixArgs ?? []), "check", "--no-lock", ...job.files],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (error) {
    return {
      ...job,
      success: false,
      output: `Failed to start typecheck: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const outputPromise = child.output();
  let timer: number | undefined;
  const result = await Promise.race([
    outputPromise.then((output) => ({ kind: "output" as const, output })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    }),
  ]);

  if (result.kind === "output") {
    clearTimeout(timer);
    return {
      ...job,
      success: result.output.success,
      output: stripAnsi(
        decoder.decode(result.output.stdout) +
          decoder.decode(result.output.stderr),
      ),
    };
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // The process may have exited in the same turn as the deadline. The elapsed
    // deadline still makes this result non-conclusive and therefore a failure.
  }
  const killed = await outputPromise;
  return {
    ...job,
    success: false,
    timedOut: true,
    output: stripAnsi(
      decoder.decode(killed.stdout) + decoder.decode(killed.stderr) +
        `\nTypecheck exceeded its ${timeoutMs}ms deadline and was killed.`,
    ),
  };
}

async function runChecks(
  jobs: CheckJob[],
  runner: CheckRunner,
): Promise<CheckResult[]> {
  const results = new Array<CheckResult>(jobs.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(MAX_PARALLEL_CHECKS, jobs.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= jobs.length) return;
        results[index] = await runner(jobs[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function diagnosticCount(output: string): number {
  return (output.match(/TS\d+ \[ERROR\]/g) ?? []).length;
}

function reachedDiagnosticCap(output: string): boolean {
  return diagnosticCount(output) >= 100;
}

function primaryDiagnosticTestFiles(output: string): Array<string | undefined> {
  const files: Array<string | undefined> = [];
  for (
    const match of output.matchAll(
      /TS\d+ \[ERROR\]:[\s\S]*?^\s*at (file:\/\/.+?):\d+:\d+\s*$/gm,
    )
  ) {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(match[1]!).pathname).replaceAll(
        "\\",
        "/",
      );
    } catch {
      files.push(undefined);
      continue;
    }
    files.push(pathname.match(/(?:^|\/)((?:src|cli)\/.*\.test\.tsx?)$/)?.[1]);
  }
  return files;
}

function attributedFailureFiles(result: CheckResult): Set<string> | undefined {
  if (result.success) return new Set();
  const count = diagnosticCount(result.output);
  if (result.timedOut || count === 0) return undefined;
  if (result.files.length === 1) return new Set(result.files);
  const locations = primaryDiagnosticTestFiles(result.output);
  if (
    reachedDiagnosticCap(result.output) ||
    locations.length !== count ||
    locations.some((file) => file === undefined || !result.files.includes(file))
  ) {
    return undefined;
  }
  return new Set(locations as string[]);
}

async function resolveCleanResults(
  initial: CheckResult[],
  runner: CheckRunner,
): Promise<{
  failures: CheckResult[];
  unattributed: CheckResult[];
}> {
  const failures: CheckResult[] = [];
  const unattributed: CheckResult[] = [];
  let current = initial;
  while (current.length > 0) {
    const nextJobs: CheckJob[] = [];
    for (const result of current) {
      if (result.success) continue;
      if (result.files.length > 1) {
        nextJobs.push(...splitJob(result));
        continue;
      }
      failures.push(result);
      if (attributedFailureFiles(result) === undefined) {
        unattributed.push(result);
      }
    }
    current = await runChecks(nextJobs, runner);
  }
  return { failures, unattributed };
}

async function resolveBaselineResults(
  initial: CheckResult[],
  runner: CheckRunner,
): Promise<{
  failing: Set<string>;
  fixed: Set<string>;
  inconclusive: CheckResult[];
}> {
  const failing = new Set<string>();
  const fixed = new Set<string>();
  const inconclusive: CheckResult[] = [];
  let current = initial;
  while (current.length > 0) {
    const nextJobs: CheckJob[] = [];
    for (const result of current) {
      if (result.success) {
        for (const file of result.files) fixed.add(file);
        continue;
      }
      const attributed = attributedFailureFiles(result);
      if (attributed !== undefined) {
        for (const file of attributed) failing.add(file);
        const remaining = result.files.filter((file) => !attributed.has(file));
        if (remaining.length > 0) {
          nextJobs.push({ kind: "baseline", files: remaining });
        }
        continue;
      }
      if (result.files.length === 1) {
        inconclusive.push(result);
      } else {
        nextJobs.push(...splitJob(result));
      }
    }
    current = await runChecks(nextJobs, runner);
  }
  return { failing, fixed, inconclusive };
}

/** Evaluate a file set with an injectable runner for deterministic regressions. */
export async function evaluateRatchet(
  testFiles: string[],
  baseline: Set<string>,
  runner: CheckRunner,
): Promise<RatchetOutcome> {
  const knownFiles = new Set(testFiles);
  const baselineFiles = testFiles.filter((file) => baseline.has(file));
  const cleanFiles = testFiles.filter((file) => !baseline.has(file));

  const cleanInitial = cleanFiles.length === 0
    ? []
    : await runChecks([{ kind: "clean", files: cleanFiles }], runner);
  const clean = await resolveCleanResults(cleanInitial, runner);

  const baselineInitial = await runChecks(
    chunk(baselineFiles, BASELINE_BATCH_SIZE).map((files) => ({
      kind: "baseline" as const,
      files,
    })),
    runner,
  );
  const baselineResolution = await resolveBaselineResults(
    baselineInitial,
    runner,
  );
  const fixed = new Set([
    ...[...baseline].filter((file) => !knownFiles.has(file)),
    ...baselineResolution.fixed,
  ]);

  return {
    failingBaselineCount: baselineResolution.failing.size,
    fixed: [...fixed].sort(compareOrdinal),
    inconclusiveBaselineResults: baselineResolution.inconclusive,
    newRot: clean.failures.flatMap((result) => result.files).sort(compareOrdinal),
    newRotResults: clean.failures,
    unattributedCleanResults: clean.unattributed,
  };
}

function printFailureResults(results: CheckResult[]): void {
  for (const [index, result] of results.entries()) {
    console.error(
      `\nFailure ${index + 1} entry points:\n  ${result.files.join("\n  ")}`,
    );
    console.error(
      `\nDiagnostic excerpt:\n${
        result.output.slice(0, DIAGNOSTIC_EXCERPT_LIMIT)
      }`,
    );
  }
}

async function main(): Promise<void> {
  const testFiles = [...listTestFiles("src"), ...listTestFiles("cli"), ...listTestFiles("templates")].sort(compareOrdinal);
  const baseline = new Set<string>(
    JSON.parse(
      Deno.readTextFileSync("scripts/lint/test-typecheck-baseline.json"),
    ) as string[],
  );
  const outcome = await evaluateRatchet(testFiles, baseline, runDenoCheck);

  if (
    outcome.newRot.length > 0 || outcome.inconclusiveBaselineResults.length > 0
  ) {
    if (outcome.newRot.length > 0) {
      console.error(
        `Test entry points with NEW typecheck failures (not in baseline):\n  ${
          outcome.newRot.join("\n  ")
        }`,
      );
    }
    if (outcome.unattributedCleanResults.length > 0) {
      console.error(
        "Some clean entry points exited non-zero without attributable diagnostics; " +
          "the ratchet failed closed.",
      );
    }
    if (outcome.inconclusiveBaselineResults.length > 0) {
      console.error(
        `Typecheck could not conclusively classify these baseline files:\n  ${
          outcome.inconclusiveBaselineResults.flatMap((result) => result.files)
            .join("\n  ")
        }`,
      );
    }
    printFailureResults([
      ...outcome.newRotResults,
      ...outcome.inconclusiveBaselineResults,
    ]);
    console.error(
      "Fix the errors, or run `deno check --no-lock <file>` on the reported files.",
    );
    Deno.exit(1);
  }
  if (outcome.fixed.length > 0) {
    console.error(
      `Baseline test files now typecheck cleanly — remove them from scripts/lint/test-typecheck-baseline.json to lock it in:\n  ${
        outcome.fixed.join("\n  ")
      }`,
    );
    Deno.exit(1);
  }
  console.log(
    `Test typecheck baseline holds: ${outcome.failingBaselineCount} grandfathered files, 0 new.`,
  );
}

if (import.meta.main) await main();
