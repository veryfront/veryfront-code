import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

// Use the standard GitHub-hosted pool for PR, main, and merge-queue jobs.
// The organization has no ubuntu-latest-m runner, so selecting that label
// leaves publication and merge-queue jobs without an assigned machine.
const LINUX_RUNNER = "ubuntu-latest";
const PUBLIC_POOL = "veryfront-public";
const CANARY_RUNNER =
  "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ubuntu26 == true && 'ubuntu-26.04' || 'ubuntu-latest' }}";
// Trusted events only: a push to main, a merge group, or a same-repository
// pull request not authored by Dependabot. The repository variable is the
// switch; while it is unset every job stays on the hosted runner.
const PUBLIC_POOL_RUNNER =
  "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ubuntu26 == true && 'ubuntu-26.04' || vars.CI_RUNNER_PUBLIC == 'veryfront-public' && (github.event_name == 'merge_group' || (github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]' && github.actor != 'dependabot[bot]')) && 'veryfront-public' || 'ubuntu-latest' }}";
// Jobs that hold no secrets and no write token and need no root or Docker.
const PUBLIC_POOL_JOBS = [
  "ci",
  "coverage",
  "coverage-integration-client",
  "coverage-node-executor",
  "coverage-shards",
  "tests-bun",
  "tests-node",
  "tests-node-sandbox",
  "tests-npm-install-smoke",
  "tests-runtime-critical-flow",
  "tests-sentry-runtime-packages",
];
const OTHER_RUNNERS = ["windows-2022", "${{ matrix.os }}"];
const REPOSITORY = "veryfront/veryfront-code";
const WORKFLOWS_DIR = new URL("../../../.github/workflows/", import.meta.url);
// Steps that need root, Docker, or browser system packages cannot run on the
// unprivileged pool.
const PRIVILEGED_STEP =
  /\bsudo\b|\bapt(?:-get)?\b|\bdocker\b|--with-deps|install-chromium|\bpython3?\b/;

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function cicdWorkflow(): Promise<Record<string, unknown>> {
  return asRecord(
    parse(await Deno.readTextFile(new URL("cicd.yml", WORKFLOWS_DIR))),
    "cicd.yml",
  );
}

async function cicdJobs(): Promise<Record<string, Record<string, unknown>>> {
  const jobs = asRecord((await cicdWorkflow()).jobs, "cicd.yml jobs");
  return Object.fromEntries(
    Object.entries(jobs).map(([name, job]) => [name, asRecord(job, name)]),
  );
}

function compileRunner(expression: string) {
  return new Function(
    "github",
    "inputs",
    "vars",
    `return ${expression.slice(4, -3)}`,
  ) as (
    github: Record<string, unknown>,
    inputs: Record<string, unknown>,
    vars: Record<string, unknown>,
  ) => string;
}

function pullRequest(
  headRepository: string,
  author: string,
  actor = author,
): Record<string, unknown> {
  return {
    event_name: "pull_request",
    ref: "refs/pull/1/merge",
    repository: REPOSITORY,
    actor,
    event: {
      pull_request: { head: { repo: { full_name: headRepository } }, user: { login: author } },
    },
  };
}

function event(eventName: string, ref = "refs/heads/main"): Record<string, unknown> {
  return { event_name: eventName, ref, repository: REPOSITORY, actor: "octocat", event: {} };
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
        PUBLIC_POOL_JOBS.includes(name) ? PUBLIC_POOL_RUNNER : CANARY_RUNNER,
        `${name} must use an available standard Linux runner`,
      );
    }
  });

  it("routes exactly the allowlisted jobs to the public pool", async () => {
    const routed = Object.entries(await cicdJobs())
      .filter(([, job]) => String(job["runs-on"]).includes(PUBLIC_POOL))
      .map(([name]) => name)
      .sort();
    assertEquals(routed, PUBLIC_POOL_JOBS);
  });

  it("keeps default, PR, merge-queue and maintenance routing unchanged", () => {
    for (const expression of [CANARY_RUNNER, PUBLIC_POOL_RUNNER]) {
      const selectRunner = compileRunner(expression);
      for (const name of ["push", "pull_request", "merge_group", "workflow_dispatch"]) {
        for (
          const ref of ["refs/heads/main", "refs/heads/feature", "refs/heads/maintenance/rc.1"]
        ) {
          for (const enabled of [undefined, false, true]) {
            const github = name === "pull_request"
              ? { ...pullRequest(REPOSITORY, "octocat"), ref }
              : event(name, ref);
            assertEquals(
              selectRunner(github, { ubuntu26: enabled }, {}),
              name === "workflow_dispatch" && ref === "refs/heads/main" && enabled === true
                ? "ubuntu-26.04"
                : LINUX_RUNNER,
            );
          }
        }
      }
    }
  });

  it("selects the public pool only for trusted events with the switch on", () => {
    const selectRunner = compileRunner(PUBLIC_POOL_RUNNER);
    const on = { CI_RUNNER_PUBLIC: PUBLIC_POOL };
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
      ["push to main", event("push"), on, PUBLIC_POOL],
      [
        "merge group",
        event("merge_group", "refs/heads/gh-readonly-queue/main/pr-1"),
        on,
        PUBLIC_POOL,
      ],
      ["same-repository pull request", pullRequest(REPOSITORY, "octocat"), on, PUBLIC_POOL],
      ["unset switch, push", event("push"), {}, LINUX_RUNNER],
      ["unset switch, merge group", event("merge_group"), {}, LINUX_RUNNER],
      ["unset switch, pull request", pullRequest(REPOSITORY, "octocat"), {}, LINUX_RUNNER],
      ["other switch value", event("push"), { CI_RUNNER_PUBLIC: "true" }, LINUX_RUNNER],
      ["push to another branch", event("push", "refs/heads/feature"), on, LINUX_RUNNER],
      ["fork pull request", pullRequest("someone/veryfront-code", "someone"), on, LINUX_RUNNER],
      ["Dependabot pull request", pullRequest(REPOSITORY, "dependabot[bot]"), on, LINUX_RUNNER],
      [
        "Dependabot-triggered pull request run",
        pullRequest(REPOSITORY, "octocat", "dependabot[bot]"),
        on,
        LINUX_RUNNER,
      ],
      ["manual dispatch", event("workflow_dispatch"), on, LINUX_RUNNER],
      ["pull_request_target", event("pull_request_target"), on, LINUX_RUNNER],
      ["workflow_run", event("workflow_run"), on, LINUX_RUNNER],
      ["issue_comment", event("issue_comment"), on, LINUX_RUNNER],
      ["schedule", event("schedule"), on, LINUX_RUNNER],
    ];
    for (const [label, github, vars, expected] of cases) {
      assertEquals(selectRunner(github, {}, vars), expected, label);
    }
  });

  it("keeps secret, write, and privileged jobs off the public pool", async () => {
    const workflow = await cicdWorkflow();
    const workflowPermissions = asRecord(workflow.permissions, "cicd.yml permissions");
    const jobs = await cicdJobs();
    for (const name of PUBLIC_POOL_JOBS) {
      const job = jobs[name]!;
      const text = JSON.stringify(job);
      assertEquals("environment" in job, false, `${name} must not use a deployment environment`);
      assertEquals("services" in job, false, `${name} must not use service containers`);
      assertEquals("container" in job, false, `${name} must not use a job container`);
      for (const secret of text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
        assertEquals(secret[1], "GITHUB_TOKEN", `${name} must not read ${secret[0]}`);
      }
      const permissions = asRecord(
        job.permissions ?? workflowPermissions,
        `${name} permissions`,
      );
      for (const [scope, level] of Object.entries(permissions)) {
        assert(level === "read" || level === "none", `${name} must not hold ${scope}: ${level}`);
      }
      assertEquals(PRIVILEGED_STEP.test(text), false, `${name} must not need root or Docker`);

      for (const action of text.matchAll(/"uses":"\.\/(\.github\/actions\/[A-Za-z0-9_-]+)"/g)) {
        const composite = await Deno.readTextFile(
          new URL(`../../../${action[1]}/action.yml`, import.meta.url),
        );
        assertEquals(
          PRIVILEGED_STEP.test(composite) || /secrets\./.test(composite),
          false,
          `${name} uses ${action[1]}, which needs root, Docker, or secrets`,
        );
      }
    }
  });

  it("routes no other workflow to the public pool", async () => {
    const triggers = asRecord((await cicdWorkflow()).on, "cicd.yml triggers");
    for (const trigger of ["pull_request_target", "workflow_run", "issue_comment"]) {
      assertEquals(trigger in triggers, false, `cicd.yml must not run on ${trigger}`);
    }
    for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
      if (!entry.isFile || entry.name === "cicd.yml") continue;
      const text = await Deno.readTextFile(new URL(entry.name, WORKFLOWS_DIR));
      assertEquals(text.includes(PUBLIC_POOL), false, `${entry.name} must stay hosted`);
    }
  });

  it("declares an opt-in boolean canary input", async () => {
    const triggers = asRecord((await cicdWorkflow()).on, "triggers");
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
