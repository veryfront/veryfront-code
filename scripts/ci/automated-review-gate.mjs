import { createHash } from "node:crypto";

const BOTS = new Map([
  ["chatgpt-codex-connector[bot]", 199175422],
  ["github-actions[bot]", 41898282],
]);
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const GITHUB_ACTIONS_LOGIN = "github-actions[bot]";
const CODEX_NO_FINDINGS = "Codex Review: Didn't find any major issues.";
const CODEX_REVIEWED_COMMIT = /\*\*Reviewed commit:\*\* `([0-9a-f]{10})`/i;
const REVIEW_REQUEST_MARKER =
  /^<!-- automated-review-request: ([0-9a-f]{40})(?: ([a-z0-9-]{1,64}))? -->\n@codex review$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REQUEST_KEY = /^[a-z0-9-]{1,64}$/i;
const MAX_ITEMS_PER_SOURCE = 500;
const TRUSTED_PERMISSIONS = new Set(["admin", "maintain", "write"]);
/** @type {(ref: string) => Promise<string | undefined>} */
const NO_COMMIT = () => Promise.resolve(undefined);
/** @type {(login: string) => Promise<boolean>} */
const NO_TRUSTED_HUMAN = () => Promise.resolve(false);

export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";

const REVIEW_WAKEUP_PATH = ".github/workflows/automated-review-wakeup.yml";

/** Produce a compact, non-ambiguous binding for a pull request base. */
export function reviewBaseBinding(baseRepositoryId, baseRef) {
  if (!Number.isSafeInteger(baseRepositoryId) || baseRepositoryId < 1) {
    throw new Error("Pull request base repository is invalid");
  }
  if (
    typeof baseRef !== "string" || baseRef.length === 0 ||
    baseRef.length > 1024 || baseRef.includes("\0")
  ) {
    throw new Error("Pull request base ref is invalid");
  }
  return createHash("sha256")
    .update(`${baseRepositoryId}\0${baseRef}`)
    .digest("hex");
}

function pullRequestBaseBinding(pullRequest) {
  return reviewBaseBinding(
    pullRequest?.base?.repo?.id,
    pullRequest?.base?.ref,
  );
}

/** Parse immutable PR identity carried by a trusted review wakeup run. */
export function parseReviewWakeupRun(run) {
  const path = typeof run?.path === "string" ? run.path : "";
  const trustedPath = path === REVIEW_WAKEUP_PATH ||
    path.startsWith(`${REVIEW_WAKEUP_PATH}@`);
  const displayTitle = typeof run?.display_title === "string"
    ? run.display_title
    : "";
  const titleMatch = /^automated-review-wakeup-pr-([1-9]\d*)$/.exec(
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
    pullRequest?.head?.repo?.id === signal?.headRepositoryId &&
    typeof pullRequest?.base?.ref === "string" &&
    pullRequest.base.ref.length > 0 &&
    pullRequest.base.ref.length <= 1024 &&
    !pullRequest.base.ref.includes("\0") &&
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

function reviewRequestCandidate(comment, headSha, index) {
  if (
    !isPinnedBot(comment?.user, GITHUB_ACTIONS_LOGIN) ||
    typeof comment?.body !== "string"
  ) return undefined;
  const marker = REVIEW_REQUEST_MARKER.exec(comment.body);
  if (marker?.[1]?.toLowerCase() !== headSha.toLowerCase()) return undefined;
  // A normal synchronize request is only an idempotency marker. The head SHA
  // already excludes proof for earlier commits, so treating the marker as a
  // freshness boundary can erase a valid exact-head review that lands while
  // the publisher is still running. Only keyed base-edit markers establish a
  // same-head reset boundary.
  if (marker[2] === undefined) return undefined;
  const createdAt = Date.parse(comment?.created_at ?? "");
  if (!Number.isFinite(createdAt)) {
    return { time: Number.POSITIVE_INFINITY, id: undefined, index };
  }
  const id = Number.isSafeInteger(comment?.id) && comment.id > 0
    ? comment.id
    : undefined;
  return { time: createdAt, id, index };
}

function isLaterReviewRequest(candidate, current) {
  if (current === undefined || candidate.time > current.time) return true;
  if (candidate.time < current.time) return false;
  if (candidate.id !== undefined && current.id !== undefined) {
    return candidate.id > current.id;
  }
  return candidate.index > current.index;
}

function latestReviewRequest(comments, headSha) {
  let latest;
  for (const [index, comment] of comments.entries()) {
    const candidate = reviewRequestCandidate(comment, headSha, index);
    if (candidate && isLaterReviewRequest(candidate, latest)) {
      latest = candidate;
    }
  }
  return latest;
}

function hasReviewRequest(comments, headSha, requestKey) {
  return comments.some((comment) => {
    if (
      !isPinnedBot(comment?.user, GITHUB_ACTIONS_LOGIN) ||
      typeof comment?.body !== "string"
    ) return false;
    const marker = REVIEW_REQUEST_MARKER.exec(comment.body);
    return marker?.[1]?.toLowerCase() === headSha.toLowerCase() &&
      marker?.[2] === requestKey;
  });
}

function timelinePosition(timeline, event, id) {
  if (!Number.isSafeInteger(id) || id < 1) return undefined;
  let position;
  for (const [index, item] of timeline.entries()) {
    if (item?.event !== event || item?.id !== id) continue;
    if (position !== undefined) return undefined;
    position = index;
  }
  return position;
}

function latestBaseRefChange(events) {
  let latest;
  for (const item of events) {
    if (item?.event !== "base_ref_changed") continue;
    const time = Date.parse(item?.created_at ?? "");
    if (!Number.isFinite(time)) {
      return { time: Number.POSITIVE_INFINITY, kind: "base-change" };
    }
    if (latest === undefined || time > latest.time) {
      latest = { time, kind: "base-change" };
    }
  }
  return latest;
}

function activeReviewBoundary(request, reviewNotBefore, baseChange) {
  // The issue event is GitHub's durable record of the policy change. The
  // workflow writes its reset status later, so letting that timestamp replace
  // the event would reject valid evidence submitted between the two writes.
  if (baseChange !== undefined) return baseChange;
  const boundary = reviewNotBefore === undefined
    ? undefined
    : { time: reviewNotBefore, kind: "status" };
  if (
    boundary?.kind === "status" &&
    request?.time === boundary.time
  ) return { ...request, timelineEvent: "commented" };
  if (boundary !== undefined || request === undefined) return boundary;
  return { ...request, timelineEvent: "commented" };
}

function evidenceFreshness(
  evidence,
  timelineEvent,
  boundary,
  timeline,
) {
  if (boundary === undefined) return "newer";
  const evidenceTime = Date.parse(
    timelineEvent === "reviewed"
      ? evidence?.submitted_at ?? ""
      : evidence?.created_at ?? "",
  );
  if (!Number.isFinite(evidenceTime)) return "ambiguous";
  if (evidenceTime < boundary.time) return "older";
  if (evidenceTime > boundary.time) return "newer";
  if (boundary.timelineEvent === undefined) return "ambiguous";
  const boundaryPosition = timelinePosition(
    timeline,
    boundary.timelineEvent,
    boundary.id,
  );
  const evidencePosition = timelinePosition(
    timeline,
    timelineEvent,
    evidence?.id,
  );
  if (boundaryPosition === undefined || evidencePosition === undefined) {
    return "ambiguous";
  }
  return evidencePosition > boundaryPosition ? "newer" : "older";
}

function evidenceTime(evidence, timelineEvent) {
  return Date.parse(
    timelineEvent === "reviewed"
      ? evidence?.submitted_at ?? ""
      : evidence?.created_at ?? "",
  );
}

function isEvidenceProvablyLater(candidate, current, timeline) {
  const candidateTime = evidenceTime(
    candidate.evidence,
    candidate.timelineEvent,
  );
  const currentTime = evidenceTime(current.evidence, current.timelineEvent);
  if (!Number.isFinite(candidateTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  const candidatePosition = timelinePosition(
    timeline,
    candidate.timelineEvent,
    candidate.evidence?.id,
  );
  const currentPosition = timelinePosition(
    timeline,
    current.timelineEvent,
    current.evidence?.id,
  );
  return candidatePosition !== undefined && currentPosition !== undefined &&
    candidatePosition > currentPosition;
}

function reviewResetDescription(pullNumber, baseBinding, requestKey) {
  const prefix = `PR#${pullNumber} reset base:${baseBinding}`;
  return requestKey === undefined
    ? prefix
    : `${prefix} key:${
      createHash("sha256").update(requestKey).digest("hex").slice(0, 12)
    }`;
}

function hasReviewReset(statuses, pullNumber, baseBinding, requestKey) {
  const description = reviewResetDescription(
    pullNumber,
    baseBinding,
    requestKey,
  );
  return statuses.some((status) =>
    status?.context === AUTOMATED_REVIEW_STATUS_CONTEXT &&
    status?.state === "pending" &&
    status?.description === description &&
    isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN)
  );
}

function latestReviewResetTime(statuses, pullNumber, baseBinding) {
  let latest;
  const descriptionPrefix = reviewResetDescription(pullNumber, baseBinding);
  for (const status of statuses) {
    if (
      status?.context !== AUTOMATED_REVIEW_STATUS_CONTEXT ||
      status?.state !== "pending" ||
      typeof status?.description !== "string" ||
      (status.description !== descriptionPrefix &&
        !status.description.startsWith(`${descriptionPrefix} key:`)) ||
      !isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN)
    ) continue;
    const createdAt = Date.parse(status?.created_at ?? "");
    if (!Number.isFinite(createdAt)) return Number.POSITIVE_INFINITY;
    if (latest === undefined || createdAt > latest) latest = createdAt;
  }
  return latest;
}

/** Find one authenticated automated-review proof for the captured head. */
export async function findAutomatedReview(
  {
    reviews,
    comments,
    events = /** @type {unknown[]} */ ([]),
    timeline = /** @type {unknown[]} */ ([]),
  },
  headSha,
  resolveCommit = NO_COMMIT,
  isTrustedHuman = NO_TRUSTED_HUMAN,
  reviewNotBefore = /** @type {number | undefined} */ (undefined),
) {
  if (!FULL_SHA.test(headSha)) return undefined;
  const request = latestReviewRequest(comments, headSha);
  const validReviewNotBefore = reviewNotBefore === undefined ||
      Number.isFinite(reviewNotBefore)
    ? reviewNotBefore
    : Number.POSITIVE_INFINITY;
  const boundary = activeReviewBoundary(
    request,
    validReviewNotBefore,
    latestBaseRefChange(events),
  );
  const codexSuccesses = [];
  const codexFindings = [];
  {
    const latestHumanReviews = new Map();
    for (const [index, review] of reviews.entries()) {
      const state = typeof review?.state === "string"
        ? review.state.toUpperCase()
        : "";
      const exactHead = review?.commit_id?.toLowerCase() ===
        headSha.toLowerCase();
      if (!exactHead) continue;
      const freshness = evidenceFreshness(
        review,
        "reviewed",
        boundary,
        timeline,
      );
      if (
        freshness === "newer" && state === "APPROVED" &&
        isPinnedBot(review?.user, CODEX_LOGIN)
      ) {
        codexSuccesses.push({
          evidence: review,
          timelineEvent: "reviewed",
          proof: {
            reviewer: CODEX_LOGIN,
            source: "pull-request-review",
            state,
            url: typeof review.html_url === "string"
              ? review.html_url
              : undefined,
          },
        });
        continue;
      }
      if (
        freshness !== "older" && isPinnedBot(review?.user, CODEX_LOGIN) &&
        (state === "COMMENTED" || state === "CHANGES_REQUESTED")
      ) {
        codexFindings.push({
          evidence: review,
          freshness,
          timelineEvent: "reviewed",
        });
        continue;
      }
      if (
        freshness === "newer" && review?.user?.type === "User" &&
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
  }

  for (const comment of comments) {
    if (
      !isPinnedBot(comment?.user, CODEX_LOGIN) ||
      typeof comment?.body !== "string"
    ) continue;
    const freshness = evidenceFreshness(
      comment,
      "commented",
      boundary,
      timeline,
    );
    if (freshness === "older") continue;
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
      if (
        freshness === "newer" && comment.body.startsWith(CODEX_NO_FINDINGS)
      ) {
        codexSuccesses.push({
          evidence: comment,
          timelineEvent: "commented",
          proof: {
            reviewer: CODEX_LOGIN,
            source: "codex-comment",
            state: "COMMENTED",
            url: typeof comment.html_url === "string"
              ? comment.html_url
              : undefined,
          },
        });
      } else {
        codexFindings.push({
          evidence: comment,
          freshness,
          timelineEvent: "commented",
        });
      }
    }
  }
  if (codexFindings.length === 0) return codexSuccesses[0]?.proof;
  return codexSuccesses.find((success) =>
    codexFindings.every((finding) =>
      finding.freshness === "newer" &&
      isEvidenceProvablyLater(success, finding, timeline)
    )
  )?.proof;
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

async function resolveCommitRef(github, common, ref) {
  try {
    const response = await github.rest.repos.getCommit({ ...common, ref });
    const sha = response?.data?.sha;
    if (!FULL_SHA.test(sha ?? "")) {
      throw new Error("Commit ref response has a malformed commit");
    }
    return sha;
  } catch (error) {
    if (
      typeof error === "object" && error !== null && error.status === 404
    ) return undefined;
    throw error;
  }
}

async function resolveQueueRefTarget(github, common, ref) {
  let response;
  try {
    response = await github.rest.git.getRef({ ...common, ref });
  } catch (error) {
    if (
      typeof error === "object" && error !== null && error.status === 404
    ) return undefined;
    throw error;
  }
  const sha = response?.data?.object?.sha;
  if (!FULL_SHA.test(sha ?? "")) {
    throw new Error("Merge queue ref response has a malformed commit");
  }
  return sha;
}

/** Fail one source head and every active queue commit derived from it. */
export async function publishReviewResolutionFailure({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  pullUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}`,
}) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Pull request number is invalid");
  }
  if (!FULL_SHA.test(sourceHeadSha)) {
    throw new Error("Pull request source commit is malformed");
  }
  const currentHeadSha = await resolveCommitRef(
    github,
    { owner, repo },
    `refs/pull/${pullNumber}/head`,
  );
  if (currentHeadSha?.toLowerCase() !== sourceHeadSha.toLowerCase()) {
    return { queueFailures: 0, skipped: true };
  }
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: sourceHeadSha,
    state: "failure",
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description: `PR#${pullNumber} review status unavailable`,
    target_url: pullUrl,
  });
  const refs = await collectAll(
    github,
    github.rest.git.listMatchingRefs,
    { owner, repo, ref: "heads/gh-readonly-queue/" },
    "merge queue refs",
  );
  const seen = new Set();
  for (const queueRef of refs) {
    const parsed = parseMergeQueuePullNumber(queueRef?.ref);
    const mergeGroupSha = queueRef?.object?.sha;
    if (parsed?.pullNumber !== pullNumber) continue;
    if (!FULL_SHA.test(mergeGroupSha ?? "")) {
      throw new Error("Merge queue ref has a malformed commit");
    }
    if (seen.has(mergeGroupSha.toLowerCase())) continue;
    const latestSourceHeadSha = await resolveCommitRef(
      github,
      { owner, repo },
      `refs/pull/${pullNumber}/head`,
    );
    if (latestSourceHeadSha?.toLowerCase() !== sourceHeadSha.toLowerCase()) {
      continue;
    }
    let targetVerified = false;
    try {
      await requireActiveMergeQueueBinding({
        github,
        owner,
        repo,
        pullNumber,
        sourceHeadSha,
        baseSha: parsed.baseSha,
        mergeGroupSha,
      });
      targetVerified = true;
    } catch {
      const ref = queueRef.ref.startsWith("refs/")
        ? queueRef.ref.slice("refs/".length)
        : queueRef.ref;
      const liveTarget = await resolveQueueRefTarget(
        github,
        { owner, repo },
        ref,
      );
      targetVerified =
        liveTarget?.toLowerCase() === mergeGroupSha.toLowerCase();
    }
    if (!targetVerified) continue;
    const finalSourceHeadSha = await resolveCommitRef(
      github,
      { owner, repo },
      `refs/pull/${pullNumber}/head`,
    );
    if (
      finalSourceHeadSha?.toLowerCase() !== sourceHeadSha.toLowerCase()
    ) continue;
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: mergeGroupSha,
      state: "failure",
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description: `Could not revalidate review for PR #${pullNumber}`,
      target_url: pullUrl,
    });
    seen.add(mergeGroupSha.toLowerCase());
  }
  return { queueFailures: seen.size, skipped: false };
}

async function isCurrentlyTrustedHuman(
  github,
  { owner, repo, login, pullAuthor },
) {
  if (
    typeof login !== "string" || typeof pullAuthor !== "string" ||
    login === pullAuthor
  ) return false;
  try {
    const response = await github.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: login,
    });
    return TRUSTED_PERMISSIONS.has(response?.data?.permission);
  } catch (error) {
    if (
      typeof error === "object" && error !== null && error.status === 404
    ) return false;
    throw error;
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
  reviewResetKey = /** @type {string | undefined} */ (undefined),
}) {
  let review;
  let failure;
  let pullAuthor;
  let baseBinding;
  let baseRef;
  let isDraft = false;
  let resetPending = false;
  if (
    reviewResetKey !== undefined &&
    (typeof reviewResetKey !== "string" || !REQUEST_KEY.test(reviewResetKey))
  ) {
    failure = new Error("Review reset key is malformed");
  } else if (!FULL_SHA.test(headSha)) {
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
      baseBinding = pullRequestBaseBinding(current?.data);
      baseRef = current?.data?.base?.ref;
      isDraft = current?.data?.draft === true;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (!failure) {
    try {
      const common = { owner, repo };
      const [reviews, comments, events, statuses, timeline] = await Promise.all(
        [
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
            github.rest.issues.listEvents,
            { ...common, issue_number: pullNumber },
            "pull request events",
          ),
          collectAll(
            github,
            github.rest.repos.listCommitStatusesForRef,
            { ...common, ref: headSha },
            "review statuses",
          ),
          collectAll(
            github,
            github.rest.issues.listEventsForTimeline,
            { ...common, issue_number: pullNumber },
            "pull request timeline",
          ),
        ],
      );
      resetPending = reviewResetKey !== undefined &&
        !hasReviewRequest(comments, headSha, reviewResetKey) &&
        !hasReviewReset(
          statuses,
          pullNumber,
          baseBinding,
          reviewResetKey,
        );
      if (!resetPending && !isDraft) {
        review = await findAutomatedReview(
          { reviews, comments, events, timeline },
          headSha,
          (ref) => resolveCommitRef(github, common, ref),
          (login) =>
            isCurrentlyTrustedHuman(github, {
              ...common,
              login,
              pullAuthor,
            }),
          latestReviewResetTime(statuses, pullNumber, baseBinding),
        );
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
    if (pullRequestBaseBinding(current?.data) !== baseBinding) {
      review = undefined;
      throw new Error(
        "Pull request base changed while checking review evidence",
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
  let state = "pending";
  if (failure) state = "failure";
  else if (review) state = "success";

  let description;
  if (failure) description = `PR#${pullNumber} review status unavailable`;
  else if (resetPending) {
    description = reviewResetDescription(
      pullNumber,
      baseBinding,
      reviewResetKey,
    );
  } else if (review) {
    description = `PR#${pullNumber} base:${baseBinding} by:${review.reviewer}`;
  } else if (isDraft) description = `PR#${pullNumber} draft waits for review`;
  else {
    description = `PR#${pullNumber} waits for review ${headSha.slice(0, 12)}`;
  }
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state,
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description,
    target_url: review?.url ?? pullUrl,
  });
  return { state, review, failure, description, baseRef };
}

/**
 * Mark the current head of one pull request as unverified review proof.
 *
 * A revocation event - a Codex finding, a deleted verdict comment, a
 * dismissed approval - is consumed by the run that observes it. When that run
 * cannot resolve its target or publish a status, the older success stays on
 * the head, and a later merge group reuses that cached success as if nothing
 * had been revoked. Writing failures for the current head and its active
 * queue commits keeps every gate closed until a later event recomputes real
 * evidence.
 */
export async function invalidateReviewProof({
  github,
  owner,
  repo,
  pullNumber,
  expectedHeadSha = /** @type {string | undefined} */ (undefined),
  reconciliationStatusId = /** @type {number | undefined} */ (undefined),
}) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Pull request number is invalid");
  }
  if (expectedHeadSha !== undefined && !FULL_SHA.test(expectedHeadSha)) {
    throw new Error("Expected pull request head commit is invalid");
  }
  if (
    reconciliationStatusId !== undefined &&
    (!Number.isSafeInteger(reconciliationStatusId) ||
      reconciliationStatusId < 0)
  ) {
    throw new Error("Reconciliation status identity is invalid");
  }
  const response = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  const resolvedHeadSha = response?.data?.head?.sha;
  if (typeof resolvedHeadSha !== "string" || !FULL_SHA.test(resolvedHeadSha)) {
    throw new Error("Could not resolve the pull request head commit");
  }
  const headSha = resolvedHeadSha.toLowerCase();
  const description = `PR#${pullNumber} review status unavailable`;
  if (
    expectedHeadSha !== undefined &&
    headSha !== expectedHeadSha.toLowerCase()
  ) {
    return {
      headSha: expectedHeadSha.toLowerCase(),
      description,
      queueFailures: 0,
      skipped: true,
    };
  }
  if (reconciliationStatusId !== undefined) {
    const statuses = await collectAll(
      github,
      github.rest.repos.listCommitStatusesForRef,
      { owner, repo, ref: headSha },
      "review statuses",
    );
    const latestStatus = latestReviewGateStatusForPull(statuses, pullNumber);
    if (
      Number.isSafeInteger(latestStatus?.id) &&
      latestStatus.id !== reconciliationStatusId &&
      trustedReviewGateReviewer(
          latestStatus,
          pullNumber,
          pullRequestBaseBinding(response?.data),
        ) !== undefined
    ) {
      return {
        headSha,
        description,
        queueFailures: 0,
        skipped: true,
      };
    }
  }
  const result = await publishReviewResolutionFailure({
    github,
    owner,
    repo,
    pullNumber,
    sourceHeadSha: headSha,
    pullUrl: typeof response?.data?.html_url === "string"
      ? response.data.html_url
      : undefined,
  });
  return { headSha, description, skipped: false, ...result };
}

/** Extract the pull request represented by a merge queue head ref. */
export function parseMergeQueuePullNumber(headRef) {
  if (typeof headRef !== "string") return undefined;
  const match =
    /^(?:refs\/heads\/)?gh-readonly-queue\/.+\/pr-([1-9]\d*)-([0-9a-f]{40})$/i
      .exec(
        headRef,
      );
  if (!match) return undefined;
  const pullNumber = Number(match[1]);
  return Number.isSafeInteger(pullNumber)
    ? { pullNumber, baseSha: match[2].toLowerCase() }
    : undefined;
}

async function resolveCurrentMergeQueueEntry({
  github,
  owner,
  repo,
  pullNumber,
}) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Merge queue pull request number is invalid");
  }
  const response = await github.graphql(
    `query ResolveMergeQueueSource(
      $owner: String!
      $repo: String!
      $pullNumber: Int!
    ) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pullNumber) {
          number
          headRefOid
          mergeQueueEntry {
            baseCommit { oid }
            headCommit { oid }
            pullRequest { number headRefOid }
          }
        }
      }
    }`,
    { owner, repo, pullNumber },
  );
  const pullRequest = response?.repository?.pullRequest;
  const entry = pullRequest?.mergeQueueEntry;
  const sourceHeadSha = entry?.pullRequest?.headRefOid;
  const baseSha = entry?.baseCommit?.oid;
  const mergeGroupSha = entry?.headCommit?.oid;
  if (
    pullRequest?.number !== pullNumber ||
    entry?.pullRequest?.number !== pullNumber ||
    !FULL_SHA.test(baseSha ?? "") ||
    !FULL_SHA.test(mergeGroupSha ?? "") ||
    !FULL_SHA.test(sourceHeadSha ?? "") ||
    pullRequest?.headRefOid?.toLowerCase() !== sourceHeadSha.toLowerCase()
  ) {
    throw new Error("Merge queue entry does not match its queued pull request");
  }
  return {
    baseSha: baseSha.toLowerCase(),
    mergeGroupSha: mergeGroupSha.toLowerCase(),
    sourceHeadSha: sourceHeadSha.toLowerCase(),
  };
}

/** Resolve the immutable source commit stored in GitHub's merge-queue entry. */
export async function resolveMergeQueueSource({
  github,
  owner,
  repo,
  pullNumber,
  baseSha,
  mergeGroupSha,
}) {
  if (!FULL_SHA.test(baseSha)) {
    throw new Error("Merge queue base commit is malformed");
  }
  if (!FULL_SHA.test(mergeGroupSha)) {
    throw new Error("Merge group commit is malformed");
  }
  const entry = await resolveCurrentMergeQueueEntry({
    github,
    owner,
    repo,
    pullNumber,
  });
  if (
    entry.baseSha !== baseSha.toLowerCase() ||
    entry.mergeGroupSha !== mergeGroupSha.toLowerCase()
  ) {
    throw new Error("Merge queue entry does not match its queued pull request");
  }
  return entry.sourceHeadSha;
}

function assertMergeGroupInputs({
  pullNumber,
  sourceHeadSha,
  baseSha,
  mergeGroupSha,
}) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Merge queue pull request number is invalid");
  }
  if (!FULL_SHA.test(mergeGroupSha)) {
    throw new Error("Merge group commit is malformed");
  }
  if (!FULL_SHA.test(sourceHeadSha)) {
    throw new Error("Merge queue source commit is malformed");
  }
  if (!FULL_SHA.test(baseSha)) {
    throw new Error("Merge queue base commit is malformed");
  }
}

function trustedReviewGateReviewer(status, pullNumber, baseBinding) {
  if (
    status?.context !== AUTOMATED_REVIEW_STATUS_CONTEXT ||
    status?.state !== "success" ||
    !isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN) ||
    typeof status?.description !== "string"
  ) return undefined;
  const prefix = `PR#${pullNumber} base:${baseBinding} by:`;
  if (status.description === `${prefix}${CODEX_LOGIN}`) return CODEX_LOGIN;
  if (!status.description.startsWith(prefix)) return undefined;
  const reviewer = status.description.slice(prefix.length);
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(reviewer)
    ? reviewer
    : undefined;
}

function latestReviewGateStatusForPull(statuses, pullNumber) {
  const prefix = `PR#${pullNumber} `;
  return statuses.find((status) =>
    status?.context === AUTOMATED_REVIEW_STATUS_CONTEXT &&
    typeof status?.description === "string" &&
    status.description.startsWith(prefix)
  );
}

const ACTIVE_MERGE_QUEUE_BINDING_QUERY = `
  query ActiveMergeQueueBinding($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number
        state
        headRefOid
        baseRefName
        mergeQueueEntry {
          baseCommit { oid }
          headCommit { oid }
        }
      }
    }
  }
`;

async function requireActiveMergeQueueBinding({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  baseSha,
  mergeGroupSha,
}) {
  const response = await github.graphql(ACTIVE_MERGE_QUEUE_BINDING_QUERY, {
    owner,
    repo,
    number: pullNumber,
  });
  const pull = response?.repository?.pullRequest;
  const entry = pull?.mergeQueueEntry;
  const liveBaseSha = entry?.baseCommit?.oid;
  const queueHeadSha = entry?.headCommit?.oid;
  const baseRef = pull?.baseRefName;
  const normalizedBaseSha = baseSha.toLowerCase();
  if (
    pull?.number !== pullNumber || pull?.state !== "OPEN" ||
    pull?.headRefOid?.toLowerCase() !== sourceHeadSha.toLowerCase() ||
    liveBaseSha?.toLowerCase() !== normalizedBaseSha ||
    queueHeadSha?.toLowerCase() !== mergeGroupSha.toLowerCase() ||
    typeof baseRef !== "string" || baseRef.length === 0 ||
    baseRef.length > 1024 || baseRef.includes("\0")
  ) {
    throw new Error(
      "Merge group is not bound to the current pull request head",
    );
  }
  const ref =
    `heads/gh-readonly-queue/${baseRef}/pr-${pullNumber}-${normalizedBaseSha}`;
  const parsed = parseMergeQueuePullNumber(`refs/${ref}`);
  if (
    parsed?.pullNumber !== pullNumber ||
    parsed?.baseSha !== normalizedBaseSha
  ) {
    throw new Error("Merge queue ref identity is malformed");
  }
  const liveTarget = await resolveQueueRefTarget(github, { owner, repo }, ref);
  if (liveTarget?.toLowerCase() !== mergeGroupSha.toLowerCase()) {
    throw new Error("Merge queue ref no longer targets this merge group");
  }
}

/** Reuse a successful exact-head review for a synthetic merge queue commit. */
export async function publishMergeGroupReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  baseSha,
  mergeGroupSha,
}) {
  let failure;
  let bindingVerified = false;
  let pullUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}`;
  try {
    assertMergeGroupInputs({
      pullNumber,
      sourceHeadSha,
      baseSha,
      mergeGroupSha,
    });
    await requireActiveMergeQueueBinding({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      baseSha,
      mergeGroupSha,
    });
    bindingVerified = true;
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
    const baseBinding = pullRequestBaseBinding(pull?.data);
    pullUrl = pull.data.html_url ?? pullUrl;
    const common = { owner, repo };
    const [reviews, comments, events, statuses, timeline] = await Promise.all([
      collectAll(
        github,
        github.rest.pulls.listReviews,
        { ...common, pull_number: pullNumber },
        "source reviews",
      ),
      collectAll(
        github,
        github.rest.issues.listComments,
        { ...common, issue_number: pullNumber },
        "source comments",
      ),
      collectAll(
        github,
        github.rest.issues.listEvents,
        { ...common, issue_number: pullNumber },
        "source pull request events",
      ),
      collectAll(
        github,
        github.rest.repos.listCommitStatusesForRef,
        { ...common, ref: sourceHeadSha },
        "source review statuses",
      ),
      collectAll(
        github,
        github.rest.issues.listEventsForTimeline,
        { ...common, issue_number: pullNumber },
        "source review timeline",
      ),
    ]);
    const liveReview = await findAutomatedReview(
      { reviews, comments, events, timeline },
      sourceHeadSha,
      (ref) => resolveCommitRef(github, common, ref),
      (login) =>
        isCurrentlyTrustedHuman(github, {
          ...common,
          login,
          pullAuthor: pull?.data?.user?.login,
        }),
      latestReviewResetTime(statuses, pullNumber, baseBinding),
    );
    if (!liveReview) {
      throw new Error("Pull request does not have current review evidence");
    }
    let currentReviewStatus = latestReviewGateStatusForPull(
      statuses,
      pullNumber,
    );
    if (
      !trustedReviewGateReviewer(
        currentReviewStatus,
        pullNumber,
        baseBinding,
      )
    ) {
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
    if (pullRequestBaseBinding(current?.data) !== baseBinding) {
      throw new Error(
        "Pull request base changed while propagating review evidence",
      );
    }
    const latestStatuses = await collectAll(
      github,
      github.rest.repos.listCommitStatusesForRef,
      { owner, repo, ref: sourceHeadSha },
      "latest source review statuses",
    );
    const latestReviewStatus = latestReviewGateStatusForPull(
      latestStatuses,
      pullNumber,
    );
    const latestReviewer = trustedReviewGateReviewer(
      latestReviewStatus,
      pullNumber,
      baseBinding,
    );
    if (!latestReviewer) {
      throw new Error(
        "Pull request review gate changed while propagating review evidence",
      );
    }
    if (
      latestReviewer !== CODEX_LOGIN &&
      !await isCurrentlyTrustedHuman(github, {
        owner,
        repo,
        login: latestReviewer,
        pullAuthor: current?.data?.user?.login,
      })
    ) {
      throw new Error(
        "Human reviewer is no longer trusted for merge queue reuse",
      );
    }
    bindingVerified = false;
    await requireActiveMergeQueueBinding({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      baseSha,
      mergeGroupSha,
    });
    bindingVerified = true;
    currentReviewStatus = latestReviewStatus;
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
    return {
      state: "success",
      description,
      failure: undefined,
      published: true,
    };
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  if (bindingVerified && FULL_SHA.test(mergeGroupSha)) {
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
  return {
    state: "failure",
    description: undefined,
    failure,
    published: bindingVerified,
  };
}

/** Reconcile copied review proof on every active queue ref for one source. */
export async function reconcileActiveMergeGroupReviewStatuses({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  baseRef,
}) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Merge queue pull request number is invalid");
  }
  if (!FULL_SHA.test(sourceHeadSha)) {
    throw new Error("Merge queue source commit is malformed");
  }
  if (
    typeof baseRef !== "string" || baseRef.length === 0 ||
    baseRef.length > 1024 || baseRef.includes("\0")
  ) {
    throw new Error("Merge queue base ref is invalid");
  }
  const refs = await collectAll(
    github,
    github.rest.git.listMatchingRefs,
    {
      owner,
      repo,
      ref: `heads/gh-readonly-queue/${baseRef}/pr-${pullNumber}-`,
    },
    "merge queue refs",
  );
  const results = [];
  const seen = new Set();
  for (const queueRef of refs) {
    const parsed = parseMergeQueuePullNumber(queueRef?.ref);
    const mergeGroupSha = queueRef?.object?.sha;
    if (parsed?.pullNumber !== pullNumber) continue;
    if (!FULL_SHA.test(mergeGroupSha ?? "")) {
      throw new Error("Merge queue ref has a malformed commit");
    }
    if (seen.has(mergeGroupSha.toLowerCase())) continue;
    seen.add(mergeGroupSha.toLowerCase());
    const result = await publishMergeGroupReviewStatus({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      baseSha: parsed.baseSha,
      mergeGroupSha,
    });
    if (result.state === "failure" && !result.published) {
      throw result.failure ??
        new Error("Could not publish the merge queue review failure");
    }
    results.push(result);
  }
  return results;
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
  requestKey = /** @type {string | undefined} */ (undefined),
}) {
  // The comment body must stay a fixed instruction plus a verified commit
  // SHA. Never interpolate pull request controlled content here: this runs
  // with pull_request_target authority.
  if (typeof headSha !== "string" || !FULL_SHA.test(headSha)) {
    throw new Error(
      "Refusing to request an automated review of a malformed head commit",
    );
  }
  if (
    requestKey !== undefined &&
    (typeof requestKey !== "string" || !REQUEST_KEY.test(requestKey))
  ) {
    throw new Error("Refusing to use a malformed review request key");
  }
  const marker = `<!-- automated-review-request: ${headSha.toLowerCase()}${
    requestKey === undefined ? "" : ` ${requestKey}`
  } -->`;
  const comments = await collectAll(
    github,
    github.rest.issues.listComments,
    { owner, repo, issue_number: pullNumber },
    "request comments",
  );
  const alreadyRequested = hasReviewRequest(comments, headSha, requestKey);
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
