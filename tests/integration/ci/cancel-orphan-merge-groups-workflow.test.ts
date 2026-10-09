import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";

const SHA = "a".repeat(40);
const BRANCH = `gh-readonly-queue/main/pr-42-${SHA}`;
const RUN = {
  id: 42,
  event: "merge_group",
  status: "queued",
  workflow_id: 100,
  run_attempt: 1,
  head_sha: SHA,
  head_branch: BRANCH,
  repository: { full_name: "veryfront/veryfront-code" },
  head_repository: { full_name: "veryfront/veryfront-code" },
};

async function workflow() {
  return parse(
    await Deno.readTextFile(
      new URL("../../../.github/workflows/cancel-orphan-merge-groups.yml", import.meta.url),
    ),
  ) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    concurrency: Record<string, unknown>;
    jobs: Record<string, {
      if: string;
      "runs-on": string;
      "timeout-minutes": number;
      permissions: Record<string, string>;
      steps: Array<{ uses: string; with: { script: string; retries: number } }>;
    }>;
  };
}

function fixture() {
  return {
    runs: [structuredClone(RUN)],
    latest: structuredClone(RUN),
    refs: [] as Array<{ ref: string }>,
    refExists: false,
    refError: 404,
    workflow: { id: 100, path: ".github/workflows/cicd.yml" },
    comparison: "diverged" as string,
    compareError: 0,
    recreateRefOnCompare: false,
    compared: [] as string[],
    cancelError: 0,
    finishedOnCancel: false,
    cancelled: [] as number[],
    inspectedRefs: [] as string[],
    statuses: [] as string[],
    logs: [] as string[],
  };
}

async function execute(f: ReturnType<typeof fixture>) {
  const runsMethod = () => {};
  const github = {
    rest: {
      actions: {
        cancelWorkflowRun: () => {
          throw new Error("Graceful cancellation leaves orphan always() aggregators queued");
        },
        getWorkflow: () => ({ data: f.workflow }),
        listWorkflowRuns: runsMethod,
        getWorkflowRun: ({ run_id }: { run_id: number }) => {
          assertEquals(run_id, 42);
          return { data: f.latest };
        },
        forceCancelWorkflowRun: ({ run_id }: { run_id: number }) => {
          if (f.finishedOnCancel) f.latest.status = "completed";
          if (f.cancelError) {
            throw Object.assign(new Error("cancel API failure"), { status: f.cancelError });
          }
          f.cancelled.push(run_id);
        },
      },
      repos: {
        compareCommitsWithBasehead: ({ basehead }: { basehead: string }) => {
          f.compared.push(basehead);
          if (f.compareError) {
            throw Object.assign(new Error("compare API failure"), { status: f.compareError });
          }
          if (f.recreateRefOnCompare) f.refExists = true;
          return { data: { status: f.comparison } };
        },
      },
      git: {
        listMatchingRefs: ({ ref }: { ref: string }) => {
          assertEquals(ref, "heads/gh-readonly-queue/main/");
          return { data: f.refs };
        },
        getRef: ({ ref }: { ref: string }) => {
          f.inspectedRefs.push(ref);
          if (!f.refExists) {
            throw Object.assign(new Error("ref API failure"), { status: f.refError });
          }
          return { data: { ref: `refs/heads/${BRANCH}`, object: { sha: SHA } } };
        },
      },
    },
    paginate: (method: unknown, args: Record<string, unknown>) => {
      assertEquals(method, runsMethod);
      assertEquals(args, {
        owner: "veryfront",
        repo: "veryfront-code",
        workflow_id: "cicd.yml",
        event: "merge_group",
        status: args.status,
        per_page: 100,
      });
      f.statuses.push(String(args.status));
      return f.runs.filter((run) => run.status === args.status);
    },
  };
  const context = {
    repo: { owner: "veryfront", repo: "veryfront-code" },
    runId: 999,
    serverUrl: "https://github.com",
  };
  const core = { info: (value: string) => f.logs.push(value) };
  const script = (await workflow()).jobs.sweep.steps[0]!.with.script;
  await new Function("github", "context", "core", `return (async () => {${script}\n})();`)(
    github,
    context,
    core,
  );
}

describe("orphan merge-group cancellation", () => {
  for (const status of ["queued", "in_progress"]) {
    it(`cancels a confirmed ${status} orphan with its sweeper receipt`, async () => {
      const f = fixture();
      f.runs[0]!.status = status;
      f.latest.status = status;
      await execute(f);
      assertEquals(f.cancelled, [42]);
      assertEquals(f.inspectedRefs, [`heads/${BRANCH}`]);
      assert(
        f.logs.some((line) =>
          line.includes("Force-cancelled") && line.includes("42") && line.includes("999")
        ),
      );
      assertEquals(f.statuses, ["queued", "in_progress"]);
    });
  }

  const cases: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
    ["live refs", (f) => f.refs = [{ ref: `refs/heads/${BRANCH}` }]],
    ["recreated refs", (f) => f.refExists = true],
    ["foreign repositories", (f) => f.runs[0]!.repository.full_name = "other/repo"],
    ["fork heads", (f) => f.runs[0]!.head_repository.full_name = "other/repo"],
    ["pull requests", (f) => f.runs[0]!.event = "pull_request"],
    ["other workflows", (f) => f.runs[0]!.workflow_id = 101],
    ["other workflow paths", (f) => f.workflow.path = ".github/workflows/other.yml"],
    [
      "other queue branches",
      (f) => f.runs[0]!.head_branch = `gh-readonly-queue/release/pr-42-${SHA}`,
    ],
    ["malformed queue refs", (f) => f.runs[0]!.head_branch = "gh-readonly-queue/main/invalid"],
    ["invalid ids", (f) => f.runs[0]!.id = -1],
    ["invalid head SHAs", (f) => f.runs[0]!.head_sha = "invalid"],
    ["completed runs", (f) => f.latest.status = "completed"],
    ["restarted attempts", (f) => f.latest.run_attempt = 2],
    ["changed head SHAs", (f) => f.latest.head_sha = "b".repeat(40)],
    ["changed branches", (f) => f.latest.head_branch = `gh-readonly-queue/main/pr-43-${SHA}`],
    ["changed workflow", (f) => f.latest.workflow_id = 101],
    ["changed repository", (f) => f.latest.repository.full_name = "other/repo"],
  ];
  for (const [name, change] of cases) {
    it(`preserves ${name}`, async () => {
      const f = fixture();
      change(f);
      await execute(f);
      assertEquals(f.cancelled, []);
    });
  }

  for (const status of [403, 429, 500]) {
    it(`fails closed on ref API ${status}`, async () => {
      const f = fixture();
      f.refError = status;
      await assertRejects(() => execute(f), Error, "ref API failure");
      assertEquals(f.cancelled, []);
    });
  }

  for (const comparison of ["identical", "behind"]) {
    it(`preserves landed queue commits (${comparison})`, async () => {
      const f = fixture();
      f.comparison = comparison;
      await execute(f);
      assertEquals(f.compared, [`main...${SHA}`]);
      assertEquals(f.cancelled, []);
    });
  }

  it("preserves a ref recreated while the ancestry comparison is pending", async () => {
    const f = fixture();
    f.comparison = "ahead";
    f.recreateRefOnCompare = true;
    await execute(f);
    assertEquals(f.compared, [`main...${SHA}`]);
    assertEquals(f.inspectedRefs, [`heads/${BRANCH}`]);
    assertEquals(f.cancelled, []);
  });

  it("cancels unmerged ahead queue commits", async () => {
    const f = fixture();
    f.comparison = "ahead";
    await execute(f);
    assertEquals(f.cancelled, [42]);
  });

  it("preserves unknown comparison statuses", async () => {
    const f = fixture();
    f.comparison = "unexpected";
    await execute(f);
    assertEquals(f.cancelled, []);
  });

  for (const status of [403, 404, 500]) {
    it(`fails closed on compare API ${status}`, async () => {
      const f = fixture();
      f.compareError = status;
      await assertRejects(() => execute(f), Error, "compare API failure");
      assertEquals(f.cancelled, []);
    });
  }

  it("deduplicates paginated candidate run ids", async () => {
    const f = fixture();
    f.runs.push(structuredClone(RUN));
    await execute(f);
    assertEquals(f.cancelled, [42]);
  });

  it("accepts only a verified completion race on cancellation conflict", async () => {
    const f = fixture();
    f.cancelError = 409;
    f.finishedOnCancel = true;
    await execute(f);
    assertEquals(f.cancelled, []);
  });

  for (const status of [403, 409, 500]) {
    it(`propagates cancellation API ${status} without retry`, async () => {
      const f = fixture();
      f.cancelError = status;
      await assertRejects(() => execute(f), Error, "cancel API failure");
      assertEquals(f.cancelled, []);
    });
  }

  it("uses only protected-main triggers with minimal privileges and no source execution", async () => {
    const w = await workflow();
    assertEquals(w.on, {
      delete: {},
      schedule: [{ cron: "*/5 * * * *" }],
      workflow_run: { workflows: ["CI/CD"], types: ["requested"] },
      workflow_dispatch: {},
    });
    assertEquals(w.permissions, {});
    assertEquals(w.concurrency, {
      group: "cancel-orphan-merge-groups",
      "cancel-in-progress": false,
    });
    assertEquals(Object.keys(w.jobs), ["sweep"]);
    const job = w.jobs.sweep!;
    assertEquals(
      job.if,
      "${{ (github.event_name == 'schedule') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event_name == 'delete' && github.event.ref_type == 'branch' && startsWith(github.event.ref, 'gh-readonly-queue/main/')) || (github.event_name == 'workflow_run' && github.event.workflow_run.event == 'merge_group') }}",
    );
    assertEquals(job["runs-on"], "ubuntu-latest");
    assertEquals(job["timeout-minutes"], 2);
    assertEquals(job.permissions, { actions: "write", contents: "read" });
    assertEquals(job.steps.length, 1);
    assertEquals(
      job.steps[0]!.uses,
      "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
    );
    assertEquals(job.steps[0]!.with.retries, 0);
  });
});
