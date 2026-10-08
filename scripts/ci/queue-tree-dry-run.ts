/** Measure PR-to-queue reuse eligibility without changing any required check. */
interface DryRunOptions {
  readonly repository: string;
  readonly headRef: string;
  readonly tree: string;
  readonly token: string;
  readonly fetch?: (url: URL, init?: RequestInit) => Promise<Response>;
}

interface PullRequestRun {
  readonly id: number;
  readonly event: string;
  readonly head_sha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly pull_requests: readonly { readonly number: number }[];
}

/** A miss always retains the full pipeline, including lookup failures. */
export async function measureQueueTree(options: DryRunOptions): Promise<string> {
  const miss = (reason: string) =>
    `would not reuse (tree ${options.tree}): ${reason}; full pipeline retained`;
  const queued = /^gh-readonly-queue\/main\/pr-([1-9]\d*)-[a-f0-9]{40}$/.exec(options.headRef);
  if (
    !queued || !/^[a-f0-9]{40}$/.test(options.tree) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.repository)
  ) {
    return miss("unsupported queue identity");
  }
  const pr = Number(queued[1]);
  const fetchImpl = options.fetch ?? fetch;
  async function get<T>(path: string): Promise<T> {
    const response = await fetchImpl(
      new URL(`/repos/${options.repository}${path}`, "https://api.github.com"),
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${options.token}`,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!response.ok) throw new Error("GitHub lookup unavailable");
    return await response.json() as T;
  }
  try {
    const pull = await get<{ head: { sha: string } }>(`/pulls/${pr}`);
    const runs = await get<{ workflow_runs: PullRequestRun[] }>(
      `/actions/workflows/cicd.yml/runs?event=pull_request&status=success&head_sha=${
        encodeURIComponent(pull.head.sha)
      }&per_page=1`,
    );
    const latest = runs.workflow_runs[0];
    if (
      !latest || latest.event !== "pull_request" || latest.head_sha !== pull.head.sha ||
      latest.status !== "completed" || latest.conclusion !== "success" ||
      !latest.pull_requests.some((candidate) => candidate.number === pr)
    ) {
      return miss("latest PR run is not eligible");
    }
    const artifacts = await get<{ artifacts: { name: string; expired: boolean }[] }>(
      `/actions/runs/${latest.id}/artifacts?per_page=100`,
    );
    const trees = artifacts.artifacts.filter((artifact) =>
      artifact.name.startsWith("tested-tree-")
    );
    if (
      trees.length !== 1 || trees[0]!.expired ||
      !/^tested-tree-[a-f0-9]{40}$/.test(trees[0]!.name)
    ) {
      return miss("missing or ambiguous tested tree");
    }
    if (trees[0]!.name !== `tested-tree-${options.tree}`) return miss("tree differs");
    return `would reuse run ${latest.id} (tree ${options.tree}); dry run, full pipeline retained`;
  } catch {
    return miss("GitHub lookup unavailable");
  }
}

if (import.meta.main) {
  const message = await measureQueueTree({
    repository: Deno.env.get("GITHUB_REPOSITORY") ?? "",
    headRef: Deno.env.get("QUEUE_HEAD_REF") ?? "",
    tree: Deno.env.get("QUEUE_TREE") ?? "",
    token: Deno.env.get("GH_TOKEN") ?? "",
  });
  console.log(message);
  await Deno.writeTextFile(
    Deno.env.get("GITHUB_STEP_SUMMARY")!,
    `## Queue tree dry run\n\n${message}\n`,
    { append: true },
  );
}
