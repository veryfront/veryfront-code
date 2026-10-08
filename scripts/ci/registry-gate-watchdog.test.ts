import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createWatchdogClient,
  decideRecovery,
  type Job,
  recoverGate,
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
    const api: WatchdogClient = {
      inspect: () => Promise.resolve({ run, jobs }),
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
    assertEquals(calls, ["cancel", "rerun-failed", "comment"]);
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
      assertEquals(calls, ["cancel", "rerun-failed", "comment"]);
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
    assertEquals(calls, ["cancel", "comment"]);
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
    assertEquals(calls, ["cancel"]);
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
            : Response.json({ id: 1 }, { status: 201 }),
        );
      },
    );
    await client.comment(run, "Recovered registry gate");
    assertEquals(calls, [
      `GET /repos/veryfront/veryfront-code/commits/${run.head_sha}/pulls`,
      "POST /repos/veryfront/veryfront-code/issues/5001/comments",
    ]);
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
