import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createWatchdogClient,
  decideRecovery,
  type Job,
  recoverGate,
  type RecoveryIntent,
  type Run,
  scanGates,
  type WatchdogClient,
} from "./registry-gate-watchdog.ts";

const NOW = Date.parse("2026-10-05T13:50:00Z");
const run: Run = {
  id: 37315132316,
  run_number: 22200,
  run_attempt: 1,
  event: "push",
  head_branch: "main",
  path: ".github/workflows/cicd.yml",
  head_sha: "80d0c23a00858f066a44cb034aac31e5828f8060",
  status: "in_progress",
  created_at: "2026-10-05T13:13:19Z",
};
const gate: Job = {
  id: 111787668926,
  name: "quality gate (registry)",
  status: "queued",
  conclusion: null,
  created_at: "2026-10-05T13:31:23Z",
  started_at: null,
  steps: [],
};
const prerelease: Job = {
  ...gate,
  id: 2,
  name: "prerelease",
  status: "completed",
  conclusion: "success",
  started_at: "2026-10-05T13:14:00Z",
};
const jobs = [prerelease, gate];
const other: Run = { ...run, id: 3, run_number: 22201 };
function decide(
  candidateJobs = jobs,
  others: { run: Run; jobs: Job[] }[] = [],
) {
  return decideRecovery({ run, jobs: candidateJobs }, others, NOW);
}

describe("registry gate watchdog", () => {
  it("recovers the historical queued gate with no holder", () => {
    assertEquals(decide().recover, true);
    assertEquals(decide().message, "stuck, no holder, would recover");
  });
  it("does nothing for healthy, started, or recently queued gates", () => {
    for (
      const changed of [
        {
          status: "completed",
          conclusion: "success",
          started_at: gate.created_at,
        },
        { steps: [{ name: "Set up job", conclusion: "success" }] },
        { created_at: "2026-10-05T13:35:00Z" },
      ]
    ) {
      assertEquals(
        decide([prerelease, { ...gate, ...changed }]).recover,
        false,
      );
    }
  });
  it("recovers a queued zero-step gate even when REST populates started_at", () => {
    assertEquals(
      decide([prerelease, { ...gate, started_at: gate.created_at }]).recover,
      true,
    );
  });
  it("does not recover when any other branch holds or queues the gate", () => {
    for (const status of ["queued", "in_progress", "waiting", "pending"]) {
      assertEquals(
        decide(jobs, [{
          run: { ...other, head_branch: "feature" },
          jobs: [{ ...gate, status }],
        }]).recover,
        false,
      );
    }
  });
  it("does not recover if a newer main gate already dispatched", () => {
    const dispatched = {
      ...gate,
      status: "completed",
      conclusion: "success",
      steps: [{ name: "Trigger server deploy", conclusion: "success" }],
    };
    assertEquals(
      decide(jobs, [{ run: other, jobs: [dispatched] }]).recover,
      false,
    );
  });
  it("never retries a failed check or cancels unrelated unfinished work", () => {
    for (
      const changed of [
        { status: "in_progress", conclusion: null },
        { status: "completed", conclusion: "failure" },
        { status: "completed", conclusion: "cancelled" },
        { status: "completed", conclusion: "timed_out" },
      ]
    ) {
      assertEquals(
        decide([{ ...prerelease, ...changed }, gate]).recover,
        false,
      );
    }
  });
  it("excludes stable releases, other workflows, and completed runs", () => {
    assertEquals(decide([gate]).recover, false);
    for (
      const changed of [
        { event: "workflow_dispatch" },
        { head_branch: "release" },
        { path: ".github/workflows/other.yml" },
        { status: "completed" },
      ]
    ) {
      assertEquals(
        decideRecovery({ run: { ...run, ...changed }, jobs }, [], NOW).recover,
        false,
      );
    }
  });

  function client() {
    const calls: string[] = [];
    let cancelled = false;
    let intent: RecoveryIntent | undefined;
    const api: WatchdogClient = {
      inspect: () => Promise.resolve({ run, jobs }),
      recoveryIntent: () => Promise.resolve(intent),
      remember: (candidate) => {
        calls.push("intent");
        intent = {
          runId: candidate.run.id,
          attempt: candidate.run.run_attempt,
          sha: candidate.run.head_sha,
          gateId: gate.id,
        };
        return Promise.resolve();
      },
      others: () => Promise.resolve([]),
      cancel: () => {
        calls.push("cancel");
        cancelled = true;
        return Promise.resolve();
      },
      completed: () =>
        Promise.resolve(
          cancelled
            ? [
              { ...gate, status: "completed", conclusion: "cancelled" },
              prerelease,
            ]
            : jobs,
        ),
      rerunFailed: () => {
        calls.push("rerun-failed");
        return Promise.resolve();
      },
      comment: () => {
        calls.push("comment");
        return Promise.resolve();
      },
    };
    return { api, calls };
  }
  it("dry-run makes no mutations", async () => {
    const { api, calls } = client();
    await recoverGate(api, run.id, { dryRun: true, now: () => NOW });
    assertEquals(calls, []);
  });
  it("rechecks before cancellation and only reruns cancelled unstarted work", async () => {
    const { api, calls } = client();
    await recoverGate(api, run.id, { dryRun: false, now: () => NOW });
    assertEquals(calls, ["intent", "cancel", "rerun-failed", "comment"]);
  });
  it("does not act if the gate starts during the final recheck", async () => {
    const { api, calls } = client();
    let reads = 0;
    api.inspect = () =>
      Promise.resolve({
        run,
        jobs: ++reads === 1 ? jobs : [prerelease, {
          ...gate,
          status: "in_progress",
          started_at: gate.created_at,
        }],
      });
    await recoverGate(api, run.id, { dryRun: false, now: () => NOW });
    assertEquals(calls, []);
  });
  it("queues the rerun behind a holder appearing after verified cancellation", async () => {
    for (const head_branch of ["main", "feature"]) {
      const { api, calls } = client();
      let reads = 0;
      api.others = () =>
        Promise.resolve(
          ++reads < 3 ? [] : [{
            run: { ...other, head_branch },
            jobs: [{ ...gate, status: "in_progress" }],
          }],
        );
      await recoverGate(api, run.id, { dryRun: false, now: () => NOW });
      assertEquals(calls, ["intent", "cancel", "rerun-failed", "comment"]);
    }
  });
  it("reports a newer successful dispatch after cancellation without rerunning", async () => {
    const { api, calls } = client();
    let reads = 0;
    api.others = () =>
      Promise.resolve(
        ++reads < 3 ? [] : [{
          run: other,
          jobs: [{
            ...gate,
            status: "completed",
            conclusion: "success",
            steps: [{ name: "Trigger server deploy", conclusion: "success" }],
          }],
        }],
      );
    const message = await recoverGate(api, run.id, {
      dryRun: false,
      now: () => NOW,
    });
    assertEquals(message.includes("newer main gate dispatched"), true);
    assertEquals(calls, ["intent", "cancel", "comment"]);
  });
  it("continues inspecting other candidates and reports a scan failure", async () => {
    const { api, calls } = client();
    api.inspect = (id) =>
      id === 1
        ? Promise.reject(new Error("inspection unavailable"))
        : Promise.resolve({ run, jobs });
    const result = await scanGates(api, [1, run.id], {
      dryRun: true,
      now: () => NOW,
    });
    assertEquals(result.failed, true);
    assertEquals(result.lines, [
      "Run 1: ERROR: inspection unavailable",
      `Run ${run.id}: stuck, no holder, would recover`,
    ]);
    assertEquals(calls, []);
  });
  it("resumes a verified cancellation after a failed post-cancel inspection", async () => {
    const { api, calls } = client();
    let reads = 0;
    api.others = () =>
      ++reads === 3
        ? Promise.reject(new Error("API unavailable"))
        : Promise.resolve([]);
    await assertRejects(() =>
      recoverGate(api, run.id, { dryRun: false, now: () => NOW })
    );
    const cancelledJobs = [prerelease, {
      ...gate,
      status: "completed",
      conclusion: "cancelled",
    }];
    api.inspect = () =>
      Promise.resolve({
        run: { ...run, status: "completed" },
        jobs: cancelledJobs,
      });
    await recoverGate(api, run.id, { dryRun: false, now: () => NOW });
    assertEquals(calls, ["intent", "cancel", "rerun-failed", "comment"]);
  });
  it("resumes a failed rerun request but never repeats an ambiguously accepted attempt", async () => {
    for (const accepted of [false, true]) {
      const { api, calls } = client();
      api.rerunFailed = () => {
        calls.push("rerun-request");
        return Promise.reject(new Error("response lost"));
      };
      await assertRejects(() =>
        recoverGate(api, run.id, { dryRun: false, now: () => NOW })
      );
      api.inspect = () =>
        Promise.resolve({
          run: { ...run, status: "completed", run_attempt: accepted ? 2 : 1 },
          jobs: [prerelease, {
            ...gate,
            status: "completed",
            conclusion: accepted ? "failure" : "cancelled",
          }],
        });
      api.rerunFailed = () => {
        calls.push("rerun-failed");
        return Promise.resolve();
      };
      await recoverGate(api, run.id, { dryRun: false, now: () => NOW });
      assertEquals(
        calls,
        accepted
          ? ["intent", "cancel", "rerun-request", "comment"]
          : ["intent", "cancel", "rerun-request", "rerun-failed", "comment"],
      );
    }
  });
  it("clears intent when the original attempt finishes without a safe cancellation", async () => {
    for (const conclusion of ["success", "failure", "cancelled"]) {
      const { api, calls } = client();
      await api.remember({ run, jobs });
      api.inspect = () =>
        Promise.resolve({
          run: { ...run, status: "completed" },
          jobs: [prerelease, {
            ...gate,
            status: "completed",
            conclusion,
            steps: [{ name: "Set up job", conclusion: "success" }],
          }],
        });
      await recoverGate(api, run.id, { dryRun: false, now: () => NOW });
      assertEquals(calls, ["intent", "comment"]);
    }
  });
  it("does not resume a manually cancelled run without persisted intent", async () => {
    const { api, calls } = client();
    api.inspect = () =>
      Promise.resolve({
        run: { ...run, status: "completed" },
        jobs: [prerelease, {
          ...gate,
          status: "completed",
          conclusion: "cancelled",
        }],
      });
    assertEquals(
      await recoverGate(api, run.id, { dryRun: false, now: () => NOW }),
      "healthy, no action",
    );
    assertEquals(calls, []);
  });
  it("refuses a rerun if cancellation raced with a real failure", async () => {
    const { api, calls } = client();
    api.completed = () =>
      Promise.resolve([{ ...prerelease, conclusion: "failure" }, {
        ...gate,
        status: "completed",
        conclusion: "cancelled",
      }]);
    await assertRejects(() =>
      recoverGate(api, run.id, { dryRun: false, now: () => NOW })
    );
    assertEquals(calls, ["intent", "cancel"]);
  });
});

describe("watchdog GitHub transport", () => {
  it("reads current-attempt jobs and paginates without using old failed jobs", async () => {
    const paths: string[] = [];
    const { client } = createWatchdogClient(
      "veryfront/veryfront-code",
      "test-token",
      (url) => {
        paths.push(url.pathname + url.search);
        const body = url.pathname.endsWith(`/runs/${run.id}`) ? run : {
          jobs: url.searchParams.get("page") === "1"
            ? Array.from({ length: 100 }, (_, id) => ({ ...prerelease, id }))
            : [gate],
        };
        return Promise.resolve(Response.json(body));
      },
    );
    assertEquals((await client.inspect(run.id)).jobs.length, 101);
    assertEquals(paths.length, 3);
    assertEquals(paths[1]!.includes("/attempts/1/jobs"), true);
    assertEquals(paths[2]!.includes("page=2"), true);
  });
  it("uses cancel and rerun-failed endpoints, never the rerun-all endpoint", async () => {
    const calls: string[] = [];
    const { client } = createWatchdogClient(
      "veryfront/veryfront-code",
      "test-token",
      (url, init) => {
        calls.push(`${init.method} ${url.pathname}`);
        return Promise.resolve(
          new Response(null, {
            status: url.pathname.endsWith("/cancel") ? 202 : 201,
          }),
        );
      },
    );
    await client.cancel(run.id);
    await client.rerunFailed(run.id);
    assertEquals(calls, [
      `POST /repos/veryfront/veryfront-code/actions/runs/${run.id}/cancel`,
      `POST /repos/veryfront/veryfront-code/actions/runs/${run.id}/rerun-failed-jobs`,
    ]);
  });
  it("posts one comment on the merged PR and accepts its JSON 201 response", async () => {
    const calls: string[] = [];
    const { client } = createWatchdogClient(
      "veryfront/veryfront-code",
      "test-token",
      (url, init) => {
        calls.push(`${init.method} ${url.pathname}`);
        return Promise.resolve(
          url.pathname.endsWith("/pulls")
            ? Response.json([{
              number: 5001,
              merged_at: "2026-10-08T10:00:00Z",
            }, { number: 5002, merged_at: null }])
            : init.method === "GET"
            ? Response.json([])
            : Response.json({ id: 1 }, { status: 201 }),
        );
      },
    );
    await client.comment(run, "Recovered registry gate");
    assertEquals(calls, [
      `GET /repos/veryfront/veryfront-code/commits/${run.head_sha}/pulls`,
      "GET /repos/veryfront/veryfront-code/issues/5001/comments",
      "POST /repos/veryfront/veryfront-code/issues/5001/comments",
    ]);
  });
  it("persists one bot-owned intent, discovers cancelled work, and updates its comment", async () => {
    const comments: { id: number; body: string; user: { login: string } }[] =
      [];
    const writes: string[] = [];
    const { client, candidates } = createWatchdogClient(
      "veryfront/veryfront-code",
      "test-token",
      (url, init) => {
        if (url.pathname === "/search/issues") {
          return Promise.resolve(
            Response.json({ items: [{ number: 5001 }] }),
          );
        }
        if (url.pathname.endsWith("/pulls")) {
          return Promise.resolve(
            Response.json([{
              number: 5001,
              merged_at: "2026-10-08T10:00:00Z",
            }]),
          );
        }
        if (url.pathname.endsWith("/runs")) {
          return Promise.resolve(
            Response.json({ workflow_runs: [] }),
          );
        }
        if (init.method === "GET") {
          return Promise.resolve(
            Response.json(comments),
          );
        }
        writes.push(`${init.method} ${url.pathname}`);
        const { body } = JSON.parse(String(init.body)) as { body: string };
        if (init.method === "PATCH") comments[0]!.body = body;
        else {comments.push({
            id: 7,
            body,
            user: { login: "github-actions[bot]" },
          });}
        return Promise.resolve(
          Response.json({ id: 7 }, {
            status: init.method === "PATCH" ? 200 : 201,
          }),
        );
      },
    );
    await client.remember({ run, jobs });
    assertEquals(await client.recoveryIntent(run), {
      runId: run.id,
      attempt: 1,
      sha: run.head_sha,
      gateId: gate.id,
    });
    assertEquals(await candidates(), [run.id]);
    await client.comment(run, "Recovered registry gate");
    assertEquals(await client.recoveryIntent(run), undefined);
    assertEquals(await candidates(), []);
    assertEquals(writes, [
      "POST /repos/veryfront/veryfront-code/issues/5001/comments",
      "PATCH /repos/veryfront/veryfront-code/issues/comments/7",
    ]);
    assertEquals(comments.length, 1);
  });
  it("ignores forged recovery intent comments", async () => {
    const intent = {
      runId: run.id,
      attempt: 1,
      sha: run.head_sha,
      gateId: gate.id,
    };
    const { client, candidates } = createWatchdogClient(
      "veryfront/veryfront-code",
      "test-token",
      (url) =>
        Promise.resolve(Response.json(
          url.pathname === "/search/issues"
            ? { items: [{ number: 5001 }] }
            : url.pathname.endsWith("/pulls")
            ? [{ number: 5001, merged_at: "2026-10-08T10:00:00Z" }]
            : url.pathname.endsWith("/runs")
            ? { workflow_runs: [] }
            : [{
              id: 7,
              user: { login: "untrusted" },
              body:
                `<!-- registry-gate-watchdog:${run.id} -->\nRegistry gate watchdog pending recovery\n<!-- intent:${
                  JSON.stringify(intent)
                } -->`,
            }],
        )),
    );
    assertEquals(await client.recoveryIntent(run), undefined);
    assertEquals(await candidates(), []);
  });
  it("fails closed when pending recovery search is incomplete", async () => {
    const { candidates } = createWatchdogClient(
      "veryfront/veryfront-code",
      "test-token",
      (url) =>
        Promise.resolve(Response.json(
          url.pathname === "/search/issues"
            ? { items: [], incomplete_results: true }
            : { workflow_runs: [] },
        )),
    );
    await assertRejects(() => candidates());
  });
  it("fails closed on unavailable API data", async () => {
    const { client } = createWatchdogClient(
      "veryfront/veryfront-code",
      "test-token",
      () => Promise.resolve(new Response(null, { status: 403 })),
    );
    await assertRejects(() => client.inspect(run.id));
  });
});
