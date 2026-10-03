import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

// Pull request jobs share the org-wide standard-runner limit. With many PRs in
// flight, main and merge-queue jobs queued ~15 minutes behind them, so main
// and merge-queue runs use the larger-runner pool, which has its own limit.
// Same jobs and checks; only the machine changes. See
// veryfront-issue-inbox#2350.
const LINUX_RUNNER =
  "${{ (github.event_name == 'push' || github.event_name == 'merge_group') && 'ubuntu-latest-m' || 'ubuntu-latest' }}";
const LARGER_LINUX_RUNNER = "ubuntu-latest-m";
const OTHER_RUNNERS = ["windows-2022", "${{ matrix.os }}"];

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function cicdJobs(): Promise<Record<string, Record<string, unknown>>> {
  const url = new URL("../../../.github/workflows/cicd.yml", import.meta.url);
  const workflow = asRecord(parse(await Deno.readTextFile(url)), "cicd.yml");
  const jobs = asRecord(workflow.jobs, "cicd.yml jobs");
  return Object.fromEntries(
    Object.entries(jobs).map(([name, job]) => [name, asRecord(job, name)]),
  );
}

describe("cicd.yml runner pools", () => {
  it("runs Linux jobs on the larger pool for main and merge queue only", async () => {
    for (const [name, job] of Object.entries(await cicdJobs())) {
      // Reusable-workflow calls pick their runner in the called workflow.
      if ("uses" in job) continue;
      const runsOn = job["runs-on"];
      if (OTHER_RUNNERS.includes(String(runsOn))) continue;
      assertEquals(
        runsOn,
        LINUX_RUNNER,
        `${name} must pick its Linux runner by event`,
      );
    }
  });

  it("runs main-only matrix Linux entries on the larger pool", async () => {
    for (const [name, job] of Object.entries(await cicdJobs())) {
      if (job["runs-on"] !== "${{ matrix.os }}") continue;
      assert(
        String(job.if).includes("github.ref == 'refs/heads/main'"),
        `${name} matrix runners assume a main-only job`,
      );
      const strategy = asRecord(job.strategy, `${name} strategy`);
      const matrix = asRecord(strategy.matrix, `${name} matrix`);
      for (const entry of matrix.include as Record<string, unknown>[]) {
        const os = String(entry.os);
        if (!os.startsWith("ubuntu")) continue;
        assertEquals(os, LARGER_LINUX_RUNNER, `${name} ${entry.name} runner`);
      }
    }
  });
});
