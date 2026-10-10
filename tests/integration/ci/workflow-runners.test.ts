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

// The self-hosted pool is selected only inside this reusable workflow, which
// callers must pin to main. The runner choice therefore always comes from
// main's YAML, never from the pull request or merge-group revision under test.
const POOL_WORKFLOW = "ci-public-pool.yml";
const POOL_WORKFLOW_REF = `veryfront/veryfront-code/.github/workflows/${POOL_WORKFLOW}@main`;
const PUBLIC_POOL = "veryfront-public";
const REPOSITORY = "veryfront/veryfront-code";
const PUBLIC_POOL_RUNNER =
  "${{ inputs.ubuntu26 && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && 'ubuntu-26.04' || vars.CI_RUNNER_PUBLIC == 'veryfront-public' && github.repository == 'veryfront/veryfront-code' && (github.event_name == 'merge_group' || (github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]' && github.actor != 'dependabot[bot]')) && 'veryfront-public' || 'ubuntu-latest' }}";
const PUBLIC_POOL_JOBS = [
  "ci",
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
const FORK_GUARD =
  "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)";
const WORKFLOWS_DIR = new URL("../../../.github/workflows/", import.meta.url);
// Steps that need root, Docker, or browser system packages cannot run on the
// unprivileged pool.
const PRIVILEGED_STEP =
  /\bsudo\b|\bapt(?:-get)?\b|\bdocker\b|--with-deps|install-chromium|\bpython3?\b/;

async function poolWorkflow(): Promise<Record<string, unknown>> {
  return asRecord(
    parse(await Deno.readTextFile(new URL(POOL_WORKFLOW, WORKFLOWS_DIR))),
    POOL_WORKFLOW,
  );
}

async function poolJobs(): Promise<Record<string, Record<string, unknown>>> {
  const jobs = asRecord((await poolWorkflow()).jobs, `${POOL_WORKFLOW} jobs`);
  return Object.fromEntries(
    Object.entries(jobs).map(([name, job]) => [name, asRecord(job, name)]),
  );
}

function compilePoolRunner(): (
  github: Record<string, unknown>,
  inputs: Record<string, unknown>,
  vars: Record<string, unknown>,
) => string {
  return new Function(
    "github",
    "inputs",
    "vars",
    `return ${PUBLIC_POOL_RUNNER.slice(4, -3)}`,
  ) as never;
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

function event(
  eventName: string,
  ref = "refs/heads/main",
  repository = REPOSITORY,
): Record<string, unknown> {
  return { event_name: eventName, ref, repository, actor: "octocat", event: {} };
}

describe("public runner pool workflow", () => {
  it("is reusable only, with a read-only token", async () => {
    const workflow = await poolWorkflow();
    assertEquals(Object.keys(asRecord(workflow.on, "triggers")), ["workflow_call"]);
    assertEquals(workflow.permissions, { contents: "read" });
  });

  it("selects the runner inside the pinned workflow for every job", async () => {
    const jobs = await poolJobs();
    assertEquals(Object.keys(jobs).sort(), [...PUBLIC_POOL_JOBS, "unknown-job"].sort());
    for (const name of PUBLIC_POOL_JOBS) {
      const job = jobs[name]!;
      assertEquals(job["runs-on"], PUBLIC_POOL_RUNNER, `${name} runner`);
      assertEquals(
        job.if,
        `\${{ inputs.job == '${name}' && ${FORK_GUARD} }}`,
        `${name} must run only when named and never for fork pull requests`,
      );
    }
    const unknown = jobs["unknown-job"]!;
    assertEquals(unknown["runs-on"], "ubuntu-latest");
    const listed = String(unknown.if).match(/fromJSON\('(\[.*\])'\), inputs\.job\) \}\}$/);
    assert(listed, "an unknown job name must fail instead of skipping every job");
    assertEquals(JSON.parse(listed[1]).sort(), PUBLIC_POOL_JOBS);
  });

  it("resolves to the hosted runner while the switch is unset", () => {
    const selectRunner = compilePoolRunner();
    const events = [
      event("push"),
      event("merge_group", "refs/heads/gh-readonly-queue/main/pr-1"),
      pullRequest(REPOSITORY, "octocat"),
      pullRequest("someone/veryfront-code", "someone"),
      event("workflow_dispatch"),
      event("schedule"),
    ];
    for (const vars of [{}, { CI_RUNNER_PUBLIC: "" }, { CI_RUNNER_PUBLIC: "true" }]) {
      for (const github of events) {
        assertEquals(selectRunner(github, { ubuntu26: false }, vars), "ubuntu-latest");
      }
    }
  });

  it("selects the public pool only for trusted events with the switch on", () => {
    const selectRunner = compilePoolRunner();
    const on = { CI_RUNNER_PUBLIC: PUBLIC_POOL };
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["push to main", event("push"), PUBLIC_POOL],
      ["merge group", event("merge_group", "refs/heads/gh-readonly-queue/main/pr-1"), PUBLIC_POOL],
      ["same-repository pull request", pullRequest(REPOSITORY, "octocat"), PUBLIC_POOL],
      ["push to another branch", event("push", "refs/heads/feature"), "ubuntu-latest"],
      [
        "another repository",
        event("push", "refs/heads/main", "someone/veryfront-code"),
        "ubuntu-latest",
      ],
      ["fork pull request", pullRequest("someone/veryfront-code", "someone"), "ubuntu-latest"],
      ["Dependabot pull request", pullRequest(REPOSITORY, "dependabot[bot]"), "ubuntu-latest"],
      [
        "Dependabot-triggered pull request run",
        pullRequest(REPOSITORY, "octocat", "dependabot[bot]"),
        "ubuntu-latest",
      ],
      ["manual dispatch", event("workflow_dispatch"), "ubuntu-latest"],
      ["pull_request_target", event("pull_request_target"), "ubuntu-latest"],
      ["workflow_run", event("workflow_run"), "ubuntu-latest"],
      ["issue_comment", event("issue_comment"), "ubuntu-latest"],
      ["schedule", event("schedule"), "ubuntu-latest"],
    ];
    for (const [label, github, expected] of cases) {
      assertEquals(selectRunner(github, { ubuntu26: false }, on), expected, label);
    }
    // A caller input can only opt into the hosted canary, never into the pool.
    assertEquals(
      selectRunner(event("workflow_dispatch"), { ubuntu26: true }, on),
      "ubuntu-26.04",
    );
    assertEquals(selectRunner(event("push"), { ubuntu26: true }, on), PUBLIC_POOL);
  });

  it("keeps secrets, write tokens and privileged steps out of pool jobs", async () => {
    const jobs = await poolJobs();
    for (const name of PUBLIC_POOL_JOBS) {
      const job = jobs[name]!;
      const text = JSON.stringify(job);
      assertEquals("environment" in job, false, `${name} must not use a deployment environment`);
      assertEquals("services" in job, false, `${name} must not use service containers`);
      assertEquals("container" in job, false, `${name} must not use a job container`);
      assertEquals("permissions" in job, false, `${name} must keep the read-only token`);
      assertEquals(/secrets\./.test(text), false, `${name} must not read secrets`);
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

  it("never names the pool in caller YAML and calls the workflow only from main", async () => {
    for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
      if (!entry.isFile || entry.name === POOL_WORKFLOW) continue;
      const text = await Deno.readTextFile(new URL(entry.name, WORKFLOWS_DIR));
      assertEquals(text.includes(PUBLIC_POOL), false, `${entry.name} must not name the pool`);
      for (const line of text.split("\n")) {
        if (!line.includes(POOL_WORKFLOW)) continue;
        assertEquals(
          line.trim(),
          `uses: ${POOL_WORKFLOW_REF}`,
          `${entry.name} must call the pool workflow pinned to main`,
        );
      }
    }
  });
});

// Required status contexts on main, copied from the repository ruleset
// (`gh api repos/veryfront/veryfront-code/rules/branches/main`) and classic
// branch protection (`gh api repos/veryfront/veryfront-code/branches/main/protection/required_status_checks`).
// Update these lists whenever either changes.
const RULESET_REQUIRED_CONTEXTS = [
  "Automated review",
  "SonarQube Cloud quality gate",
  "ci (format)",
  "ci (lint)",
  "ci (typecheck)",
  "quality gate (merge)",
  "tests (binary e2e)",
  "tests (integration)",
];
const BRANCH_PROTECTION_REQUIRED_CONTEXTS = [
  "Analyze",
  "ci (format)",
  "ci (lint)",
  "ci (typecheck)",
  "coverage gate",
  "tests (binary e2e)",
  "tests (integration)",
  "tests (rsc browser e2e)",
];
// Contexts posted as commit statuses rather than by a job.
const REQUIRED_STATUS_CONTEXTS = ["Automated review"];
// Every context that must keep its exact name. A job called through a reusable
// workflow reports as `<caller> / <called job>`, so each job behind one of
// these must stay a plain job in its workflow.
const REQUIRED_JOB_CONTEXTS = [
  "Analyze",
  "SonarQube Cloud quality gate",
  "ci (format)",
  "ci (lint)",
  "ci (typecheck)",
  "coverage gate",
  "quality gate (artifact)",
  "quality gate (merge)",
  "quality gate (registry)",
  "tests (binary e2e)",
  "tests (integration)",
  "tests (rsc browser e2e)",
];
// Jobs that cicd.yml runs through the pool workflow. None is a required check.
const POOL_CALLER_JOBS = [
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

function checkNames(id: string, job: Record<string, unknown>): string[] {
  const matrix = (job.strategy as { matrix?: Record<string, unknown> } | undefined)?.matrix;
  // An unnamed matrix job reports as "<id> (<value>)" for a one-key matrix.
  if (job.name === undefined) {
    const keys = Object.keys(matrix ?? {});
    if (keys.length === 0) return [id];
    const values = matrix?.[keys[0]!];
    return keys.length === 1 && Array.isArray(values)
      ? values.map((value) => `${id} (${value})`)
      : [];
  }
  const name = String(job.name);
  const key = name.match(/\$\{\{ matrix\.([\w-]+) \}\}/)?.[1];
  if (key === undefined) return [name];
  const values = matrix?.[key];
  if (!Array.isArray(values)) return [];
  return values.map((value) => name.replace(`\${{ matrix.${key} }}`, String(value)));
}

describe("required status contexts", () => {
  it("covers every ruleset, branch protection and documented quality gate context", async () => {
    const documented = new Set(
      (await Deno.readTextFile(new URL("../../../.github/QUALITY_GATES.md", import.meta.url)))
        .match(/`(?:quality gate \([a-z]+\)|SonarQube Cloud quality gate)`/g)
        ?.map((context) => context.slice(1, -1)),
    );
    assert(documented.size >= 4, "QUALITY_GATES.md must name the stable gate checks");
    for (
      const context of [
        ...RULESET_REQUIRED_CONTEXTS,
        ...BRANCH_PROTECTION_REQUIRED_CONTEXTS,
        ...documented,
      ]
    ) {
      assert(
        REQUIRED_JOB_CONTEXTS.includes(context) || REQUIRED_STATUS_CONTEXTS.includes(context),
        `required context "${context}" is missing from the protected list`,
      );
    }
  });

  it("keeps every required job context on a plain job under its exact name", async () => {
    const produced = new Map<string, string>();
    for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
      if (!entry.isFile || entry.name === POOL_WORKFLOW) continue;
      const workflow = asRecord(
        parse(await Deno.readTextFile(new URL(entry.name, WORKFLOWS_DIR))),
        entry.name,
      );
      for (const [id, value] of Object.entries(asRecord(workflow.jobs, `${entry.name} jobs`))) {
        const job = asRecord(value, id);
        if ("uses" in job) continue;
        for (const name of checkNames(id, job)) produced.set(name, `${entry.name} ${id}`);
      }
    }
    for (const context of REQUIRED_JOB_CONTEXTS) {
      assert(produced.has(context), `required context "${context}" must stay a plain job`);
    }
  });

  it("keeps posting the required automated review status", async () => {
    const gate = await Deno.readTextFile(new URL("automated-review-gate.yml", WORKFLOWS_DIR));
    assert(gate.includes('status?.context !== "Automated review"'));
  });

  it("calls the pool workflow only for jobs behind no required context", async () => {
    const jobs = await cicdJobs();
    const callers = Object.entries(jobs)
      .filter(([, job]) => "uses" in job && String(job.uses).includes(POOL_WORKFLOW))
      .map(([name]) => name)
      .sort();
    assertEquals(callers, POOL_CALLER_JOBS);
    for (const name of callers) {
      const job = jobs[name]!;
      assertEquals(job.uses, POOL_WORKFLOW_REF, `${name} must call the pool workflow at main`);
      const inputs = asRecord(job.with, `${name} with`);
      assertEquals(inputs.job, name, `${name} must run its own pool job`);
      assertEquals(inputs.ubuntu26, "${{ inputs.ubuntu26 == true }}");
      assert(PUBLIC_POOL_JOBS.includes(name), `${name} must exist in the pool workflow`);
      for (const context of checkNames(name, job)) {
        assertEquals(
          REQUIRED_JOB_CONTEXTS.includes(context),
          false,
          `${name} reports "${context} / ...", which would break a required context`,
        );
      }
      assert(
        String(job.if).includes(
          "github.event.pull_request.head.repo.full_name == github.repository",
        ),
        `${name} must keep the fork guard`,
      );
    }
  });
});
