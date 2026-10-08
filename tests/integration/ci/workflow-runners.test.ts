import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

// Use the standard GitHub-hosted pool for PR, main, and merge-queue jobs.
// The organization has no ubuntu-latest-m runner, so selecting that label
// leaves publication and merge-queue jobs without an assigned machine.
const LINUX_RUNNER = "ubuntu-latest";
const CANARY_RUNNER =
  "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ubuntu26 == true && 'ubuntu-26.04' || 'ubuntu-latest' }}";
const TRUSTED_RUNNER =
  "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ubuntu26 == true && 'ubuntu-26.04' || (github.repository == 'veryfront/veryfront-code' && (github.event_name == 'merge_group' || (github.event_name == 'push' && github.ref == 'refs/heads/main')) && vars.CI_RUNNER_TRUSTED == 'veryfront-ci') && 'veryfront-ci' || 'ubuntu-latest' }}";
const OTHER_RUNNERS = ["windows-2022", "${{ matrix.os }}"];
const REPOSITORY = "veryfront/veryfront-code";

// Test and gate jobs that may use the self-hosted pool for merge-queue runs
// and pushes to main. Release, publish, and secret-holding jobs, and the job
// that builds the published npm artifact, stay on GitHub-hosted runners.
const TRUSTED_RUNNER_JOBS = [
  "ci",
  "coverage",
  "coverage-integration-client",
  "coverage-node-executor",
  "coverage-shards",
  "npm-smoke-node-versions",
  "quality-gate-artifact",
  "quality-gate-merge",
  "sonar-coverage",
  "sonar-coverage-main",
  "sonar-quality-gate",
  "tests",
  "tests-binary-e2e",
  "tests-bun",
  "tests-e2e-rsc-browser",
  "tests-integration",
  "tests-node",
  "tests-node-sandbox",
  "tests-npm-install-smoke",
  "tests-runtime-critical-flow",
  "tests-sentry-runtime-packages",
  "tests-split-mode",
];

function expressionBody(expression: string): string {
  return expression.slice(4, -3);
}

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
        TRUSTED_RUNNER_JOBS.includes(name) ? TRUSTED_RUNNER : CANARY_RUNNER,
        `${name} must use an available standard Linux runner`,
      );
    }
  });

  it("keeps default, PR, merge-queue and maintenance routing unchanged", () => {
    const selectRunner = new Function(
      "github",
      "inputs",
      `return ${expressionBody(CANARY_RUNNER)}`,
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

  it("routes only listed jobs through the trusted runner switch", async () => {
    const jobs = await cicdJobs();
    const routed = Object.entries(jobs)
      .filter(([, job]) => job["runs-on"] === TRUSTED_RUNNER)
      .map(([name]) => name)
      .sort();
    assertEquals(routed, [...TRUSTED_RUNNER_JOBS].sort());
    for (const name of TRUSTED_RUNNER_JOBS) {
      const job = jobs[name];
      assert(job, `${name} must exist`);
      const text = JSON.stringify(job);
      assert(!text.includes("secrets."), `${name} must not read secrets`);
      assert(!("environment" in job), `${name} must not use a deployment environment`);
      const permissions = job.permissions as Record<string, unknown> | undefined;
      for (const [scope, level] of Object.entries(permissions ?? {})) {
        assertEquals(level, "read", `${name} ${scope} permission must stay read-only`);
      }
    }
  });

  it("uses the self-hosted pool only for merge-queue and main push runs", () => {
    const selectRunner = new Function(
      "github",
      "inputs",
      "vars",
      `return ${expressionBody(TRUSTED_RUNNER)}`,
    );
    const events = [
      "push",
      "pull_request",
      "pull_request_target",
      "merge_group",
      "workflow_dispatch",
      "schedule",
    ];
    const refs = [
      "refs/heads/main",
      "refs/heads/feature",
      "refs/heads/maintenance/rc.1",
      "refs/heads/gh-readonly-queue/main/pr-1",
    ];
    for (const repository of [REPOSITORY, "someone/veryfront-code"]) {
      for (const event of events) {
        for (const ref of refs) {
          for (const flag of [undefined, "", "ubuntu-latest", "veryfront-ci"]) {
            for (const enabled of [undefined, false, true]) {
              const canary = event === "workflow_dispatch" && ref === "refs/heads/main" &&
                enabled === true;
              const trusted = repository === REPOSITORY && flag === "veryfront-ci" &&
                (event === "merge_group" || (event === "push" && ref === "refs/heads/main"));
              assertEquals(
                selectRunner(
                  { event_name: event, ref, repository },
                  { ubuntu26: enabled },
                  { CI_RUNNER_TRUSTED: flag },
                ),
                canary ? "ubuntu-26.04" : trusted ? "veryfront-ci" : LINUX_RUNNER,
                `${repository} ${event} ${ref} flag=${flag} ubuntu26=${enabled}`,
              );
            }
          }
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
