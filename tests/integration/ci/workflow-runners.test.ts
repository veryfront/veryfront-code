import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

// Use the standard GitHub-hosted pool for PR, main, and merge-queue jobs.
// The organization has no ubuntu-latest-m runner, so selecting that label
// leaves publication and merge-queue jobs without an assigned machine.
const LINUX_RUNNER = "ubuntu-latest";
const CANARY_RUNNER =
  "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ubuntu26 == true && 'ubuntu-26.04' || 'ubuntu-latest' }}";
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
  it("selects the Ubuntu26 canary only through a main dispatch", async () => {
    for (const [name, job] of Object.entries(await cicdJobs())) {
      // Reusable-workflow calls pick their runner in the called workflow.
      if ("uses" in job) continue;
      const runsOn = job["runs-on"];
      if (OTHER_RUNNERS.includes(String(runsOn))) continue;
      assertEquals(
        runsOn,
        CANARY_RUNNER,
        `${name} must use an available standard Linux runner`,
      );
    }
  });

  it("keeps default, PR, merge-queue and maintenance routing unchanged", () => {
    const selectRunner = new Function(
      "github",
      "inputs",
      `return ${CANARY_RUNNER.slice(4, -3)}`,
    );
    for (const event of ["push", "pull_request", "merge_group", "workflow_dispatch"]) {
      for (const ref of ["refs/heads/main", "refs/heads/feature", "refs/heads/maintenance/rc.1"]) {
        for (const enabled of [undefined, false, true]) {
          assertEquals(
            selectRunner({ event_name: event, ref }, { ubuntu26: enabled }),
            event === "workflow_dispatch" && ref === "refs/heads/main" && enabled === true
              ? "ubuntu-26.04"
              : LINUX_RUNNER,
          );
        }
      }
    }
  });

  it("declares an opt-in boolean canary input", async () => {
    const workflow = asRecord(
      parse(
        await Deno.readTextFile(
          new URL("../../../.github/workflows/cicd.yml", import.meta.url),
        ),
      ),
      "cicd.yml",
    );
    const triggers = asRecord(workflow.on, "triggers");
    const dispatch = asRecord(triggers.workflow_dispatch, "dispatch");
    const inputs = asRecord(dispatch.inputs, "inputs");
    const canary = asRecord(inputs.ubuntu26, "ubuntu26 input");
    assertEquals(canary.type, "boolean");
    assertEquals(canary.default, false);
  });

  it("runs main-only matrix Linux entries on the standard pool", async () => {
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
        assertEquals(os, CANARY_RUNNER, `${name} ${entry.name} runner`);
      }
    }
  });
});
