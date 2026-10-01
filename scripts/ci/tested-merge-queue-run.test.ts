import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ActionsClient,
  createActionsClient,
  decideReleaseSource,
  formatOutputs,
  type ReleaseSourceInput,
  type RunArtifact,
  type WorkflowRun,
} from "./tested-merge-queue-run.ts";

const SHA = "b054050a4e0248689bb6ecfca1a182136cbf4465";
const REQUIRED = [`npm-compatibility-${SHA}`, "coverage-shard-1"];
const INPUT: ReleaseSourceInput = {
  eventName: "push",
  sha: SHA,
  runId: 36828511508,
  runNumber: 21212,
  runAttempt: 1,
  requiredArtifacts: REQUIRED,
};
const OWN_RUN_CREATED_AT = "2026-10-01T07:07:19Z";

function run(
  overrides: Partial<WorkflowRun> & Pick<WorkflowRun, "id" | "run_number">,
): WorkflowRun {
  return {
    event: "merge_group",
    status: "completed",
    conclusion: "success",
    created_at: "2026-10-01T06:36:40Z",
    ...overrides,
  };
}

function artifacts(...names: string[]): RunArtifact[] {
  return names.map((name) => ({ name, expired: false }));
}

class FakeActions implements ActionsClient {
  readonly polled: number[] = [];
  onPoll: (runId: number) => void = () => {};

  constructor(
    readonly queueRuns: WorkflowRun[],
    readonly artifactsByRun: Map<number, RunArtifact[]>,
    readonly mainRuns: WorkflowRun[] = [],
    readonly runUpdates: Map<number, WorkflowRun[]> = new Map(),
  ) {}

  listMergeQueueRuns(): Promise<readonly WorkflowRun[]> {
    return Promise.resolve(this.queueRuns);
  }

  getRun(runId: number): Promise<WorkflowRun> {
    this.polled.push(runId);
    this.onPoll(runId);
    if (runId === INPUT.runId) {
      return Promise.resolve(
        run({
          id: runId,
          run_number: INPUT.runNumber,
          event: "push",
          created_at: OWN_RUN_CREATED_AT,
        }),
      );
    }
    const next = this.runUpdates.get(runId)?.shift();
    if (next === undefined) throw new Error(`unexpected poll of ${runId}`);
    return Promise.resolve(next);
  }

  listMainRunsCreatedSince(): Promise<readonly WorkflowRun[]> {
    return Promise.resolve(this.mainRuns);
  }

  listArtifacts(runId: number): Promise<readonly RunArtifact[]> {
    return Promise.resolve(this.artifactsByRun.get(runId) ?? []);
  }
}

function fakeClock(start = Date.parse("2026-10-01T07:10:00Z")) {
  let now = start;
  return {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

describe("tested merge-queue run release source", () => {
  it("reuses a green queue run on the same SHA and numbers the release by it", async () => {
    const client = new FakeActions(
      [run({ id: 36825693208, run_number: 21200 })],
      new Map([[36825693208, artifacts(...REQUIRED)]]),
    );

    const source = await decideReleaseSource(client, INPUT, fakeClock());

    assertEquals(source, {
      reuse: true,
      testedRunId: 36825693208,
      releaseNumber: 21200,
      message: `reusing merge-queue run 36825693208 for ${SHA}`,
    });
    assertEquals(
      formatOutputs(source),
      "reuse=true\nrun_id=36825693208\nrelease_number=21200\n",
    );
  });

  it("runs the full pipeline when no queue run tested the SHA", async () => {
    const source = await decideReleaseSource(new FakeActions([], new Map()), INPUT, fakeClock());

    assertEquals(source, {
      reuse: false,
      releaseNumber: 21212,
      message: `no tested run for ${SHA}, running full pipeline (no merge-queue run)`,
    });
    assertEquals(formatOutputs(source), "reuse=false\nrun_id=\nrelease_number=21212\n");
  });

  it("runs the full pipeline for manual dispatches", async () => {
    const source = await decideReleaseSource(
      new FakeActions([run({ id: 1, run_number: 21200 })], new Map()),
      { ...INPUT, eventName: "workflow_dispatch" },
      fakeClock(),
    );

    assertEquals(source.reuse, false);
    assertEquals(source.releaseNumber, 21212);
  });

  it("ignores queue runs that did not succeed", async () => {
    const source = await decideReleaseSource(
      new FakeActions(
        [run({ id: 7, run_number: 21200, conclusion: "failure" })],
        new Map([[7, artifacts(...REQUIRED)]]),
      ),
      INPUT,
      fakeClock(),
    );

    assertEquals(source.reuse, false);
    assertEquals(
      source.message,
      `no tested run for ${SHA}, running full pipeline (no successful merge-queue run)`,
    );
  });

  it("falls back to an older green attempt when the newest queue run failed", async () => {
    const source = await decideReleaseSource(
      new FakeActions(
        [
          run({ id: 6, run_number: 21190 }),
          run({ id: 7, run_number: 21200, conclusion: "failure" }),
        ],
        new Map([[6, artifacts(...REQUIRED)]]),
      ),
      INPUT,
      fakeClock(),
    );

    assertEquals(source.reuse && source.testedRunId, 6);
    assertEquals(source.releaseNumber, 21190);
  });

  it("waits for a queue run that is still finishing", async () => {
    const client = new FakeActions(
      [run({ id: 9, run_number: 21200, status: "in_progress", conclusion: null })],
      new Map([[9, artifacts(...REQUIRED)]]),
      [],
      new Map([[9, [
        run({ id: 9, run_number: 21200, status: "in_progress", conclusion: null }),
        run({ id: 9, run_number: 21200 }),
      ]]]),
    );

    const source = await decideReleaseSource(client, INPUT, fakeClock());

    assertEquals(client.polled, [9, 9]);
    assertEquals(source.reuse, true);
  });

  it("stops waiting for a queue run after the wait budget", async () => {
    const client = new FakeActions(
      [run({ id: 9, run_number: 21200, status: "in_progress", conclusion: null })],
      new Map([[9, artifacts(...REQUIRED)]]),
      [],
      new Map([[9, [
        run({ id: 9, run_number: 21200, status: "in_progress", conclusion: null }),
      ]]]),
    );

    const source = await decideReleaseSource(client, INPUT, {
      ...fakeClock(),
      waitMs: 1000,
      pollMs: 1000,
    });

    assertEquals(source.reuse, false);
  });

  it("runs the full pipeline when the queue artifacts are gone", async () => {
    const source = await decideReleaseSource(
      new FakeActions(
        [run({ id: 5, run_number: 21200 })],
        new Map([[5, [
          { name: `npm-compatibility-${SHA}`, expired: true },
          { name: "coverage-shard-1", expired: false },
        ]]]),
      ),
      INPUT,
      fakeClock(),
    );

    assertEquals(
      source.message,
      `no tested run for ${SHA}, running full pipeline (merge-queue run 5 is missing npm-compatibility-${SHA})`,
    );
    assertEquals(source.releaseNumber, 21212);
  });

  it("keeps release numbers in landing order after an earlier direct push", async () => {
    // a801199 landed outside the queue (run 21209) while b054050's queue run
    // 21200 was testing. Publishing rc.21200 after rc.21209 would make the
    // server pin skip the newer code as an older candidate.
    const source = await decideReleaseSource(
      new FakeActions(
        [run({ id: 5, run_number: 21200 })],
        new Map([
          [5, artifacts(...REQUIRED)],
          [40, artifacts("release-number-21209")],
        ]),
        [run({ id: 40, run_number: 21209, event: "push" })],
      ),
      INPUT,
      fakeClock(),
    );

    assertEquals(source, {
      reuse: false,
      releaseNumber: 21212,
      message:
        `no tested run for ${SHA}, running full pipeline (main run 40 landed earlier with release number 21209)`,
    });
  });

  it("falls back when an earlier main run has not chosen its release number", async () => {
    const queued = run({
      id: 40,
      run_number: 21209,
      event: "push",
      status: "queued",
      conclusion: null,
    });
    const client = new FakeActions(
      [run({ id: 5, run_number: 21200 })],
      new Map([[5, artifacts(...REQUIRED)]]),
      [queued],
      new Map([[40, [queued, queued]]]),
    );

    const source = await decideReleaseSource(client, INPUT, {
      ...fakeClock(),
      pollMs: 1000,
      earlierDecisionWaitMs: 2000,
    });

    assertEquals(client.polled, [40, 40]);
    assertEquals(source.reuse, false);
    assertEquals(
      source.message,
      `no tested run for ${SHA}, running full pipeline (main run 40 landed earlier and has not chosen its release number)`,
    );
  });

  it("waits for an earlier main run to choose its release number", async () => {
    const queued = run({
      id: 40,
      run_number: 21209,
      event: "push",
      status: "in_progress",
      conclusion: null,
    });
    const client = new FakeActions(
      [run({ id: 5, run_number: 21200 })],
      new Map([[5, artifacts(...REQUIRED)]]),
      [queued],
      new Map([[40, [queued]]]),
    );
    client.onPoll = () => client.artifactsByRun.set(40, artifacts("release-number-21190"));

    const source = await decideReleaseSource(client, INPUT, fakeClock());

    assertEquals(client.polled, [40]);
    assertEquals(source.reuse && source.releaseNumber, 21200);
  });

  it("reads the largest number an earlier rerun recorded", async () => {
    const source = await decideReleaseSource(
      new FakeActions(
        [run({ id: 5, run_number: 21200 })],
        new Map([
          [5, artifacts(...REQUIRED)],
          [40, artifacts("release-number-21190", "release-number-21209")],
        ]),
        [run({ id: 40, run_number: 21209, event: "push" })],
      ),
      INPUT,
      fakeClock(),
    );

    assertEquals(source.reuse, false);
    assertEquals(source.releaseNumber, 21212);
  });

  it("does not reuse a queue run older than the release-number retention", async () => {
    const source = await decideReleaseSource(
      new FakeActions(
        [run({ id: 5, run_number: 21200, created_at: "2026-09-24T06:36:40Z" })],
        new Map([[5, artifacts(...REQUIRED)]]),
      ),
      INPUT,
      fakeClock(),
    );

    assertEquals(
      source.message,
      `no tested run for ${SHA}, running full pipeline (merge-queue run 5 is older than 6 days)`,
    );
  });

  it("runs the full pipeline under its own number when GitHub cannot be read", async () => {
    const client = new FakeActions([], new Map());
    client.listMergeQueueRuns = () => Promise.reject(new Error("GitHub API answered 502"));

    const source = await decideReleaseSource(client, INPUT, fakeClock());

    assertEquals(source, {
      reuse: false,
      releaseNumber: 21212,
      message:
        `no tested run for ${SHA}, running full pipeline (could not inspect merge-queue runs: GitHub API answered 502)`,
    });
  });

  it("fails a rerun that cannot read GitHub instead of guessing", async () => {
    const client = new FakeActions([], new Map());
    client.listMergeQueueRuns = () => Promise.reject(new Error("GitHub API answered 502"));

    await assertRejects(
      () => decideReleaseSource(client, { ...INPUT, runAttempt: 2 }, fakeClock()),
      Error,
      "GitHub API answered 502",
    );
  });

  it("refuses a rerun whose release would outrank a later-landed release", async () => {
    // b054050 landed after this commit and already published rc.21200; a
    // rerun publishing rc.21212 for older code would move the pin backwards.
    const client = new FakeActions([], new Map([[50, artifacts("release-number-21200")]]), [
      run({ id: 50, run_number: 21215, event: "push" }),
    ]);

    await assertRejects(
      () => decideReleaseSource(client, { ...INPUT, runAttempt: 2 }, fakeClock()),
      Error,
      "main run 50 landed later and chose release number 21200; publishing 21212 from this rerun would pin older code",
    );
  });

  it("allows a rerun when later-landed releases are newer", async () => {
    const client = new FakeActions([], new Map([[50, artifacts("release-number-21215")]]), [
      run({ id: 50, run_number: 21215, event: "push" }),
      run({ id: 51, run_number: 21216, event: "push", status: "queued", conclusion: null }),
    ]);

    const source = await decideReleaseSource(client, { ...INPUT, runAttempt: 2 }, fakeClock());

    assertEquals(source.releaseNumber, 21212);
  });

  it("reuses when earlier main runs published smaller numbers or never published", async () => {
    const source = await decideReleaseSource(
      new FakeActions(
        [run({ id: 5, run_number: 21200 })],
        new Map([
          [5, artifacts(...REQUIRED)],
          [41, artifacts("release-number-21194", "veryfront-linux-x64")],
        ]),
        [
          run({ id: 41, run_number: 21205, event: "push" }),
          run({ id: 42, run_number: 21206, event: "push", conclusion: "failure" }),
          run({ id: 43, run_number: 21207, event: "pull_request", status: "queued" }),
          run({ id: 44, run_number: 21199, event: "push", status: "queued" }),
          run({ id: 45, run_number: 21213, event: "push", status: "queued" }),
        ],
      ),
      INPUT,
      fakeClock(),
    );

    assertEquals(source.reuse, true);
    assertEquals(source.releaseNumber, 21200);
  });

  it("pages GitHub run lists and authenticates every request", async () => {
    const requests: string[] = [];
    const pages = [
      Array.from({ length: 100 }, (_, index) => run({ id: index, run_number: index + 1 })),
      [run({ id: 100, run_number: 101 })],
    ];
    const client = createActionsClient({
      repository: "veryfront/veryfront-code",
      workflow: "cicd.yml",
      token: "token",
      fetch: (url, init) => {
        requests.push(url.href);
        assertEquals(new Headers(init?.headers).get("authorization"), "Bearer token");
        if (url.pathname.includes("/artifacts")) {
          return Promise.resolve(Response.json({ artifacts: artifacts("a") }));
        }
        if (url.pathname.endsWith("/actions/runs/3")) {
          return Promise.resolve(Response.json(run({ id: 3, run_number: 3 })));
        }
        return Promise.resolve(Response.json({ workflow_runs: pages.shift() ?? [] }));
      },
    });

    assertEquals((await client.listMergeQueueRuns(SHA)).length, 101);
    assertEquals((await client.listMainRunsCreatedSince("2026-10-01T06:36:40Z")).length, 0);
    assertEquals(await client.listArtifacts(3), artifacts("a"));
    assertEquals((await client.getRun(3)).id, 3);
    assertEquals(requests, [
      `https://api.github.com/repos/veryfront/veryfront-code/actions/workflows/cicd.yml/runs?event=merge_group&head_sha=${SHA}&per_page=100&page=1`,
      `https://api.github.com/repos/veryfront/veryfront-code/actions/workflows/cicd.yml/runs?event=merge_group&head_sha=${SHA}&per_page=100&page=2`,
      "https://api.github.com/repos/veryfront/veryfront-code/actions/workflows/cicd.yml/runs?branch=main&created=%3E%3D2026-10-01T06%3A36%3A40Z&per_page=100&page=1",
      "https://api.github.com/repos/veryfront/veryfront-code/actions/runs/3/artifacts?per_page=100",
      "https://api.github.com/repos/veryfront/veryfront-code/actions/runs/3",
    ]);
  });

  it("only talks to the GitHub API for a well-formed repository", () => {
    assertThrows(
      () =>
        createActionsClient({
          repository: "evil.example/../x?",
          workflow: "cicd.yml",
          token: "token",
        }),
      Error,
      "invalid repository",
    );
  });

  it("fails loudly on GitHub API errors", async () => {
    const client = createActionsClient({
      repository: "veryfront/veryfront-code",
      workflow: "cicd.yml",
      token: "token",
      fetch: () => Promise.resolve(new Response("nope", { status: 502 })),
    });

    await assertRejects(
      () => client.getRun(1),
      Error,
      "GitHub API /actions/runs/1 answered 502",
    );
  });
});
