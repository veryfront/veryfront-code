import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  decideRunnerTrust,
  isTrustedPullRequest,
  queuedPullNumber,
} from "../../../scripts/ci/runner-trust.mjs";

// Use the standard GitHub-hosted pool for PR, main, and merge-queue jobs.
// The organization has no ubuntu-latest-m runner, so selecting that label
// leaves publication and merge-queue jobs without an assigned machine.
const LINUX_RUNNER = "ubuntu-latest";
const CANARY_RUNNER =
  "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ubuntu26 == true && 'ubuntu-26.04' || 'ubuntu-latest' }}";
const TRUSTED_RUNNER =
  "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ubuntu26 == true && 'ubuntu-26.04' || (github.repository == 'veryfront/veryfront-code' && (github.event_name == 'merge_group' || (github.event_name == 'push' && github.ref == 'refs/heads/main')) && needs.runner-trust.outputs.trusted == 'true' && vars.CI_RUNNER_TRUSTED == 'veryfront-ci') && 'veryfront-ci' || 'ubuntu-latest' }}";
const TRUST_JOB = "runner-trust";
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
  return expression.slice(4, -3).replaceAll("needs.runner-trust", 'needs["runner-trust"]');
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
      if (name === TRUST_JOB) {
        assertEquals(runsOn, LINUX_RUNNER, "runner-trust must use a GitHub-hosted runner");
        continue;
      }
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
      assert(
        (job.needs as string[]).includes(TRUST_JOB),
        `${name} must wait for the runner-trust decision`,
      );
      assert(
        !String(job.if).includes(TRUST_JOB),
        `${name} must not gate on the runner-trust result`,
      );
    }
  });

  it("decides trust on a hosted, read-only job from default-branch code", async () => {
    const job = (await cicdJobs())[TRUST_JOB];
    assert(job, "runner-trust job must exist");
    assertEquals(job["runs-on"], LINUX_RUNNER);
    assertEquals(job["timeout-minutes"], 2);
    assertEquals(job.permissions, { contents: "read", "pull-requests": "read" });
    assert(!("needs" in job), "runner-trust must not wait for other jobs");
    // Jobs whose `if` has no status function skip when any ancestor skips, so
    // runner-trust runs on every event and decides inside its step.
    assert(!("if" in job), "runner-trust must run on every event");
    assert(!("environment" in job), "runner-trust must not use a deployment environment");
    assert(!JSON.stringify(job).includes("secrets."), "runner-trust must not read secrets");
    assertEquals(
      asRecord(job.outputs, "runner-trust outputs").trusted,
      "${{ steps.decide.outputs.result == 'true' && 'true' || 'false' }}",
    );
    const steps = job.steps as Record<string, unknown>[];
    assertEquals(steps.length, 1, "runner-trust must not check out the code under test");
    const [step] = steps;
    assertEquals(step.id, "decide");
    assertEquals(
      step.if,
      "${{ vars.CI_RUNNER_TRUSTED == 'veryfront-ci' && github.repository == 'veryfront/veryfront-code' && (github.event_name == 'merge_group' || (github.event_name == 'push' && github.ref == 'refs/heads/main')) }}",
    );
    // A failed or skipped decision outputs false and never fails the job.
    assertEquals(step["continue-on-error"], true);
    assertEquals(step["timeout-minutes"], 1);
    assert(String(step.uses).startsWith("actions/github-script@"));
    const script = String(asRecord(step.with, "decide inputs").script);
    assert(script.includes('path: "scripts/ci/runner-trust.mjs"'));
    assert(script.includes("ref: context.payload.repository.default_branch"));
  });

  it("uses the self-hosted pool only for merge-queue and main push runs", () => {
    const selectRunner = new Function(
      "github",
      "inputs",
      "vars",
      "needs",
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
            for (const decision of [undefined, "", "false", "true"]) {
              for (const enabled of [undefined, false, true]) {
                const canary = event === "workflow_dispatch" && ref === "refs/heads/main" &&
                  enabled === true;
                const trusted = repository === REPOSITORY && flag === "veryfront-ci" &&
                  decision === "true" &&
                  (event === "merge_group" || (event === "push" && ref === "refs/heads/main"));
                assertEquals(
                  selectRunner(
                    { event_name: event, ref, repository },
                    { ubuntu26: enabled },
                    { CI_RUNNER_TRUSTED: flag },
                    { "runner-trust": { outputs: { trusted: decision } } },
                  ),
                  canary ? "ubuntu-26.04" : trusted ? "veryfront-ci" : LINUX_RUNNER,
                  `${repository} ${event} ${ref} flag=${flag} trusted=${decision} ubuntu26=${enabled}`,
                );
              }
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

const QUEUE_BASE = "1111111111111111111111111111111111111111";
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

interface FakePull {
  number: number;
  author_association: string;
  user: { login: string; type: string } | null;
  head: { repo: { full_name: string } | null };
  base: { repo: { full_name: string } };
}

function pull(
  number: number,
  overrides: { association?: string; type?: string; login?: string; head?: string | null } = {},
): FakePull {
  return {
    number,
    author_association: overrides.association ?? "MEMBER",
    user: { login: overrides.login ?? `author-${number}`, type: overrides.type ?? "User" },
    head: { repo: overrides.head === null ? null : { full_name: overrides.head ?? REPOSITORY } },
    base: { repo: { full_name: REPOSITORY } },
  };
}

interface FakeApi {
  commits?: string[];
  totalCommits?: number;
  queue?: { sha: string; number: number }[];
  associated?: Record<string, FakePull[]>;
  pulls?: FakePull[];
  failCompare?: boolean;
  failQueue?: boolean;
}

function fakeGithub(api: FakeApi) {
  const commits = api.commits ?? [SHA_A];
  return {
    rest: {
      repos: {
        compareCommitsWithBasehead: () => {
          if (api.failCompare) return Promise.reject(new Error("compare failed"));
          return Promise.resolve({
            data: {
              total_commits: api.totalCommits ?? commits.length,
              commits: commits.map((sha) => ({ sha })),
            },
          });
        },
        listPullRequestsAssociatedWithCommit: ({ commit_sha }: { commit_sha: string }) =>
          Promise.resolve({ data: api.associated?.[commit_sha] ?? [] }),
      },
      pulls: {
        get: ({ pull_number }: { pull_number: number }) => {
          const found = api.pulls?.find((candidate) => candidate.number === pull_number);
          return found ? Promise.resolve({ data: found }) : Promise.reject(new Error("not found"));
        },
      },
    },
    graphql: () => {
      if (api.failQueue) return Promise.reject(new Error("graphql failed"));
      return Promise.resolve({
        repository: {
          mergeQueue: {
            entries: {
              nodes: (api.queue ?? []).map(({ sha, number }) => ({
                headCommit: { oid: sha },
                pullRequest: { number },
              })),
            },
          },
        },
      });
    },
  };
}

function mergeGroup(headSha: string, headPull: number) {
  return {
    base_ref: "refs/heads/main",
    head_ref: `refs/heads/gh-readonly-queue/main/pr-${headPull}-${QUEUE_BASE}`,
    head_sha: headSha,
  };
}

function decideMergeGroup(api: FakeApi, group = mergeGroup(SHA_A, 7)) {
  return decideRunnerTrust({
    github: fakeGithub(api),
    repository: REPOSITORY,
    eventName: "merge_group",
    ref: group.head_ref,
    mergeGroup: group,
  });
}

describe("runner-trust decision", () => {
  it("trusts pushes to main in this repository only", async () => {
    const github = fakeGithub({});
    const decide = (eventName: string, ref: string, repository = REPOSITORY) =>
      decideRunnerTrust({ github, repository, eventName, ref });
    assertEquals(await decide("push", "refs/heads/main"), true);
    assertEquals(await decide("push", "refs/heads/feature"), false);
    assertEquals(await decide("push", "refs/heads/main", "someone/veryfront-code"), false);
    for (const event of ["pull_request", "pull_request_target", "workflow_dispatch", "schedule"]) {
      assertEquals(await decide(event, "refs/heads/main"), false, event);
    }
  });

  it("trusts a merge group from a member or owner", async () => {
    for (const association of ["MEMBER", "OWNER"]) {
      assertEquals(
        await decideMergeGroup({
          queue: [{ sha: SHA_A, number: 7 }],
          pulls: [pull(7, { association })],
        }),
        true,
        association,
      );
    }
  });

  it("does not trust other author associations", async () => {
    for (
      const association of [
        "COLLABORATOR",
        "CONTRIBUTOR",
        "FIRST_TIME_CONTRIBUTOR",
        "FIRST_TIMER",
        "MANNEQUIN",
        "NONE",
        "",
      ]
    ) {
      assertEquals(
        await decideMergeGroup({
          queue: [{ sha: SHA_A, number: 7 }],
          pulls: [pull(7, { association })],
        }),
        false,
        association,
      );
    }
  });

  it("does not trust fork heads, bots, or missing authors", async () => {
    const untrusted = [
      pull(7, { head: "someone/veryfront-code" }),
      pull(7, { head: null }),
      pull(7, { type: "Bot", login: "dependabot[bot]" }),
      { ...pull(7), user: null },
    ];
    for (const candidate of untrusted) {
      assertEquals(
        await decideMergeGroup({ queue: [{ sha: SHA_A, number: 7 }], pulls: [candidate] }),
        false,
      );
      assertEquals(isTrustedPullRequest(candidate, REPOSITORY), false);
    }
  });

  it("does not trust a group that contains one outside pull request", async () => {
    const queue = [{ sha: SHA_A, number: 6 }, { sha: SHA_B, number: 7 }];
    const group = mergeGroup(SHA_B, 7);
    assertEquals(
      await decideMergeGroup({ commits: [SHA_A, SHA_B], queue, pulls: [pull(6), pull(7)] }, group),
      true,
    );
    assertEquals(
      await decideMergeGroup(
        {
          commits: [SHA_A, SHA_B],
          queue,
          pulls: [pull(6, { association: "CONTRIBUTOR" }), pull(7)],
        },
        group,
      ),
      false,
    );
  });

  it("resolves commits outside the queue through their pull requests", async () => {
    const queue = [{ sha: SHA_B, number: 7 }];
    const group = mergeGroup(SHA_B, 7);
    const commits = [SHA_A, SHA_B];
    const pulls = [pull(6), pull(7)];
    assertEquals(
      await decideMergeGroup({ commits, queue, pulls, associated: { [SHA_A]: [pull(6)] } }, group),
      true,
    );
    assertEquals(
      await decideMergeGroup(
        { commits, queue, pulls, associated: { [SHA_A]: [pull(6, { association: "NONE" })] } },
        group,
      ),
      false,
    );
    assertEquals(await decideMergeGroup({ commits, queue, pulls }, group), false);
  });

  it("fails closed on API errors and inconsistent queue data", async () => {
    const queue = [{ sha: SHA_A, number: 7 }];
    const pulls = [pull(7)];
    assertEquals(await decideMergeGroup({ queue, pulls, failCompare: true }), false);
    assertEquals(await decideMergeGroup({ queue, pulls, failQueue: true }), false);
    assertEquals(await decideMergeGroup({ queue, pulls: [] }), false);
    assertEquals(await decideMergeGroup({ queue, pulls, commits: [] }), false);
    assertEquals(await decideMergeGroup({ queue, pulls, totalCommits: 300 }), false);
    assertEquals(await decideMergeGroup({ queue: [{ sha: SHA_A, number: 8 }], pulls }), false);
    assertEquals(await decideMergeGroup({ queue: [], pulls }), false);
    assertEquals(
      await decideMergeGroup({ queue, pulls }, { ...mergeGroup(SHA_A, 7), head_ref: "main" }),
      false,
    );
    assertEquals(
      await decideMergeGroup({ queue, pulls }, { ...mergeGroup(SHA_A, 7), base_ref: "main" }),
      false,
    );
  });

  it("parses the queued pull request number", () => {
    assertEquals(queuedPullNumber(`gh-readonly-queue/main/pr-42-${QUEUE_BASE}`), 42);
    assertEquals(queuedPullNumber(`refs/heads/gh-readonly-queue/main/pr-42-${QUEUE_BASE}`), 42);
    assertEquals(queuedPullNumber("refs/heads/main"), undefined);
    assertEquals(queuedPullNumber(undefined), undefined);
  });
});
