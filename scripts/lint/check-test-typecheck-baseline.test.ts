import { assert, assertEquals } from "#std/assert";
import {
  type CheckJob,
  type CheckResult,
  evaluateRatchet,
  runDenoCheck,
} from "./check-test-typecheck-baseline.ts";

function success(job: CheckJob): CheckResult {
  return { ...job, success: true, output: "" };
}

function failure(job: CheckJob, output: string): CheckResult {
  return { ...job, success: false, output };
}

function diagnostic(file: string, count = 1): string {
  return Array.from(
    { length: count },
    () => `TS2345 [ERROR]: synthetic\n    at file:///repo/${file}:1:1`,
  ).join("\n\n");
}

Deno.test("test typecheck ratchet checks the clean happy path in one large job", async () => {
  const files = Array.from(
    { length: 80 },
    (_, index) => `src/clean-${index}.test.ts`,
  );
  const calls: CheckJob[] = [];
  const outcome = await evaluateRatchet(files, new Set(), (job) => {
    calls.push(job);
    return Promise.resolve(success(job));
  });

  assertEquals(calls, [{ kind: "clean", files }]);
  assertEquals(outcome.newRot, []);
  assertEquals(outcome.fixed, []);
});

Deno.test("test typecheck ratchet recursively isolates a clean failure", async () => {
  const files = Array.from(
    { length: 33 },
    (_, index) => `src/clean-${index}.test.ts`,
  );
  const bad = files[21]!;
  const calls: CheckJob[] = [];
  const outcome = await evaluateRatchet(files, new Set(), (job) => {
    calls.push(job);
    return Promise.resolve(
      job.files.includes(bad) ? failure(job, diagnostic(bad)) : success(job),
    );
  });

  assertEquals(outcome.newRot, [bad]);
  assertEquals(outcome.unattributedCleanResults, []);
  assertEquals(calls[0], { kind: "clean", files });
  assert(calls.some((job) => job.files.length === 1 && job.files[0] === bad));
});

Deno.test("test typecheck ratchet batches baseline files and splits capped diagnostics", async () => {
  const files = Array.from(
    { length: 17 },
    (_, index) => `src/baseline-${index}.test.ts`,
  );
  const baseline = new Set(files);
  const bad = files[6]!;
  const calls: CheckJob[] = [];
  const outcome = await evaluateRatchet(files, baseline, (job) => {
    calls.push(job);
    if (!job.files.includes(bad)) return Promise.resolve(success(job));
    return Promise.resolve(
      failure(job, diagnostic(bad, job.files.length === 1 ? 1 : 100)),
    );
  });

  assertEquals(calls.slice(0, 2).map((job) => job.files.length), [16, 1]);
  assert(calls.some((job) => job.files.length === 1 && job.files[0] === bad));
  assertEquals(outcome.failingBaselineCount, 1);
  assertEquals(outcome.fixed, files.filter((file) => file !== bad).sort());
  assertEquals(outcome.inconclusiveBaselineResults, []);
});

Deno.test("test typecheck ratchet fails closed on an unattributed clean exit", async () => {
  const file = "src/unattributed.test.ts";
  const outcome = await evaluateRatchet(
    [file],
    new Set(),
    (job) => Promise.resolve(failure(job, "error: synthetic command failure")),
  );

  assertEquals(outcome.newRot, [file]);
  assertEquals(outcome.unattributedCleanResults.length, 1);
});

Deno.test("test typecheck ratchet keeps an unattributed baseline exit inconclusive", async () => {
  const file = "src/inconclusive.test.ts";
  const outcome = await evaluateRatchet(
    [file],
    new Set([file]),
    (job) => Promise.resolve(failure(job, "error: synthetic command failure")),
  );

  assertEquals(outcome.failingBaselineCount, 0);
  assertEquals(outcome.fixed, []);
  assertEquals(outcome.inconclusiveBaselineResults.length, 1);
});

Deno.test("test typecheck ratchet attributes a singleton dependency diagnostic to its entry point", async () => {
  const file = "src/dependency-failure.test.ts";
  const output = diagnostic("src/dependency.ts");
  const baselineOutcome = await evaluateRatchet(
    [file],
    new Set([file]),
    (job) => Promise.resolve(failure(job, output)),
  );
  const cleanOutcome = await evaluateRatchet(
    [file],
    new Set(),
    (job) => Promise.resolve(failure(job, output)),
  );

  assertEquals(baselineOutcome.failingBaselineCount, 1);
  assertEquals(baselineOutcome.inconclusiveBaselineResults, []);
  assertEquals(cleanOutcome.newRot, [file]);
  assertEquals(cleanOutcome.unattributedCleanResults, []);
});

Deno.test("test typecheck ratchet rechecks baseline entries hidden by another diagnostic", async () => {
  const first = "src/first.test.ts";
  const hidden = "src/hidden.test.ts";
  const outcome = await evaluateRatchet(
    [first, hidden],
    new Set([first, hidden]),
    (job) => {
      if (job.files.includes(first)) {
        return Promise.resolve(failure(job, diagnostic(first)));
      }
      return Promise.resolve(
        failure(job, diagnostic("src/shared-dependency.ts")),
      );
    },
  );

  assertEquals(outcome.failingBaselineCount, 2);
  assertEquals(outcome.fixed, []);
  assertEquals(outcome.inconclusiveBaselineResults, []);
});

Deno.test("runDenoCheck kills a child that exceeds its deadline", async () => {
  const startedAt = performance.now();
  const result = await runDenoCheck(
    { kind: "clean", files: ["ignored.test.ts"] },
    {
      prefixArgs: [
        "eval",
        "await new Promise((resolve) => setTimeout(resolve, 60_000))",
      ],
      timeoutMs: 25,
    },
  );

  assertEquals(result.success, false);
  assertEquals(result.timedOut, true);
  assert(result.output.includes("deadline and was killed"));
  assert(performance.now() - startedAt < 2_000);
});
