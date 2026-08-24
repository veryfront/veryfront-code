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
const WORKFLOW_COMMENT_LOGIN = "github-actions[bot]";
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
      const state = typeof review?.state === "string"
        ? review.state.toUpperCase()
        : "";
      if (
        isPinnedBot(review?.user, CODEX_LOGIN) &&
        review?.commit_id?.toLowerCase() === headSha.toLowerCase() &&
        SUBMITTED_REVIEW_STATES.has(state)
      ) {
        return {
          reviewer: CODEX_LOGIN,
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

async function uniqueOpenPullForHead(github, owner, repo, headSha) {
  const pulls = await collectAll(
    github,
    github.rest.repos.listPullRequestsAssociatedWithCommit,
    { owner, repo, commit_sha: headSha },
    "associated pull requests",
  );
  const matches = pulls.filter((pull) =>
    pull?.state === "open" && pull?.head?.sha === headSha
  );
  if (matches.length !== 1) {
    throw new Error(
      "Captured head must belong to exactly one open pull request",
    );
  }
  return matches[0];
}

function isCodeRabbitCompletion(status) {
  return status?.context === "CodeRabbit" &&
    status?.state === "success" &&
    status?.description === "Review completed" &&
    isPinnedBot(status?.creator, CODERABBIT_LOGIN);
}

/** Publish monotonic CodeRabbit completion for one uniquely associated PR. */
export async function publishCodeRabbitCompletionStatus({
  github,
  owner,
  repo,
  headSha,
  status,
  expectedPullNumber = undefined,
}) {
  if (!FULL_SHA.test(headSha) || !isCodeRabbitCompletion(status)) {
    return { state: "ignored", review: undefined, failure: undefined };
  }

  try {
    const pull = await uniqueOpenPullForHead(github, owner, repo, headSha);
    if (
      expectedPullNumber !== undefined && pull.number !== expectedPullNumber
    ) {
      throw new Error(
        "CodeRabbit completion belongs to a different pull request",
      );
    }
    const current = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pull.number,
    });
    if (
      current?.data?.state !== "open" ||
      current?.data?.head?.sha !== headSha
    ) {
      throw new Error(
        "Associated pull request head changed before publication",
      );
    }
    const pullUrl = current.data.html_url ?? pull.html_url;
    const state = current.data.draft === true ? "pending" : "success";
    const description = state === "success"
      ? `Reviewed by ${CODERABBIT_LOGIN}`
      : "Draft pull request waits for ready for review";
    const review = state === "success"
      ? {
        reviewer: CODERABBIT_LOGIN,
        source: "coderabbit-status",
        state: "COMMENTED",
        url: pullUrl,
      }
      : undefined;
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      state,
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description,
      target_url: pullUrl,
    });
    return { state, review, failure: undefined, description };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    return { state: "failure", review: undefined, failure };
  }
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
      if (review?.source === "coderabbit-status") {
        const pull = await uniqueOpenPullForHead(github, owner, repo, headSha);
        if (pull.number !== pullNumber) {
          throw new Error(
            "CodeRabbit status belongs to a different pull request",
          );
        }
      }
    } catch (error) {
      review = undefined;
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

  // No proof for the captured head is the normal state right after a push,
  // while the review bots are still working. Publish pending only for that
  // absent-evidence case: a required pending status blocks merging exactly
  // like a failure and resolves once proof for the head arrives. Malformed
  // heads, pagination caps, ambiguous status ownership, head drift, and API
  // failures stay failures so they are looked at, not waited out.
  const state = failure ? "failure" : review ? "success" : "pending";
  const description = failure
    ? "Could not determine the automated review status"
    : review
    ? `Reviewed by ${review.reviewer}`
    : isDraft
    ? "Draft pull request waits for ready for review"
    : `Waiting for an automated review of ${headSha.slice(0, 12)}`;
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state,
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description,
    target_url: review?.url ?? pullUrl,
  });
  const result = { state, review, failure, description };
  if (state === "success") return result;

  try {
    const statuses = await collectAll(
      github,
      github.rest.repos.listCommitStatusesForRef,
      { owner, repo, ref: headSha },
      "repair statuses",
    );
    const completion = statuses.find(isCodeRabbitCompletion);
    if (!completion) return result;
    const repaired = await publishCodeRabbitCompletionStatus({
      github,
      owner,
      repo,
      headSha,
      status: completion,
      expectedPullNumber: pullNumber,
    });
    return repaired.state === "success" || repaired.state === "pending"
      ? repaired
      : result;
  } catch {
    return result;
  }
}

/**
 * Ask Codex to review the current head commit, at most once per commit.
 *
 * The Codex connector reviews a pull request when it opens or leaves draft,
 * but a push to an open pull request does not trigger a new review. Posting
 * the literal "@codex review" comment is how a new review is requested. The
 * marker comment keeps the request idempotent: a rerun for the same head
 * finds the marker in an existing comment and does not post again, while a
 * new head carries a new marker and gets its own request.
 *
 * Only marker comments authored by the workflow itself count. A pull request
 * participant can paste the marker text into their own comment, and letting
 * that suppress the request would let anyone silence the review nudge for a
 * head commit.
 *
 * Immediately before posting, re-fetch the pull request and require its
 * current head to match the event head. That prevents a queued synchronize
 * run from marking an old SHA while its unqualified request targets a newer
 * current head.
 */
export async function requestAutomatedReview({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
}) {
  // The comment body must stay a fixed instruction plus a verified commit
  // SHA. Never interpolate pull request controlled content here: this runs
  // with pull_request_target authority.
  if (typeof headSha !== "string" || !FULL_SHA.test(headSha)) {
    throw new Error(
      "Refusing to request an automated review of a malformed head commit",
    );
  }
  const marker = `<!-- automated-review-request: ${headSha.toLowerCase()} -->`;
  const comments = await collectAll(
    github,
    github.rest.issues.listComments,
    { owner, repo, issue_number: pullNumber },
    "request comments",
  );
  const alreadyRequested = comments.some((comment) =>
    comment?.user?.login === WORKFLOW_COMMENT_LOGIN &&
    comment?.user?.type === "Bot" &&
    typeof comment?.body === "string" &&
    comment.body.includes(marker)
  );
  if (alreadyRequested) {
    return { requested: false, marker };
  }
  const response = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  const currentHeadSha = response?.data?.head?.sha;
  if (
    typeof currentHeadSha !== "string" ||
    !FULL_SHA.test(currentHeadSha)
  ) {
    throw new Error("Could not verify the current pull request head commit");
  }
  if (currentHeadSha.toLowerCase() !== headSha.toLowerCase()) {
    return { requested: false, marker, reason: "stale-head" };
  }
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body: `${marker}\n@codex review`,
  });
  return { requested: true, marker };
}
