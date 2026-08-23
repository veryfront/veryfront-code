const BOTS = new Map([
  ["coderabbitai[bot]", 136622811],
  ["chatgpt-codex-connector[bot]", 199175422],
]);
const CODERABBIT_LOGIN = "coderabbitai[bot]";
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const CODEX_NO_FINDINGS = "Codex Review: Didn't find any major issues.";
const CODEX_REVIEWED_COMMIT = /\*\*Reviewed commit:\*\* `([0-9a-f]{10})`/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SUBMITTED_REVIEW_STATES = new Set(["APPROVED", "COMMENTED"]);
const MAX_ITEMS_PER_SOURCE = 500;
/** @type {(ref: string) => Promise<string | undefined>} */
const NO_COMMIT = () => Promise.resolve(undefined);

export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";

function isPinnedBot(user, login) {
  return user?.login === login &&
    user?.id === BOTS.get(login) &&
    user?.type === "Bot";
}

/** Find one authenticated automated-review proof for the captured head. */
export async function findAutomatedReview(
  { reviews, comments, statuses },
  headSha,
  resolveCommit = NO_COMMIT,
  { allowPullRequestReviews = true } = {},
) {
  if (!FULL_SHA.test(headSha)) return undefined;

  if (allowPullRequestReviews) {
    for (const review of reviews) {
      const login = review?.user?.login;
      const state = typeof review?.state === "string"
        ? review.state.toUpperCase()
        : "";
      if (
        BOTS.has(login) && isPinnedBot(review.user, login) &&
        review?.commit_id?.toLowerCase() === headSha.toLowerCase() &&
        SUBMITTED_REVIEW_STATES.has(state)
      ) {
        return {
          reviewer: login,
          source: "pull-request-review",
          state,
          url: typeof review.html_url === "string"
            ? review.html_url
            : undefined,
        };
      }
    }
  }

  // Commit status history is attached to the captured SHA. An authenticated
  // exact completion is immutable occurrence proof; later retries do not erase
  // it. Review and comment objects differ because GitHub can dismiss or delete
  // them, and their event paths reconcile the resulting current evidence.
  const status = statuses.find((candidate) =>
    candidate?.context === "CodeRabbit" &&
    candidate?.state === "success" &&
    candidate?.description === "Review completed" &&
    isPinnedBot(candidate?.creator, CODERABBIT_LOGIN)
  );
  if (status) {
    return {
      reviewer: CODERABBIT_LOGIN,
      source: "coderabbit-status",
      state: "COMMENTED",
      url: typeof status.target_url === "string"
        ? status.target_url
        : undefined,
    };
  }

  for (const comment of comments) {
    if (
      !isPinnedBot(comment?.user, CODEX_LOGIN) ||
      typeof comment?.body !== "string" ||
      !comment.body.startsWith(CODEX_NO_FINDINGS)
    ) continue;
    const reviewedCommits = [...comment.body.matchAll(
      new RegExp(CODEX_REVIEWED_COMMIT, "gi"),
    )];
    const shortRef = reviewedCommits.length === 1
      ? reviewedCommits[0][1]
      : undefined;
    if (
      !shortRef ||
      !headSha.toLowerCase().startsWith(shortRef.toLowerCase())
    ) continue;
    const resolved = await resolveCommit(shortRef);
    if (
      typeof resolved === "string" && FULL_SHA.test(resolved) &&
      resolved.toLowerCase() === headSha.toLowerCase()
    ) {
      return {
        reviewer: CODEX_LOGIN,
        source: "codex-comment",
        state: "COMMENTED",
        url: typeof comment.html_url === "string"
          ? comment.html_url
          : undefined,
      };
    }
  }
  return undefined;
}

async function collectAll(github, endpoint, parameters, source) {
  const items = [];
  for await (
    const response of github.paginate.iterator(endpoint, {
      ...parameters,
      per_page: 100,
    })
  ) {
    if (!Array.isArray(response?.data)) {
      throw new Error(`${source} pagination returned malformed data`);
    }
    items.push(...response.data);
    if (items.length > MAX_ITEMS_PER_SOURCE) {
      throw new Error(`${source} exceeded ${MAX_ITEMS_PER_SOURCE} items`);
    }
  }
  return items;
}

/** Publish the review decision on the captured head after checking for drift. */
export async function publishAutomatedReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  pullUrl,
  isDraft = false,
  allowPullRequestReviews = true,
}) {
  let review;
  let failure;
  if (!FULL_SHA.test(headSha)) {
    failure = new Error("Captured head is malformed");
  } else if (!isDraft) {
    try {
      const common = { owner, repo };
      const [reviews, comments, statuses] = await Promise.all([
        collectAll(
          github,
          github.rest.pulls.listReviews,
          { ...common, pull_number: pullNumber },
          "reviews",
        ),
        collectAll(
          github,
          github.rest.issues.listComments,
          { ...common, issue_number: pullNumber },
          "comments",
        ),
        collectAll(
          github,
          github.rest.repos.listCommitStatusesForRef,
          { ...common, ref: headSha },
          "statuses",
        ),
      ]);
      review = await findAutomatedReview(
        { reviews, comments, statuses },
        headSha,
        async (ref) => {
          try {
            const response = await github.rest.repos.getCommit({
              ...common,
              ref,
            });
            return response?.data?.sha;
          } catch {
            return undefined;
          }
        },
        { allowPullRequestReviews },
      );
      if (!review) {
        throw new Error("No automated review proof for captured head");
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  }

  try {
    const current = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    if (current?.data?.head?.sha !== headSha) {
      review = undefined;
      throw new Error(
        "Pull request head changed while checking review evidence",
      );
    }
  } catch (error) {
    review = undefined;
    failure = error instanceof Error ? error : new Error(String(error));
  }

  const state = failure ? "failure" : isDraft ? "pending" : "success";
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state,
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description: state === "success"
      ? `Reviewed by ${review.reviewer}`
      : state === "pending"
      ? "Draft pull request waits for ready for review"
      : "No authenticated review proof for current commit",
    target_url: review?.url ?? pullUrl,
  });
  return { state, review, failure };
}
