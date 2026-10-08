/** Recover only an RC dispatch job that never started. All release gates stay intact. */
export interface Run {
  id: number;
  run_number: number;
  run_attempt: number;
  event: string;
  head_branch: string;
  path: string;
  head_sha: string;
  status: string;
  created_at: string;
}
export interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  started_at: string | null;
  steps: { name: string; conclusion: string | null }[];
}
export interface Inspection {
  run: Run;
  jobs: Job[];
}
export interface RecoveryIntent {
  runId: number;
  attempt: number;
  sha: string;
  gateId: number;
}
export interface WatchdogClient {
  recoveryIntent(run: Run): Promise<RecoveryIntent | undefined>;
  remember(candidate: Inspection): Promise<void>;
  inspect(id: number): Promise<Inspection>;
  others(run: Run): Promise<Inspection[]>;
  cancel(id: number): Promise<void>;
  completed(id: number): Promise<Job[]>;
  rerunFailed(id: number): Promise<void>;
  comment(run: Run, message: string): Promise<void>;
}
const GATE = "quality gate (registry)";
const SAFE_RESULTS = new Set(["success", "skipped", "neutral"]);
const DISPATCH_STEPS = new Set([
  "Trigger server deploy",
  "Trigger job-runner deploy",
  "Trigger sandbox deploy",
]);

export function decideRecovery(
  candidate: Inspection,
  others: Inspection[],
  now: number,
) {
  const { run, jobs } = candidate;
  const gate = jobs.find((job) => job.name === GATE);
  const no = (message: string) => ({ recover: false, message, minutes: 0 });
  if (
    run.event !== "push" || run.head_branch !== "main" ||
    run.path.split("@")[0] !== ".github/workflows/cicd.yml" ||
    run.status === "completed" || !gate || gate.status !== "queued" ||
    gate.steps.length !== 0
  ) return no("healthy, no action");
  const minutes = (now - Date.parse(gate.created_at)) / 60_000;
  if (!Number.isFinite(minutes) || minutes <= 15) {
    return no("healthy, no action");
  }
  // A successful prerelease identifies the RC path, excluding stable release work.
  if (
    !jobs.some((job) =>
      job.name === "prerelease" && job.conclusion === "success"
    )
  ) {
    return no("not an RC release, no action");
  }
  if (
    jobs.some((job) =>
      job.id !== gate.id &&
      (job.status !== "completed" || !SAFE_RESULTS.has(job.conclusion ?? ""))
    )
  ) {
    return no("other unfinished or failed jobs, no action");
  }
  for (const other of others) {
    if (other.run.id === run.id) continue;
    const otherGate = other.jobs.find((job) => job.name === GATE);
    if (!otherGate) continue;
    // Include other branches: they use the same dispatch lock.
    if (otherGate.status !== "completed") {
      return no("another gate holds or queues the lock, no action");
    }
    if (hasNewerDispatch(run, [other])) {
      return no("newer main gate dispatched, no action");
    }
  }
  return { recover: true, message: "stuck, no holder, would recover", minutes };
}

function hasNewerDispatch(run: Run, others: Inspection[]): boolean {
  return others.some((other) =>
    other.run.id !== run.id && other.run.head_branch === "main" &&
    other.run.run_number > run.run_number &&
    other.jobs.some((job) =>
      job.name === GATE &&
      job.steps.some((step) =>
        DISPATCH_STEPS.has(step.name) && step.conclusion === "success"
      )
    )
  );
}

async function finishRecovery(
  client: WatchdogClient,
  candidate: Inspection,
  minutes: number,
) {
  const { run } = candidate;
  if (hasNewerDispatch(run, await client.others(run))) {
    const message =
      `Run ${run.id}: cancelled; newer main gate dispatched, no action`;
    await client.comment(run, message);
    return message;
  }
  await client.rerunFailed(run.id);
  const message =
    `Recovered registry gate in run ${run.id}, queued without starting for ${
      Math.floor(minutes)
    } min. Cancelled the run and reran only its cancelled jobs; no failed check was retried.`;
  await client.comment(run, message);
  return message;
}

export async function recoverGate(
  client: WatchdogClient,
  id: number,
  options: { dryRun: boolean; now?: () => number },
) {
  const now = options.now ?? Date.now;
  let candidate = await client.inspect(id);
  const intent = await client.recoveryIntent(candidate.run);
  if (intent && intent.sha === candidate.run.head_sha && intent.runId === id) {
    if (candidate.run.run_attempt > intent.attempt) {
      const message =
        `Run ${id}: recovery already accepted as attempt ${candidate.run.run_attempt}, no action`;
      if (!options.dryRun) await client.comment(candidate.run, message);
      return message;
    }
    const cancelledGate = candidate.jobs.find((job) =>
      job.id === intent.gateId
    );
    if (
      candidate.run.status === "completed" &&
      candidate.run.run_attempt === intent.attempt &&
      cancelledGate?.conclusion === "cancelled"
    ) {
      // A durable intent authorizes only the same zero-step cancellation. All
      // other original checks must still be successful, never failed/cancelled.
      const projected = {
        run: { ...candidate.run, status: "in_progress" },
        jobs: candidate.jobs.map((job) =>
          job.id === intent.gateId
            ? { ...job, status: "queued", conclusion: null }
            : job
        ),
      };
      const resumed = decideRecovery(projected, [], now());
      if (!resumed.recover) {
        throw new Error(
          `Run ${id}: incomplete recovery is no longer safe; refusing rerun`,
        );
      }
      if (options.dryRun) {
        return "verified cancelled gate with pending recovery, would rerun";
      }
      return await finishRecovery(client, candidate, resumed.minutes);
    }
  }
  let decision = decideRecovery(candidate, [], now());
  if (!decision.recover) return decision.message;
  decision = decideRecovery(
    candidate,
    await client.others(candidate.run),
    now(),
  );
  if (!decision.recover || options.dryRun) return decision.message;
  // Re-read both the target and lock holders immediately before mutation.
  candidate = await client.inspect(id);
  decision = decideRecovery(
    candidate,
    await client.others(candidate.run),
    now(),
  );
  if (!decision.recover) return decision.message;
  const gate = candidate.jobs.find((job) => job.name === GATE)!;
  await client.remember(candidate);
  await client.cancel(id);
  const cancelled = await client.completed(id);
  const cancelledGate = cancelled.find((job) => job.id === gate.id);
  // GitHub fills started_at on cancellation even for a job with no steps.
  // Compare steps instead, and permit only the target job to be cancelled.
  if (
    !cancelledGate || cancelledGate.conclusion !== "cancelled" ||
    cancelledGate.steps.length !== 0 ||
    cancelled.some((job) =>
      job.id !== gate.id && !SAFE_RESULTS.has(job.conclusion ?? "")
    ) ||
    cancelled.length !== candidate.jobs.length
  ) {
    throw new Error(
      `Run ${id}: cancellation changed other work; refusing rerun`,
    );
  }
  // A durable intent survives a failed post-cancel read or rerun response.
  // A later scan verifies the attempt before trying the unstarted work again.
  return await finishRecovery(client, candidate, decision.minutes);
}

export async function scanGates(
  client: WatchdogClient,
  ids: number[],
  options: { dryRun: boolean; now?: () => number },
) {
  const lines: string[] = [];
  let failed = false;
  for (const id of ids) {
    try {
      lines.push(`Run ${id}: ${await recoverGate(client, id, options)}`);
    } catch (error) {
      failed = true;
      lines.push(
        `Run ${id}: ERROR: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (!lines.length) lines.push("healthy, no action");
  return { lines, failed };
}

type FetchLike = (url: URL, init: RequestInit) => Promise<Response>;
export function createWatchdogClient(
  repository: string,
  token: string,
  fetchImpl: FetchLike = fetch,
) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Invalid repository");
  }
  const base = `https://api.github.com/repos/${repository}`;
  const pendingHeading = "Registry gate watchdog pending recovery";
  interface Comment {
    id: number;
    body: string;
    user: { login: string };
  }
  const marker = (id: number) => `<!-- registry-gate-watchdog:${id} -->`;
  const trusted = (comment: Comment) =>
    comment.user.login === "github-actions[bot]";
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await fetchImpl(
      new URL(
        path.startsWith("/search/")
          ? "https://api.github.com" + path
          : base + path,
      ),
      {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub API ${method} ${path}: ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) as T : undefined as T;
  }
  async function list<T>(path: string, key?: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await request<T[] | Record<string, T[]>>(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      if (
        path.startsWith("/search/") &&
        (data as unknown as Record<string, unknown>).incomplete_results === true
      ) {
        throw new Error("GitHub search is incomplete; refusing recovery scan");
      }
      const batch = key ? (data as Record<string, T[]>)[key]! : data as T[];
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error(
      "GitHub listing reached 1000 items; refusing an incomplete decision",
    );
  }
  const listRuns = (query: string) =>
    list<Run>(`/actions/workflows/cicd.yml/runs?${query}`, "workflow_runs");
  async function activeRuns() {
    const runs = await Promise.all(
      ["queued", "in_progress", "waiting", "pending", "requested"].map((
        status,
      ) => listRuns(`status=${status}`)),
    );
    return [...new Map(runs.flat().map((run) => [run.id, run])).values()];
  }
  async function inspect(id: number): Promise<Inspection> {
    const run = await request<Run>(`/actions/runs/${id}`);
    // The attempt endpoint avoids a previous attempt's failed/cancelled jobs.
    const jobs = await list<Job>(
      `/actions/runs/${id}/attempts/${run.run_attempt}/jobs`,
      "jobs",
    );
    return { run, jobs };
  }
  async function mergedPull(run: Run) {
    const pulls = await list<{ number: number; merged_at: string | null }>(
      `/commits/${run.head_sha}/pulls`,
    );
    return pulls.find((pull) => pull.merged_at)?.number;
  }
  async function recoveryComment(run: Run) {
    const pull = await mergedPull(run);
    if (!pull) return { pull, comment: undefined };
    const comments = await list<Comment>(`/issues/${pull}/comments`);
    return {
      pull,
      comment: comments.find((comment) =>
        trusted(comment) && comment.body.startsWith(marker(run.id))
      ),
    };
  }
  function parseIntent(comment: Comment): RecoveryIntent | undefined {
    if (!trusted(comment) || !comment.body.includes(pendingHeading)) {
      return undefined;
    }
    const match = comment.body.match(/<!-- intent:(.+) -->/);
    if (!match) return undefined;
    const intent = JSON.parse(match[1]!) as RecoveryIntent;
    if (
      ![intent.runId, intent.attempt, intent.gateId].every((n) =>
        Number.isSafeInteger(n) && n > 0
      ) || !/^[a-f0-9]{40}$/.test(intent.sha) ||
      !comment.body.startsWith(marker(intent.runId))
    ) throw new Error("Invalid persisted recovery intent");
    return intent;
  }
  async function writeComment(run: Run, body: string) {
    const { pull, comment } = await recoveryComment(run);
    if (!pull) {
      throw new Error(
        `Run ${run.id}: no merged PR for durable recovery intent`,
      );
    }
    await request(
      comment ? `/issues/comments/${comment.id}` : `/issues/${pull}/comments`,
      comment ? "PATCH" : "POST",
      { body: marker(run.id) + "\n" + body },
    );
  }
  async function pendingRuns() {
    const query = encodeURIComponent(
      `repo:${repository} is:pr is:merged in:comments "${pendingHeading}"`,
    );
    const pulls = await list<{ number: number }>(
      `/search/issues?q=${query}`,
      "items",
    );
    const ids: number[] = [];
    for (const pull of pulls) {
      const comments = await list<Comment>(`/issues/${pull.number}/comments`);
      for (const comment of comments) {
        const intent = parseIntent(comment);
        if (intent) ids.push(intent.runId);
      }
    }
    return ids;
  }
  const client: WatchdogClient = {
    recoveryIntent: async (run) => {
      const { comment } = await recoveryComment(run);
      return comment ? parseIntent(comment) : undefined;
    },
    remember: async (candidate) => {
      const gate = candidate.jobs.find((job) => job.name === GATE)!;
      const intent: RecoveryIntent = {
        runId: candidate.run.id,
        attempt: candidate.run.run_attempt,
        sha: candidate.run.head_sha,
        gateId: gate.id,
      };
      await writeComment(
        candidate.run,
        `${pendingHeading}\n<!-- intent:${
          JSON.stringify(intent)
        } -->\nRun ${intent.runId}: cancellation and recovery not yet confirmed.`,
      );
    },
    inspect,
    others: async (run) => {
      const runs = [
        ...await activeRuns(),
        ...await listRuns(
          `branch=main&created=${encodeURIComponent(">=" + run.created_at)}`,
        ),
      ];
      const ids = [...new Set(runs.map((other) => other.id))].filter((id) =>
        id !== run.id
      );
      const inspections: Inspection[] = [];
      for (const id of ids) inspections.push(await inspect(id));
      return inspections;
    },
    cancel: (id) => request(`/actions/runs/${id}/cancel`, "POST"),
    completed: async (id) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const inspected = await inspect(id);
        if (inspected.run.status === "completed") return inspected.jobs;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      throw new Error(`Run ${id}: cancellation did not finish; refusing rerun`);
    },
    rerunFailed: (id) =>
      request(`/actions/runs/${id}/rerun-failed-jobs`, "POST"),
    comment: (run, message) =>
      writeComment(
        run,
        `${message}\n\nhttps://github.com/${repository}/actions/runs/${run.id}`,
      ),
  };
  async function candidates() {
    const active = (await activeRuns()).filter((run) =>
      run.event === "push" && run.head_branch === "main"
    ).map((run) => run.id);
    return [...new Set([...await pendingRuns(), ...active])];
  }
  return { client, activeRuns, candidates };
}

if (import.meta.main) {
  const dryRun = Deno.args.includes("--dry-run");
  const runId = Deno.args.find((arg) => arg.startsWith("--run-id="))?.split(
    "=",
  )[1];
  const snapshot = Deno.args.find((arg) => arg.startsWith("--snapshot="))
    ?.slice("--snapshot=".length);
  let lines: string[];
  let failed = false;
  if (snapshot) {
    if (!dryRun) throw new Error("Historical snapshots require --dry-run");
    const data = JSON.parse(await Deno.readTextFile(snapshot)) as {
      candidate: Inspection;
      others: Inspection[];
      now: string;
    };
    lines = [
      `Historical snapshot, run ${data.candidate.run.id}: ${
        decideRecovery(data.candidate, data.others, Date.parse(data.now))
          .message
      }`,
    ];
  } else {
    const repository = Deno.env.get("GITHUB_REPOSITORY");
    const token = Deno.env.get("GH_TOKEN");
    if (!repository || !token) {
      throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");
    }
    const { client, candidates } = createWatchdogClient(repository, token);
    if (runId && !/^[1-9][0-9]*$/.test(runId)) {
      throw new Error("Invalid run id");
    }
    const runs = runId ? [Number(runId)] : await candidates();
    ({ lines, failed } = await scanGates(client, runs, { dryRun }));
  }
  for (const line of lines) console.log(line);
  const summary = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (summary) {
    await Deno.writeTextFile(summary, lines.join("\n") + "\n", {
      append: true,
    });
  }
  if (failed) Deno.exit(1);
}
