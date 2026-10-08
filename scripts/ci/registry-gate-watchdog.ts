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
export interface WatchdogClient {
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
    gate.started_at !== null
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
    if (
      other.run.head_branch === "main" &&
      other.run.run_number > run.run_number &&
      otherGate.steps.some((step) =>
        DISPATCH_STEPS.has(step.name) && step.conclusion === "success"
      )
    ) return no("newer main gate dispatched, no action");
  }
  return { recover: true, message: "stuck, no holder, would recover", minutes };
}

export async function recoverGate(
  client: WatchdogClient,
  id: number,
  options: { dryRun: boolean; now?: () => number },
) {
  const now = options.now ?? Date.now;
  let candidate = await client.inspect(id);
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
  // Recheck holders and newer dispatches after cancellation too.
  const after = decideRecovery(
    candidate,
    await client.others(candidate.run),
    now(),
  );
  if (!after.recover) return `Run ${id}: cancelled, but ${after.message}`;
  await client.rerunFailed(id);
  const message =
    `Recovered registry gate in run ${id}, queued without starting for ${
      Math.floor(decision.minutes)
    } min. Cancelled the run and reran only its cancelled jobs; no failed check was retried.`;
  await client.comment(candidate.run, message);
  return message;
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
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await fetchImpl(new URL(base + path), {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${method} ${path}: ${response.status}`);
    }
    return response.status === 204 || response.status === 202
      ? undefined as T
      : await response.json() as T;
  }
  async function list<T>(path: string, key?: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await request<T[] | Record<string, T[]>>(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
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
  const client: WatchdogClient = {
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
    comment: async (run, message) => {
      const pulls = await list<{ number: number; merged_at: string | null }>(
        `/commits/${run.head_sha}/pulls`,
      );
      for (const pull of pulls.filter((pull) => pull.merged_at)) {
        await request(`/issues/${pull.number}/comments`, "POST", {
          body:
            `${message}\n\nhttps://github.com/${repository}/actions/runs/${run.id}`,
        });
      }
    },
  };
  return { client, activeRuns };
}

if (import.meta.main) {
  const dryRun = Deno.args.includes("--dry-run");
  const runId = Deno.args.find((arg) => arg.startsWith("--run-id="))?.split(
    "=",
  )[1];
  const snapshot = Deno.args.find((arg) => arg.startsWith("--snapshot="))
    ?.slice("--snapshot=".length);
  let lines: string[];
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
    const { client, activeRuns } = createWatchdogClient(repository, token);
    if (runId && !/^[1-9][0-9]*$/.test(runId)) {
      throw new Error("Invalid run id");
    }
    const runs = runId
      ? [Number(runId)]
      : (await activeRuns()).filter((run) =>
        run.event === "push" && run.head_branch === "main"
      ).map((run) => run.id);
    lines = [];
    for (const id of runs) {
      lines.push(`Run ${id}: ${await recoverGate(client, id, { dryRun })}`);
    }
    if (!lines.length) lines.push("healthy, no action");
  }
  for (const line of lines) console.log(line);
  const summary = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (summary) {
    await Deno.writeTextFile(summary, lines.join("\n") + "\n", {
      append: true,
    });
  }
}
