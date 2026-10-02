import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

const SHA = "a".repeat(40);
const BASE = "b".repeat(40);
const OTHER = "c".repeat(40);
const WORKFLOW_PATH = new URL(
  "../../../.github/workflows/dequeue-failed-merge-group.yml",
  import.meta.url,
);
const RUN = {
  id: 42,
  workflow_id: 100,
  event: "merge_group",
  status: "completed",
  conclusion: "cancelled",
  run_attempt: 1,
  head_sha: SHA,
  head_branch: `gh-readonly-queue/main/pr-4828-${BASE}`,
  repository: { id: 1, full_name: "veryfront/veryfront-code" },
  head_repository: { id: 1, full_name: "veryfront/veryfront-code" },
};
const BINDING = {
  id: "PR_fixture",
  number: 4828,
  state: "OPEN",
  baseRefName: "main",
  mergeQueueEntry: {
    id: "MQ_fixture",
    headCommit: { oid: SHA },
    baseCommit: { oid: BASE },
  },
};

function fixture() {
  return {
    run: structuredClone(RUN),
    finalRun: structuredClone(RUN),
    changeFinalRun: false,
    workflow: { id: 100, path: ".github/workflows/cicd.yml" },
    eventName: "workflow_run",
    eventRun: { id: 42, event: "merge_group", head_sha: SHA, run_attempt: 1 },
    repositoryId: 1,
    jobs: [{
      name: "quality gate (merge)",
      status: "completed",
      conclusion: "failure",
      completed_at: "2026-10-02T23:05:18Z",
    }],
    binding: structuredClone(BINDING) as typeof BINDING | null,
    finalBinding: structuredClone(BINDING) as typeof BINDING | null,
    changeFinalBinding: false,
    liveSha: SHA,
    apiError: false,
    mutations: [] as Array<Record<string, unknown>>,
  };
}

type Fixture = ReturnType<typeof fixture>;

async function workflow() {
  return parse(await Deno.readTextFile(WORKFLOW_PATH)) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, {
      if: string;
      permissions: Record<string, string>;
      steps: Array<{ uses: string; with: { script: string; retries?: number } }>;
    }>;
  };
}

async function execute(f: Fixture) {
  const step = (await workflow()).jobs.dequeue.steps[0];
  let runReads = 0;
  let bindingReads = 0;
  const jobsMethod = () => {};
  const github = {
    rest: {
      actions: {
        getWorkflowRun: (args: Record<string, unknown>) => {
          assertEquals(args.run_id, 42);
          assertEquals(args.owner, "veryfront");
          assertEquals(args.repo, "veryfront-code");
          if (f.apiError) throw new Error("fixture API failure");
          runReads++;
          return { data: f.changeFinalRun && runReads > 1 ? f.finalRun : f.run };
        },
        getWorkflow: (args: Record<string, unknown>) => {
          assertEquals(args.workflow_id, "cicd.yml");
          return { data: f.workflow };
        },
        listJobsForWorkflowRunAttempt: jobsMethod,
      },
      git: {
        getRef: (args: Record<string, unknown>) => {
          assertEquals(args.ref, `heads/${RUN.head_branch}`);
          return { data: { object: { sha: f.liveSha } } };
        },
      },
    },
    paginate: (method: unknown, args: Record<string, unknown>) => {
      assertEquals(method, jobsMethod);
      assertEquals(args.run_id, 42);
      assertEquals(args.attempt_number, 1);
      assertEquals(args.per_page, 100);
      return f.jobs;
    },
    graphql: (query: string, args: Record<string, unknown>) => {
      if (query.trim().startsWith("mutation")) {
        assert(query.includes("dequeuePullRequest"));
        f.mutations.push(args);
        return { dequeuePullRequest: { clientMutationId: null } };
      }
      assertEquals(args.number, 4828);
      bindingReads++;
      const pullRequest = f.changeFinalBinding && bindingReads > 1 ? f.finalBinding : f.binding;
      return { repository: { pullRequest } };
    },
  };
  const context = {
    repo: { owner: "veryfront", repo: "veryfront-code" },
    eventName: f.eventName,
    payload: { repository: { id: f.repositoryId }, workflow_run: f.eventRun },
  };
  // Execute the actual trusted inline script with explicit API dependencies.
  const run = new Function("github", "context", `return (async () => {${step.with.script}\n})();`);
  await run(github, context);
}

describe("failed merge-group queue cleanup", () => {
  it("dequeues exactly once after authoritative required-gate failure", async () => {
    const f = fixture();
    await execute(f);
    assertEquals(f.mutations, [{ id: "PR_fixture" }]);
  });

  const cases: Array<[string, (f: Fixture) => void]> = [
    ["ordinary pull requests", (f) => f.eventRun.event = "pull_request"],
    ["push runs", (f) => f.eventRun.event = "push"],
    ["other triggers", (f) => f.eventName = "pull_request_target"],
    ["successful runs", (f) => f.run.conclusion = "success"],
    ["unfinished runs", (f) => f.run.status = "in_progress"],
    ["foreign run events", (f) => f.run.event = "pull_request"],
    ["foreign repositories", (f) => f.run.repository.id = 2],
    ["fork heads", (f) => f.run.head_repository.full_name = "other/veryfront-code"],
    ["other workflows", (f) => f.run.workflow_id = 101],
    ["other workflow paths", (f) => f.workflow.path = ".github/workflows/other.yml"],
    ["stale attempts", (f) => f.run.run_attempt = 2],
    ["different event head", (f) => f.eventRun.head_sha = OTHER],
    ["malformed refs", (f) => f.run.head_branch = "gh-readonly-queue/main/pr-invalid"],
    ["successful gates", (f) => f.jobs[0].conclusion = "success"],
    ["cancelled gates", (f) => f.jobs[0].conclusion = "cancelled"],
    ["unfinished gates", (f) => f.jobs[0].status = "in_progress"],
    ["missing gates", (f) => f.jobs = []],
    ["ambiguous gates", (f) => f.jobs.push({ ...f.jobs[0] })],
    ["absent entries", (f) => f.binding = null],
    ["different queue heads", (f) => f.binding!.mergeQueueEntry.headCommit.oid = OTHER],
    ["different queue bases", (f) => f.binding!.mergeQueueEntry.baseCommit.oid = OTHER],
    ["different target branches", (f) => f.binding!.baseRefName = "release"],
    ["closed pull requests", (f) => f.binding!.state = "CLOSED"],
    ["changed live refs", (f) => f.liveSha = OTHER],
    ["entries removed before final read", (f) => {
      f.changeFinalBinding = true;
      f.finalBinding = null;
    }],
    ["entries rebuilt before final read", (f) => {
      f.changeFinalBinding = true;
      f.finalBinding!.mergeQueueEntry.headCommit.oid = OTHER;
    }],
    ["entries re-enqueued before final read", (f) => {
      f.changeFinalBinding = true;
      f.finalBinding!.mergeQueueEntry.id = "MQ_new";
    }],
    ["attempts restarted before final read", (f) => {
      f.changeFinalRun = true;
      f.finalRun.run_attempt = 2;
    }],
  ];
  for (const [name, change] of cases) {
    it(`does not dequeue ${name}`, async () => {
      const f = fixture();
      change(f);
      await execute(f);
      assertEquals(f.mutations, []);
    });
  }

  it("propagates API failures without mutation or retry", async () => {
    const f = fixture();
    f.apiError = true;
    await assertRejects(() => execute(f), Error, "fixture API failure");
    assertEquals(f.mutations, []);
  });

  it("uses protected workflow completion with no source execution or gate changes", async () => {
    const w = await workflow();
    assertEquals(w.on, { workflow_run: { workflows: ["CI/CD"], types: ["completed"] } });
    assertEquals(w.permissions, {});
    const job = w.jobs.dequeue;
    assertEquals(
      job.if,
      "${{ github.event.workflow_run.event == 'merge_group' && github.event.workflow_run.conclusion != 'success' }}",
    );
    assertEquals(job.permissions, { actions: "read", contents: "write", "pull-requests": "read" });
    assertEquals(job.steps.length, 1);
    assertEquals(
      job.steps[0].uses,
      "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
    );
    assertEquals(job.steps[0].with.retries, 0);
    assertEquals(Object.keys(w.jobs), ["dequeue"]);
  });
});
