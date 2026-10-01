/**
 * Decides whether a main run may publish the build its merge-queue run
 * already tested, and which number its release candidate carries.
 *
 * The merge queue tests the exact commit that lands on main, so the main run
 * can skip the tests and publish the queue run's artifacts when the queue run
 * of this workflow succeeded on the same SHA and its artifacts still exist.
 * The queue build already carries the RC version `<base>.<queue run number>`,
 * so a reused release is numbered by the queue run, not by the main run.
 *
 * Release numbers must grow in landing order, because the server pin skips a
 * candidate older than the one it already pins. A main run created between
 * the queue run and this run landed first. If any such run has published (or
 * may still publish) a number at or above the queue run number, this run falls
 * back to the full pipeline and its own, larger run number. Every main run
 * records its number as a `release-number-<n>` artifact before any release job
 * can start, so a finished run without one never published.
 *
 * A first attempt that cannot decide (GitHub API errors) runs the full pipeline
 * under its own run number, which is always above every earlier main run's.
 * A rerun always runs the full pipeline under its own run number, which is also
 * above any queue number an earlier attempt published for the same code. It
 * refuses to publish once a later commit has landed on main, because that
 * commit's release may carry a smaller number, and fails when it cannot check.
 */

export const RELEASE_NUMBER_ARTIFACT_PREFIX = "release-number-";

const WAIT_MS = 30 * 60 * 1000;
const EARLIER_DECISION_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 30 * 1000;
// Release-number artifacts are kept for 7 days. An older queue run could hide
// an earlier main run whose artifact already expired.
const MAX_QUEUE_RUN_AGE_MS = 6 * 24 * 60 * 60 * 1000;

export interface WorkflowRun {
  readonly id: number;
  readonly run_number: number;
  readonly event: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly created_at: string;
}

export interface RunArtifact {
  readonly name: string;
  readonly expired: boolean;
}

export interface ActionsClient {
  listMergeQueueRuns(sha: string): Promise<readonly WorkflowRun[]>;
  getRun(runId: number): Promise<WorkflowRun>;
  listMainRunsCreatedSince(createdAt: string): Promise<readonly WorkflowRun[]>;
  listArtifacts(runId: number): Promise<readonly RunArtifact[]>;
}

export interface ReleaseSourceInput {
  readonly eventName: string;
  readonly sha: string;
  readonly runId: number;
  readonly runNumber: number;
  readonly runAttempt: number;
  readonly requiredArtifacts: readonly string[];
}

export type ReleaseSource =
  | {
    readonly reuse: true;
    readonly testedRunId: number;
    readonly releaseNumber: number;
    readonly message: string;
  }
  | {
    readonly reuse: false;
    readonly releaseNumber: number;
    readonly message: string;
  };

export interface DecideOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly waitMs?: number;
  readonly earlierDecisionWaitMs?: number;
  readonly pollMs?: number;
}

interface Clock {
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly pollMs: number;
}

function fullPipeline(input: ReleaseSourceInput, reason: string): ReleaseSource {
  return {
    reuse: false,
    releaseNumber: input.runNumber,
    message: `no tested run for ${input.sha}, running full pipeline (${reason})`,
  };
}

/** The largest number a run recorded; reruns can record more than one. */
export function releaseNumberOf(artifacts: readonly RunArtifact[]): number | undefined {
  let largest: number | undefined;
  for (const artifact of artifacts) {
    if (!artifact.name.startsWith(RELEASE_NUMBER_ARTIFACT_PREFIX)) continue;
    const value = artifact.name.slice(RELEASE_NUMBER_ARTIFACT_PREFIX.length);
    if (!/^[1-9]\d*$/.test(value)) continue;
    largest = Math.max(largest ?? 0, Number(value));
  }
  return largest;
}

function isMainRelease(run: WorkflowRun): boolean {
  return run.event === "push" || run.event === "workflow_dispatch";
}

async function settle(
  client: ActionsClient,
  run: WorkflowRun,
  clock: Clock,
  deadline: number,
): Promise<WorkflowRun> {
  let current = run;
  while (current.status !== "completed" && clock.now() < deadline) {
    await clock.sleep(clock.pollMs);
    current = await client.getRun(current.id);
  }
  return current;
}

async function earlierReleaseBlocks(
  client: ActionsClient,
  input: ReleaseSourceInput,
  queueRun: WorkflowRun,
  clock: Clock,
  deadline: number,
): Promise<string | undefined> {
  const landedEarlier = (await client.listMainRunsCreatedSince(queueRun.created_at))
    .filter(isMainRelease)
    .filter((run) => run.run_number > queueRun.run_number && run.run_number < input.runNumber)
    .sort((left, right) => left.run_number - right.run_number);
  for (const run of landedEarlier) {
    let current = run;
    let releaseNumber = releaseNumberOf(await client.listArtifacts(run.id));
    // An earlier run usually decides within a minute of starting; wait for it
    // rather than give up the reuse.
    while (
      releaseNumber === undefined && current.status !== "completed" && clock.now() < deadline
    ) {
      await clock.sleep(clock.pollMs);
      current = await client.getRun(run.id);
      releaseNumber = releaseNumberOf(await client.listArtifacts(run.id));
    }
    if (releaseNumber === undefined) {
      if (current.status === "completed") continue;
      return `main run ${run.id} landed earlier and has not chosen its release number`;
    }
    if (releaseNumber >= queueRun.run_number) {
      return `main run ${run.id} landed earlier with release number ${releaseNumber}`;
    }
  }
  return undefined;
}

async function chooseReleaseSource(
  client: ActionsClient,
  input: ReleaseSourceInput,
  clock: Clock,
  options: DecideOptions,
): Promise<ReleaseSource> {
  if (input.eventName !== "push") {
    return fullPipeline(input, `${input.eventName} run`);
  }

  const candidates = [...await client.listMergeQueueRuns(input.sha)]
    .filter((run) => run.event === "merge_group")
    .sort((left, right) => right.run_number - left.run_number);
  if (candidates.length === 0) return fullPipeline(input, "no merge-queue run");

  const queueDeadline = clock.now() + (options.waitMs ?? WAIT_MS);
  let queueRun: WorkflowRun | undefined;
  for (const candidate of candidates) {
    const settled = await settle(client, candidate, clock, queueDeadline);
    if (settled.status === "completed" && settled.conclusion === "success") {
      queueRun = settled;
      break;
    }
  }
  if (queueRun === undefined) {
    return fullPipeline(input, "no successful merge-queue run");
  }
  if (clock.now() - Date.parse(queueRun.created_at) > MAX_QUEUE_RUN_AGE_MS) {
    return fullPipeline(input, `merge-queue run ${queueRun.id} is older than 6 days`);
  }

  const available = new Set(
    (await client.listArtifacts(queueRun.id))
      .filter((artifact) => !artifact.expired)
      .map((artifact) => artifact.name),
  );
  const missing = input.requiredArtifacts.filter((name) => !available.has(name));
  if (missing.length > 0) {
    return fullPipeline(
      input,
      `merge-queue run ${queueRun.id} is missing ${missing.join(", ")}`,
    );
  }

  const blocked = await earlierReleaseBlocks(
    client,
    input,
    queueRun,
    clock,
    clock.now() + (options.earlierDecisionWaitMs ?? EARLIER_DECISION_WAIT_MS),
  );
  if (blocked !== undefined) return fullPipeline(input, blocked);

  return {
    reuse: true,
    testedRunId: queueRun.id,
    releaseNumber: queueRun.run_number,
    message: `reusing merge-queue run ${queueRun.id} for ${input.sha}`,
  };
}

async function assertNothingLandedLater(
  client: ActionsClient,
  input: ReleaseSourceInput,
): Promise<void> {
  const ownRun = await client.getRun(input.runId);
  const landedLater = (await client.listMainRunsCreatedSince(ownRun.created_at))
    .filter(isMainRelease)
    .find((run) => run.run_number > input.runNumber);
  if (landedLater !== undefined) {
    throw new Error(
      `main run ${landedLater.id} landed later; a rerun of this run could pin older code, so publish from the newest main run instead`,
    );
  }
}

export async function decideReleaseSource(
  client: ActionsClient,
  input: ReleaseSourceInput,
  options: DecideOptions = {},
): Promise<ReleaseSource> {
  const clock: Clock = {
    sleep: options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    now: options.now ?? Date.now,
    pollMs: options.pollMs ?? POLL_MS,
  };
  if (input.runAttempt > 1) {
    await assertNothingLandedLater(client, input);
    return fullPipeline(input, `rerun attempt ${input.runAttempt}`);
  }
  try {
    return await chooseReleaseSource(client, input, clock, options);
  } catch (error) {
    return fullPipeline(
      input,
      `could not inspect merge-queue runs: ${error instanceof Error ? error.message : error}`,
    );
  }
}

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

const GITHUB_API_ORIGIN = "https://api.github.com";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createActionsClient(
  options: {
    readonly repository: string;
    readonly workflow: string;
    readonly token: string;
    readonly fetch?: FetchLike;
  },
): ActionsClient {
  if (!REPOSITORY_PATTERN.test(options.repository)) {
    throw new Error(`invalid repository ${options.repository}`);
  }
  const fetchImpl = options.fetch ?? fetch;
  const base = `/repos/${options.repository}`;

  async function get<T>(path: string): Promise<T> {
    const response = await fetchImpl(new URL(`${base}${path}`, GITHUB_API_ORIGIN), {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${path} answered ${response.status}`);
    }
    return await response.json() as T;
  }

  async function listRuns(query: string): Promise<WorkflowRun[]> {
    const runs: WorkflowRun[] = [];
    for (let page = 1;; page += 1) {
      const body = await get<{ workflow_runs: WorkflowRun[] }>(
        `/actions/workflows/${options.workflow}/runs?${query}&per_page=100&page=${page}`,
      );
      runs.push(...body.workflow_runs);
      if (body.workflow_runs.length < 100) return runs;
    }
  }

  return {
    listMergeQueueRuns: (sha) => listRuns(`event=merge_group&head_sha=${encodeURIComponent(sha)}`),
    getRun: (runId) => get<WorkflowRun>(`/actions/runs/${runId}`),
    listMainRunsCreatedSince: (createdAt) =>
      listRuns(`branch=main&created=${encodeURIComponent(">=" + createdAt)}`),
    listArtifacts: async (runId) =>
      (await get<{ artifacts: RunArtifact[] }>(
        `/actions/runs/${runId}/artifacts?per_page=100`,
      )).artifacts,
  };
}

export function formatOutputs(source: ReleaseSource): string {
  return [
    `reuse=${source.reuse}`,
    `run_id=${source.reuse ? source.testedRunId : ""}`,
    `release_number=${source.releaseNumber}`,
  ].join("\n") + "\n";
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.main) {
  const source = await decideReleaseSource(
    createActionsClient({
      repository: requireEnv("GITHUB_REPOSITORY"),
      workflow: "cicd.yml",
      token: requireEnv("GH_TOKEN"),
    }),
    {
      eventName: requireEnv("GITHUB_EVENT_NAME"),
      sha: requireEnv("GITHUB_SHA"),
      runId: Number(requireEnv("GITHUB_RUN_ID")),
      runNumber: Number(requireEnv("GITHUB_RUN_NUMBER")),
      runAttempt: Number(requireEnv("GITHUB_RUN_ATTEMPT")),
      requiredArtifacts: Deno.args,
    },
  );
  console.log(source.message);
  await Deno.writeTextFile(requireEnv("GITHUB_OUTPUT"), formatOutputs(source), {
    append: true,
  });
}
