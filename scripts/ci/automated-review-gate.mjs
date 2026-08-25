const BOTS = new Map([
  ["chatgpt-codex-connector[bot]", 199175422],
  ["github-actions[bot]", 41898282],
]);
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const GITHUB_ACTIONS_LOGIN = "github-actions[bot]";
const CODEX_NO_FINDINGS = "Codex Review: Didn't find any major issues.";
const CODEX_REVIEWED_COMMIT = /\*\*Reviewed commit:\*\* `([0-9a-f]{10})`/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_ITEMS_PER_SOURCE = 500;
const WORKFLOW_COMMENT_LOGIN = "github-actions[bot]";
const TRUSTED_PERMISSIONS = new Set(["admin", "maintain", "write"]);
/** @type {(ref: string) => Promise<string | undefined>} */
const NO_COMMIT = () => Promise.resolve(undefined);
/** @type {(login: string) => Promise<boolean>} */
const NO_TRUSTED_HUMAN = () => Promise.resolve(false);

export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";

const REVIEW_WAKEUP_PATH = ".github/workflows/automated-review-wakeup.yml";

/** Parse immutable PR identity carried by a trusted review wakeup run. */
export function parseReviewWakeupRun(run) {
  const path = typeof run?.path === "string" ? run.path : "";
  const trustedPath = path === REVIEW_WAKEUP_PATH ||
    path.startsWith(`${REVIEW_WAKEUP_PATH}@`);
  const displayTitle = typeof run?.display_title === "string"
    ? run.display_title
    : "";
  const titleMatch = /^automated-review-wakeup-pr-([1-9][0-9]*)$/.exec(
    displayTitle,
  );
  const pullNumber = titleMatch ? Number(titleMatch[1]) : undefined;
  const headRepositoryId = run?.head_repository?.id;
  if (
    !trustedPath ||
    run?.event !== "pull_request_review" ||
    run?.conclusion !== "success" ||
    !Number.isSafeInteger(run?.id) ||
    run.id < 1 ||
    !Number.isSafeInteger(pullNumber) ||
    !Number.isSafeInteger(headRepositoryId) ||
    headRepositoryId < 1 ||
    typeof run?.head_branch !== "string" ||
    run.head_branch.length === 0 ||
    typeof run?.head_sha !== "string" ||
    !FULL_SHA.test(run.head_sha)
  ) return undefined;
  return {
    pullNumber,
    headBranch: run.head_branch,
    headSha: run.head_sha.toLowerCase(),
    headRepositoryId,
  };
}

/** Bind a parsed wakeup to one current PR before granting write authority. */
export function matchesReviewWakeupPullRequest(
  signal,
  pullRequest,
  repository,
) {
  return pullRequest?.number === signal?.pullNumber &&
    pullRequest?.state === "open" &&
    pullRequest?.head?.ref === signal?.headBranch &&
    typeof pullRequest?.head?.sha === "string" &&
    pullRequest.head.sha.toLowerCase() === signal?.headSha &&
    pullRequest?.head?.repo?.id === signal?.headRepositoryId &&
    pullRequest?.base?.ref === repository?.default_branch &&
    pullRequest?.base?.repo?.id === repository?.id;
}

function isPinnedBot(user, login) {
  return user?.login === login &&
    user?.id === BOTS.get(login) &&
    user?.type === "Bot";
}

function isLaterReview(candidate, current, candidateIndex, currentIndex) {
  const candidateTime = Date.parse(candidate?.submitted_at ?? "");
  const currentTime = Date.parse(current?.submitted_at ?? "");
  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    if (candidateTime !== currentTime) return candidateTime > currentTime;
  } else if (Number.isFinite(candidateTime) !== Number.isFinite(currentTime)) {
    return Number.isFinite(candidateTime);
  }
  if (
    Number.isSafeInteger(candidate?.id) && Number.isSafeInteger(current?.id) &&
    candidate.id !== current.id
  ) return candidate.id > current.id;
  return candidateIndex > currentIndex;
}

/** Find one authenticated automated-review proof for the captured head. */
export async function findAutomatedReview(
  { reviews, comments },
  headSha,
  resolveCommit = NO_COMMIT,
  isTrustedHuman = NO_TRUSTED_HUMAN,
) {
  if (!FULL_SHA.test(headSha)) return undefined;

  {
    let codexApproval;
    let codexFinding = false;
    const latestHumanReviews = new Map();
    for (const [index, review] of reviews.entries()) {
      const state = typeof review?.state === "string"
        ? review.state.toUpperCase()
        : "";
      const exactHead = review?.commit_id?.toLowerCase() ===
        headSha.toLowerCase();
      if (
        exactHead && state === "APPROVED" &&
        isPinnedBot(review?.user, CODEX_LOGIN)
      ) {
        codexApproval = {
          reviewer: CODEX_LOGIN,
          source: "pull-request-review",
          state,
          url: typeof review.html_url === "string"
            ? review.html_url
            : undefined,
        };
        continue;
      }
      if (
        exactHead && isPinnedBot(review?.user, CODEX_LOGIN) &&
        (state === "COMMENTED" || state === "CHANGES_REQUESTED")
      ) {
        codexFinding = true;
        continue;
      }
      if (
        exactHead && review?.user?.type === "User" &&
        typeof review?.user?.login === "string"
      ) {
        const current = latestHumanReviews.get(review.user.login);
        if (
          !current ||
          isLaterReview(review, current.review, index, current.index)
        ) latestHumanReviews.set(review.user.login, { review, index });
      }
    }
    for (const [login, latest] of latestHumanReviews) {
      const state = typeof latest.review?.state === "string"
        ? latest.review.state.toUpperCase()
        : "";
      if (state === "APPROVED" && await isTrustedHuman(login)) {
        return {
          reviewer: login,
          source: "human-approval",
          state,
          url: typeof latest.review.html_url === "string"
            ? latest.review.html_url
            : undefined,
        };
      }
    }
    if (codexFinding) return undefined;
    if (codexApproval) return codexApproval;
  }

  let codexNoFindings;
  let codexFinding = false;
  for (const comment of comments) {
    if (
      !isPinnedBot(comment?.user, CODEX_LOGIN) ||
      typeof comment?.body !== "string"
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
      if (comment.body.startsWith(CODEX_NO_FINDINGS)) {
        codexNoFindings = {
          reviewer: CODEX_LOGIN,
          source: "codex-comment",
          state: "COMMENTED",
          url: typeof comment.html_url === "string"
            ? comment.html_url
            : undefined,
        };
      } else {
        codexFinding = true;
      }
    }
  }
  return codexFinding ? undefined : codexNoFindings;
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
}) {
  let review;
  let failure;
  let pullAuthor;
  if (!FULL_SHA.test(headSha)) {
    failure = new Error("Captured head is malformed");
  } else {
    try {
      const current = await github.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      if (current?.data?.head?.sha !== headSha) {
        throw new Error(
          "Pull request head changed before checking review evidence",
        );
      }
      pullAuthor = current?.data?.user?.login;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (!failure && !isDraft) {
    try {
      const common = { owner, repo };
      const [reviews, comments] = await Promise.all([
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
      ]);
      review = await findAutomatedReview(
        { reviews, comments },
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
        async (login) => {
          if (login === pullAuthor) return false;
          try {
            const response = await github.rest.repos
              .getCollaboratorPermissionLevel({
                ...common,
                username: login,
              });
            return TRUSTED_PERMISSIONS.has(response?.data?.permission);
          } catch {
            return false;
          }
        },
      );
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
  return { state, review, failure, description };
}

/** Extract the pull request represented by a merge queue head ref. */
export function parseMergeQueuePullNumber(headRef) {
  if (typeof headRef !== "string") return undefined;
  const match = headRef.match(
    /^(?:refs\/heads\/)?gh-readonly-queue\/.+\/pr-([1-9]\d*)-([0-9a-f]{40})$/i,
  );
  if (!match) return undefined;
  const pullNumber = Number(match[1]);
  return Number.isSafeInteger(pullNumber)
    ? { pullNumber, sourceHeadSha: match[2].toLowerCase() }
    : undefined;
}

function isTrustedReviewGateStatus(status) {
  if (
    status?.context !== AUTOMATED_REVIEW_STATUS_CONTEXT ||
    status?.state !== "success" ||
    !isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN) ||
    typeof status?.description !== "string"
  ) return false;
  if (status.description === `Reviewed by ${CODEX_LOGIN}`) return true;
  return /^Reviewed by [A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(
    status.description,
  );
}

/** Reuse a successful exact-head review for a synthetic merge queue commit. */
export async function publishMergeGroupReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  mergeGroupSha,
}) {
  let failure;
  let pullUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}`;
  try {
    if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
      throw new Error("Merge queue pull request number is invalid");
    }
    if (!FULL_SHA.test(mergeGroupSha)) {
      throw new Error("Merge group commit is malformed");
    }
    if (!FULL_SHA.test(sourceHeadSha)) {
      throw new Error("Merge queue source commit is malformed");
    }
    const pull = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    if (
      pull?.data?.state !== "open" ||
      pull?.data?.head?.sha?.toLowerCase() !== sourceHeadSha.toLowerCase()
    ) {
      throw new Error("Merge queue pull request changed from its queued head");
    }
    pullUrl = pull.data.html_url ?? pullUrl;
    const statuses = await collectAll(
      github,
      github.rest.repos.listCommitStatusesForRef,
      { owner, repo, ref: sourceHeadSha },
      "source review statuses",
    );
    const currentReviewStatus = statuses.find((status) =>
      status?.context === AUTOMATED_REVIEW_STATUS_CONTEXT
    );
    if (!isTrustedReviewGateStatus(currentReviewStatus)) {
      throw new Error(
        "Pull request head does not have a current trusted review gate",
      );
    }
    const current = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    if (
      current?.data?.state !== "open" ||
      current?.data?.head?.sha?.toLowerCase() !== sourceHeadSha.toLowerCase()
    ) {
      throw new Error(
        "Pull request head changed while propagating review evidence",
      );
    }
    const description = `Reused exact-head review for PR #${pullNumber}`;
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: mergeGroupSha,
      state: "success",
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description,
      target_url: typeof currentReviewStatus.target_url === "string"
        ? currentReviewStatus.target_url
        : pullUrl,
    });
    return { state: "success", description, failure: undefined };
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  if (FULL_SHA.test(mergeGroupSha)) {
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: mergeGroupSha,
      state: "failure",
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description: "Could not reuse an exact-head review",
      target_url: pullUrl,
    });
  }
  return { state: "failure", description: undefined, failure };
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
