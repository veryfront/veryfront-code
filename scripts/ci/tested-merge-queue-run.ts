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
 */

export const RELEASE_NUMBER_ARTIFACT_PREFIX = "release-number-";

const QUEUE_RUN_WAIT_MS = 30 * 60 * 1000;
const QUEUE_RUN_POLL_MS = 30 * 1000;

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
  readonly runNumber: number;
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
  readonly waitMs?: number;
  readonly pollMs?: number;
}

function fullPipeline(input: ReleaseSourceInput, reason: string): ReleaseSource {
  return {
    reuse: false,
    releaseNumber: input.runNumber,
    message: `no tested run for ${input.sha}, running full pipeline (${reason})`,
  };
}

async function settle(
  client: ActionsClient,
  run: WorkflowRun,
  options: DecideOptions,
): Promise<WorkflowRun> {
  const sleep = options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = options.pollMs ?? QUEUE_RUN_POLL_MS;
  let remainingMs = options.waitMs ?? QUEUE_RUN_WAIT_MS;
  let current = run;
  while (current.status !== "completed" && remainingMs > 0) {
    await sleep(pollMs);
    remainingMs -= pollMs;
    current = await client.getRun(current.id);
  }
  return current;
}

export function releaseNumberOf(artifacts: readonly RunArtifact[]): number | undefined {
  for (const artifact of artifacts) {
    if (!artifact.name.startsWith(RELEASE_NUMBER_ARTIFACT_PREFIX)) continue;
    const value = artifact.name.slice(RELEASE_NUMBER_ARTIFACT_PREFIX.length);
    if (/^[1-9]\d*$/.test(value)) return Number(value);
  }
  return undefined;
}

async function earlierReleaseBlocks(
  client: ActionsClient,
  input: ReleaseSourceInput,
  queueRun: WorkflowRun,
): Promise<string | undefined> {
  const runs = await client.listMainRunsCreatedSince(queueRun.created_at);
  const landedEarlier = runs
    .filter((run) => run.event === "push" || run.event === "workflow_dispatch")
    .filter((run) => run.run_number > queueRun.run_number && run.run_number < input.runNumber)
    .sort((left, right) => left.run_number - right.run_number);
  for (const run of landedEarlier) {
    const releaseNumber = releaseNumberOf(await client.listArtifacts(run.id));
    if (releaseNumber === undefined) {
      if (run.status === "completed") continue;
      return `main run ${run.id} landed earlier and has not chosen its release number`;
    }
    if (releaseNumber >= queueRun.run_number) {
      return `main run ${run.id} landed earlier with release number ${releaseNumber}`;
    }
  }
  return undefined;
}

export async function decideReleaseSource(
  client: ActionsClient,
  input: ReleaseSourceInput,
  options: DecideOptions = {},
): Promise<ReleaseSource> {
  if (input.eventName !== "push") {
    return fullPipeline(input, `${input.eventName} run`);
  }

  const candidates = [...await client.listMergeQueueRuns(input.sha)]
    .filter((run) => run.event === "merge_group")
    .sort((left, right) => right.run_number - left.run_number);
  if (candidates.length === 0) return fullPipeline(input, "no merge-queue run");

  let queueRun: WorkflowRun | undefined;
  for (const candidate of candidates) {
    const settled = await settle(client, candidate, options);
    if (settled.status === "completed" && settled.conclusion === "success") {
      queueRun = settled;
      break;
    }
  }
  if (queueRun === undefined) {
    return fullPipeline(input, "no successful merge-queue run");
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

  const blocked = await earlierReleaseBlocks(client, input, queueRun);
  if (blocked !== undefined) return fullPipeline(input, blocked);

  return {
    reuse: true,
    testedRunId: queueRun.id,
    releaseNumber: queueRun.run_number,
    message: `reusing merge-queue run ${queueRun.id} for ${input.sha}`,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createActionsClient(
  options: {
    readonly repository: string;
    readonly workflow: string;
    readonly token: string;
    readonly apiUrl?: string;
    readonly fetch?: FetchLike;
  },
): ActionsClient {
  const fetchImpl = options.fetch ?? fetch;
  const base = `${options.apiUrl ?? "https://api.github.com"}/repos/${options.repository}`;

  async function get<T>(path: string): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
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
      listRuns(`branch=main&created=${encodeURIComponent(`>=${createdAt}`)}`),
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
  const runNumber = Number(requireEnv("GITHUB_RUN_NUMBER"));
  const source = await decideReleaseSource(
    createActionsClient({
      repository: requireEnv("GITHUB_REPOSITORY"),
      workflow: "cicd.yml",
      token: requireEnv("GH_TOKEN"),
      apiUrl: Deno.env.get("GITHUB_API_URL"),
    }),
    {
      eventName: requireEnv("GITHUB_EVENT_NAME"),
      sha: requireEnv("GITHUB_SHA"),
      runNumber,
      requiredArtifacts: Deno.args,
    },
  );
  console.log(source.message);
  await Deno.writeTextFile(requireEnv("GITHUB_OUTPUT"), formatOutputs(source), {
    append: true,
  });
}
