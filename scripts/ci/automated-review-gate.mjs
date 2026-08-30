import { createHash } from "node:crypto";

const BOTS = new Map([
  ["chatgpt-codex-connector[bot]", 199175422],
  ["github-actions[bot]", 41898282],
]);
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const GITHUB_ACTIONS_LOGIN = "github-actions[bot]";
const CODEX_NO_FINDINGS = "Codex Review: Didn't find any major issues.";
const CODEX_USAGE_LIMIT =
  /^You have reached your Codex usage limits(?: for [^.]+)?\. Please try again later\.$/i;
const CODEX_REVIEWED_COMMIT = /\*\*Reviewed commit:\*\* `([0-9a-f]{10})`/i;
const REVIEW_REQUEST_MARKER =
  /^<!-- automated-review-request: ([0-9a-f]{40})(?: ([a-z0-9-]{1,64}))? -->\n@codex review$/i;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REQUEST_KEY = /^[a-z0-9-]{1,64}$/i;
const MAX_ITEMS_PER_SOURCE = 500;
const MAX_TIMEOUT_TARGETS_PER_RUN = 25;
const MAX_TIMEOUT_DISCOVERY_PAGES = 20;
const REVIEW_PROPAGATION_RETRY_SUFFIX = "; queue retry pending";
const REVIEW_FAILURE_DETAILS = new Map([
  ["rate-limited", "automated review rate limited"],
  ["timed-out", "automated review timed out"],
  ["unavailable", "review status unavailable"],
]);
const TRUSTED_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const REVIEW_EPOCH_EVENTS = new Set([
  "base_ref_changed",
  "reopened",
  "ready_for_review",
]);
/** @type {(ref: string) => Promise<string | undefined>} */
const NO_COMMIT = () => Promise.resolve(undefined);
/** @type {(login: string) => Promise<boolean>} */
const NO_TRUSTED_HUMAN = () => Promise.resolve(false);

export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";
export const AUTOMATED_REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

const REVIEW_WAKEUP_PATH = ".github/workflows/automated-review-wakeup.yml";

function isPositiveStatusId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

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
  const titleMatch = /^automated-review-wakeup-pr-([1-9]\d*)-eligible$/.exec(
    displayTitle,
  );
  const pullNumber = titleMatch ? Number(titleMatch[1]) : undefined;
  const headRepositoryId = run?.head_repository?.id;
  if (
    !trustedPath ||
    run?.event !== "pull_request_review" ||
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

function isPinnedGraphqlBot(user, login) {
  const graphqlLogin = login.endsWith("[bot]") ? login.slice(0, -5) : login;
  return user?.login === graphqlLogin &&
    user?.databaseId === BOTS.get(login) &&
    user?.__typename === "Bot";
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

function durableReviewRequestKey(events, requestKey) {
  if (requestKey !== "reopen") return requestKey;
  const latestEpoch = latestReviewEpochChange(events);
  if (latestEpoch === undefined) {
    throw new Error("Could not resolve the current reopen event");
  }
  if (latestEpoch.kind !== "reopened") return undefined;
  if (!Number.isSafeInteger(latestEpoch.id) || latestEpoch.id < 1) {
    throw new Error("Reopen event identity is malformed");
  }
  return `reopen-${latestEpoch.id}`;
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

function latestReviewEpochChange(events) {
  let latest;
  for (const item of events) {
    if (!REVIEW_EPOCH_EVENTS.has(item?.event)) continue;
    const kind = item.event;
    const time = Date.parse(item?.created_at ?? "");
    if (!Number.isFinite(time)) {
      return { time: Number.POSITIVE_INFINITY, kind };
    }
    const id = Number.isSafeInteger(item?.id) && item.id > 0
      ? item.id
      : undefined;
    const laterAtSameTime = time === latest?.time && id !== undefined &&
      (!Number.isSafeInteger(latest?.id) || id > latest.id);
    if (latest === undefined || time > latest.time || laterAtSameTime) {
      latest = id === undefined
        ? { time, kind }
        : { time, kind, id, timelineEvent: kind };
    }
  }
  return latest;
}

function activeReviewBoundary(request, reviewNotBefore, epochChange) {
  // The issue event is GitHub's durable record of the review-epoch change. The
  // workflow writes its reset status later, so letting that timestamp replace
  // the event would reject valid evidence submitted between the two writes.
  if (epochChange !== undefined) return epochChange;
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
  timeMode = "created",
) {
  if (boundary === undefined) return "newer";
  const time = evidenceTime(evidence, timelineEvent, timeMode);
  if (!Number.isFinite(time)) return "ambiguous";
  if (time < boundary.time) return "older";
  if (time > boundary.time) return "newer";
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

function evidenceTime(evidence, timelineEvent, timeMode = "created") {
  if (timelineEvent === "reviewed") {
    return Date.parse(evidence?.submitted_at ?? "");
  }
  const createdAt = Date.parse(evidence?.created_at ?? "");
  if (timeMode !== "finding") return createdAt;
  const updatedAt = Date.parse(evidence?.updated_at ?? "");
  if (Number.isFinite(createdAt) && Number.isFinite(updatedAt)) {
    return Math.max(createdAt, updatedAt);
  }
  return Number.isFinite(updatedAt) ? updatedAt : createdAt;
}

function isProvablyUneditedComment(comment) {
  const createdAt = Date.parse(comment?.created_at ?? "");
  const updatedAt = Date.parse(comment?.updated_at ?? "");
  return Number.isFinite(createdAt) && Number.isFinite(updatedAt) &&
    updatedAt === createdAt;
}

function isEditedComment(comment) {
  const createdAt = Date.parse(comment?.created_at ?? "");
  const updatedAt = Date.parse(comment?.updated_at ?? "");
  return Number.isFinite(createdAt) && Number.isFinite(updatedAt) &&
    updatedAt !== createdAt;
}

function isEvidenceProvablyLater(candidate, current, timeline) {
  const candidateTime = candidate.time ?? evidenceTime(
    candidate.evidence,
    candidate.timelineEvent,
  );
  const currentTime = current.time ??
    evidenceTime(current.evidence, current.timelineEvent);
  if (!Number.isFinite(candidateTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  // The timeline records a comment's creation position, not its later edit.
  // It therefore cannot order a same-second success against an edited finding.
  if (
    current.timelineEvent === "commented" &&
    isEditedComment(current.evidence)
  ) return false;
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

function latestPendingReviewStatus(statuses, pullNumber) {
  const status = latestReviewGateStatusForPull(statuses, pullNumber);
  if (
    status?.state === "pending" &&
      isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN)
  ) return status;
  if (
    status?.state !== "failure" ||
    status?.description !==
      reviewFailureDescription(pullNumber, "unavailable") ||
    !isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN)
  ) return undefined;
  const descriptionPrefix = `PR#${pullNumber} `;
  return statuses.find((candidate) =>
    candidate?.context === AUTOMATED_REVIEW_STATUS_CONTEXT &&
    candidate?.state === "pending" &&
    typeof candidate?.description === "string" &&
    candidate.description.startsWith(descriptionPrefix) &&
    isPinnedBot(candidate?.creator, GITHUB_ACTIONS_LOGIN)
  );
}

function pendingReviewAge(status, now) {
  const createdAt = Date.parse(status?.created_at ?? "");
  return Number.isFinite(createdAt)
    ? now - createdAt
    : Number.POSITIVE_INFINITY;
}

function pendingStatusBelongsToReviewEpoch(
  status,
  boundary,
  pullNumber,
  baseBinding,
) {
  if (status === undefined) return false;
  if (boundary === undefined) return true;
  const createdAt = Date.parse(status.created_at ?? "");
  if (!Number.isFinite(createdAt)) return false;
  if (createdAt !== boundary.time) return createdAt > boundary.time;
  const resetPrefix = reviewResetDescription(pullNumber, baseBinding);
  const description = typeof status.description === "string"
    ? status.description
    : "";
  return description === resetPrefix ||
    description.startsWith(`${resetPrefix} key:`) ||
    (boundary.kind === "ready_for_review" &&
      description.startsWith(`PR#${pullNumber} waits for review `));
}

function latestCodexUsageLimit(
  comments,
  boundary,
  reviewFailureCommentId,
  timeline,
  headSha,
) {
  let latest;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const comment of comments) {
    const isTrigger = reviewFailureCommentId !== undefined &&
      comment?.id === reviewFailureCommentId;
    if (
      !isPinnedBot(comment?.user, CODEX_LOGIN) ||
      typeof comment?.body !== "string" ||
      !CODEX_USAGE_LIMIT.test(comment.body.trim()) ||
      (!isTrigger && !isProvablyUneditedComment(comment))
    ) continue;
    if (!commentFollowsHeadCommit(timeline, comment.id, headSha)) continue;
    if (
      evidenceFreshness(comment, "commented", boundary, timeline) !== "newer"
    ) continue;
    if (isTrigger) return comment;
    const createdAt = Date.parse(comment.created_at ?? "");
    if (!Number.isFinite(createdAt)) continue;
    if (createdAt >= latestAt) {
      latest = comment;
      latestAt = createdAt;
    }
  }
  return latest;
}

function forcePushedHeadSha(event) {
  const afterCommit = event?.after_commit;
  if (typeof afterCommit === "string") return afterCommit;
  if (typeof afterCommit?.sha === "string") return afterCommit.sha;
  if (typeof afterCommit?.oid === "string") return afterCommit.oid;
  return typeof event?.commit_id === "string" ? event.commit_id : undefined;
}

function commentFollowsHeadCommit(timeline, commentId, headSha) {
  const commentIndex = timeline.findIndex((item) =>
    item?.event === "commented" && item?.id === commentId
  );
  if (commentIndex < 0) return false;
  let headIndex = -1;
  for (const [index, item] of timeline.entries()) {
    if (
      (item?.event === "committed" && item?.sha === headSha) ||
      (item?.event === "head_ref_force_pushed" &&
        forcePushedHeadSha(item) === headSha)
    ) headIndex = index;
  }
  return headIndex >= 0 && commentIndex > headIndex;
}

function reviewFailureDescription(pullNumber, kind, retryPending = false) {
  const detail = REVIEW_FAILURE_DETAILS.get(kind) ??
    "review status unavailable";
  return `PR#${pullNumber} ${detail}${
    retryPending ? REVIEW_PROPAGATION_RETRY_SUFFIX : ""
  }`;
}

function reviewFailureKindFromDescription(
  description,
  pullNumber,
  retryPending = false,
) {
  for (const kind of REVIEW_FAILURE_DETAILS.keys()) {
    if (
      description === reviewFailureDescription(pullNumber, kind, retryPending)
    ) return kind;
  }
  return undefined;
}

function terminalStatusHasBoundaryProof(
  status,
  comments,
  boundary,
  timeline,
  headSha,
) {
  if (typeof status?.target_url !== "string") return false;
  const comment = comments.find((candidate) =>
    candidate?.html_url === status.target_url
  );
  return comment !== undefined &&
    latestCodexUsageLimit(
        [comment],
        boundary,
        comment.id,
        timeline,
        headSha,
      ) === comment;
}

function latestTerminalReviewStatus(
  statuses,
  pullNumber,
  boundary,
  comments,
  timeline,
  headSha,
) {
  const rateLimited = reviewFailureDescription(pullNumber, "rate-limited");
  const timedOut = reviewFailureDescription(pullNumber, "timed-out");
  for (const status of statuses) {
    if (
      status?.context !== AUTOMATED_REVIEW_STATUS_CONTEXT ||
      status?.state !== "failure" ||
      !isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN) ||
      (status?.description !== rateLimited &&
        status?.description !== timedOut)
    ) continue;
    if (boundary !== undefined) {
      const createdAt = Date.parse(status?.created_at ?? "");
      if (!Number.isFinite(createdAt) || createdAt < boundary.time) continue;
      if (
        createdAt === boundary.time &&
        !terminalStatusHasBoundaryProof(
          status,
          comments,
          boundary,
          timeline,
          headSha,
        )
      ) continue;
    }
    return status;
  }
  return undefined;
}

function canReusePendingStatus(
  status,
  pullNumber,
  isDraft,
  resetPending,
) {
  if (!status || !isPositiveStatusId(status.id) || resetPending) return false;
  const description = typeof status.description === "string"
    ? status.description
    : "";
  if (isDraft) return description === `PR#${pullNumber} draft waits for review`;
  return description.startsWith(`PR#${pullNumber} waits for review `) ||
    description.startsWith(`PR#${pullNumber} reset base:`);
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
    latestReviewEpochChange(events),
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
      const cleanVerdict = comment.body.startsWith(CODEX_NO_FINDINGS);
      const freshness = evidenceFreshness(
        comment,
        "commented",
        boundary,
        timeline,
        cleanVerdict ? "created" : "finding",
      );
      if (freshness === "older") continue;
      if (
        freshness === "newer" && cleanVerdict &&
        isProvablyUneditedComment(comment)
      ) {
        codexSuccesses.push({
          evidence: comment,
          time: evidenceTime(comment, "commented", "created"),
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
      } else if (!cleanVerdict) {
        codexFindings.push({
          evidence: comment,
          freshness,
          time: evidenceTime(comment, "commented", "finding"),
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

function mergeQueueTarget(queueRef, pullNumber) {
  const parsed = parseMergeQueuePullNumber(queueRef?.ref);
  if (parsed?.pullNumber !== pullNumber) return undefined;
  const mergeGroupSha = queueRef?.object?.sha;
  if (!FULL_SHA.test(mergeGroupSha ?? "")) {
    throw new Error("Merge queue ref has a malformed commit");
  }
  return {
    baseHeadSha: parsed.baseHeadSha,
    mergeGroupSha,
    key: mergeGroupSha.toLowerCase(),
    ref: queueRef.ref.startsWith("refs/")
      ? queueRef.ref.slice("refs/".length)
      : queueRef.ref,
  };
}

async function queueTargetIsActive({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  target,
}) {
  try {
    await requireActiveMergeQueueBinding({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      baseHeadSha: target.baseHeadSha,
      mergeGroupSha: target.mergeGroupSha,
    });
    return true;
  } catch {
    const liveTarget = await resolveQueueRefTarget(
      github,
      { owner, repo },
      target.ref,
    );
    return liveTarget?.toLowerCase() === target.key;
  }
}

async function publishQueueReviewResolutionFailure({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  pullUrl,
  queueRef,
  seen,
}) {
  const target = mergeQueueTarget(queueRef, pullNumber);
  if (!target || seen.has(target.key)) return;
  const common = { owner, repo };
  const currentHeadSha = await resolveCommitRef(
    github,
    common,
    `refs/pull/${pullNumber}/head`,
  );
  if (currentHeadSha?.toLowerCase() !== sourceHeadSha.toLowerCase()) return;
  if (
    !await queueTargetIsActive({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      target,
    })
  ) return;
  const finalSourceHeadSha = await resolveCommitRef(
    github,
    common,
    `refs/pull/${pullNumber}/head`,
  );
  if (finalSourceHeadSha?.toLowerCase() !== sourceHeadSha.toLowerCase()) return;
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: target.mergeGroupSha,
    state: "failure",
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description: `Could not revalidate review for PR #${pullNumber}`,
    target_url: pullUrl,
  });
  seen.add(target.key);
}

/** Fail one source head and every active queue commit derived from it. */
export async function publishReviewResolutionFailure({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  sourceStatusId = /** @type {number | undefined} */ (undefined),
  pullUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}`,
}) {
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new Error("Pull request number is invalid");
  }
  if (!FULL_SHA.test(sourceHeadSha)) {
    throw new Error("Pull request source commit is malformed");
  }
  if (sourceStatusId !== undefined && !isPositiveStatusId(sourceStatusId)) {
    throw new Error("Source review status identity is malformed");
  }
  const currentHeadSha = await resolveCommitRef(
    github,
    { owner, repo },
    `refs/pull/${pullNumber}/head`,
  );
  if (currentHeadSha?.toLowerCase() !== sourceHeadSha.toLowerCase()) {
    return { queueFailures: 0, skipped: true };
  }
  if (sourceStatusId === undefined) {
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: sourceHeadSha,
      state: "failure",
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description: `PR#${pullNumber} review status unavailable`,
      target_url: pullUrl,
    });
  } else {
    const statuses = await collectAll(
      github,
      github.rest.repos.listCommitStatusesForRef,
      { owner, repo, ref: sourceHeadSha },
      "source review statuses",
    );
    const latestStatus = latestReviewGateStatusForPull(statuses, pullNumber);
    if (
      latestStatus?.id !== sourceStatusId ||
      latestStatus?.state !== "failure" ||
      !isPinnedBot(latestStatus?.creator, GITHUB_ACTIONS_LOGIN)
    ) {
      throw new Error("Source review failure changed before queue propagation");
    }
  }
  const refs = await collectAll(
    github,
    github.rest.git.listMatchingRefs,
    { owner, repo, ref: "heads/gh-readonly-queue/" },
    "merge queue refs",
  );
  const seen = new Set();
  for (const queueRef of refs) {
    await publishQueueReviewResolutionFailure({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      pullUrl,
      queueRef,
      seen,
    });
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
  reviewFailureCommentId = /** @type {number | undefined} */ (undefined),
  now = Date.now(),
  reviewTimeoutMs = /** @type {number | undefined} */ (undefined),
  queuePropagationPending = false,
}) {
  let review;
  let failure;
  let pullAuthor;
  let baseBinding;
  let baseRef;
  let isDraft = false;
  let resetPending = false;
  let effectiveReviewResetKey = reviewResetKey;
  let existingPendingStatus;
  let existingTerminalStatus;
  let existingTerminalStatusIsLatest = false;
  let existingPropagationRetryStatus;
  let existingPropagationRetryKind;
  let reviewBoundary;
  let failureKind;
  let failureUrl;
  if (
    reviewResetKey !== undefined &&
    (typeof reviewResetKey !== "string" || !REQUEST_KEY.test(reviewResetKey))
  ) {
    failure = new Error("Review reset key is malformed");
  } else if (
    reviewFailureCommentId !== undefined &&
    (!Number.isSafeInteger(reviewFailureCommentId) ||
      reviewFailureCommentId < 1)
  ) {
    failure = new Error("Review failure comment identity is malformed");
  } else if (!Number.isFinite(now)) {
    failure = new Error("Review reconciliation time is invalid");
  } else if (
    reviewTimeoutMs !== undefined &&
    (!Number.isSafeInteger(reviewTimeoutMs) || reviewTimeoutMs < 1)
  ) {
    failure = new Error("Review timeout is invalid");
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
      effectiveReviewResetKey = durableReviewRequestKey(
        events,
        reviewResetKey,
      );
      resetPending = effectiveReviewResetKey !== undefined &&
        !hasReviewRequest(comments, headSha, effectiveReviewResetKey) &&
        !hasReviewReset(
          statuses,
          pullNumber,
          baseBinding,
          effectiveReviewResetKey,
        );
      existingPendingStatus = latestPendingReviewStatus(
        statuses,
        pullNumber,
      );
      const reviewNotBefore = latestReviewResetTime(
        statuses,
        pullNumber,
        baseBinding,
      );
      reviewBoundary = activeReviewBoundary(
        latestReviewRequest(comments, headSha),
        reviewNotBefore,
        latestReviewEpochChange(events),
      );
      if (
        !pendingStatusBelongsToReviewEpoch(
          existingPendingStatus,
          reviewBoundary,
          pullNumber,
          baseBinding,
        )
      ) existingPendingStatus = undefined;
      existingTerminalStatus = latestTerminalReviewStatus(
        statuses,
        pullNumber,
        reviewBoundary,
        comments,
        timeline,
        headSha,
      );
      existingTerminalStatusIsLatest = existingTerminalStatus?.id ===
        latestReviewGateStatusForPull(statuses, pullNumber)?.id;
      const propagationRetry = latestReviewPropagationRetryStatus(
        statuses,
        pullNumber,
        reviewBoundary,
        comments,
        timeline,
        headSha,
      );
      existingPropagationRetryStatus = propagationRetry?.status;
      existingPropagationRetryKind = propagationRetry?.failureKind;
      if (
        !isDraft &&
        (!resetPending || REVIEW_EPOCH_EVENTS.has(reviewBoundary?.kind))
      ) {
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
          reviewNotBefore,
        );
        if (!review) {
          if (existingPropagationRetryStatus) {
            failure = new Error("Automated review queue propagation is pending");
            failureKind = existingPropagationRetryKind;
            failureUrl = typeof existingPropagationRetryStatus.target_url ===
                "string"
              ? existingPropagationRetryStatus.target_url
              : undefined;
          } else {
            const usageLimit = latestCodexUsageLimit(
              comments,
              reviewBoundary,
              reviewFailureCommentId,
              timeline,
              headSha,
            );
            if (usageLimit) {
              failure = new Error("Automated review was rate limited");
              failureKind = "rate-limited";
              failureUrl = typeof usageLimit.html_url === "string"
                ? usageLimit.html_url
                : undefined;
            } else if (
              existingPendingStatus &&
              reviewTimeoutMs !== undefined &&
              pendingReviewAge(existingPendingStatus, now) >= reviewTimeoutMs
            ) {
              failure = new Error("Automated review timed out");
              failureKind = "timed-out";
            }
            if (!failure && existingTerminalStatus) {
              failureKind = existingTerminalStatus.description.endsWith(
                  "rate limited",
                )
                ? "rate-limited"
                : "timed-out";
              failure = new Error(
                failureKind === "rate-limited"
                  ? "Automated review remains rate limited"
                  : "Automated review remains timed out",
              );
              failureUrl = typeof existingTerminalStatus.target_url ===
                  "string"
                ? existingTerminalStatus.target_url
                : undefined;
            }
          }
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
    if (pullRequestBaseBinding(current?.data) !== baseBinding) {
      review = undefined;
      throw new Error(
        "Pull request base changed while checking review evidence",
      );
    }
  } catch (error) {
    review = undefined;
    failure = error instanceof Error ? error : new Error(String(error));
    failureKind = undefined;
    failureUrl = undefined;
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
  if (failure && existingPropagationRetryStatus) {
    description = existingPropagationRetryStatus.description;
  } else if (failure) {
    description = reviewFailureDescription(
      pullNumber,
      failureKind ?? "unavailable",
      queuePropagationPending,
    );
  } else if (review) {
    description = `PR#${pullNumber} base:${baseBinding} by:${review.reviewer}`;
  } else if (resetPending) {
    description = reviewResetDescription(
      pullNumber,
      baseBinding,
      effectiveReviewResetKey,
    );
  } else if (isDraft) description = `PR#${pullNumber} draft waits for review`;
  else {
    description = `PR#${pullNumber} waits for review ${headSha.slice(0, 12)}`;
  }
  if (
    state === "failure" &&
    existingPropagationRetryStatus?.description === description &&
    isPositiveStatusId(existingPropagationRetryStatus.id)
  ) {
    return {
      state,
      review,
      failure,
      description,
      baseRef,
      statusId: existingPropagationRetryStatus.id,
      targetUrl: existingPropagationRetryStatus.target_url,
    };
  }
  if (
    state === "failure" &&
    existingTerminalStatusIsLatest &&
    existingTerminalStatus?.description === description &&
    isPositiveStatusId(existingTerminalStatus.id)
  ) {
    return {
      state,
      review,
      failure,
      description,
      baseRef,
      statusId: existingTerminalStatus.id,
    };
  }
  if (
    state === "pending" &&
    canReusePendingStatus(
      existingPendingStatus,
      pullNumber,
      isDraft,
      resetPending,
    )
  ) {
    return {
      state,
      review,
      failure,
      description: existingPendingStatus.description,
      baseRef,
      statusId: existingPendingStatus.id,
    };
  }
  let targetUrl = failureUrl ?? review?.url ?? pullUrl;
  const statusResponse = await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state,
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description,
    target_url: targetUrl,
  });
  let statusId = statusResponse?.data?.id;
  if (state === "success" && !isPositiveStatusId(statusId)) {
    failure = new TypeError("Published review status identity is malformed");
    state = "failure";
    review = undefined;
    description = reviewFailureDescription(
      pullNumber,
      "unavailable",
      queuePropagationPending,
    );
    targetUrl = pullUrl;
    const failureResponse = await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      state,
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description,
      target_url: pullUrl,
    });
    statusId = failureResponse?.data?.id;
    if (!isPositiveStatusId(statusId)) {
      throw failure;
    }
  }
  if (statusId !== undefined && !isPositiveStatusId(statusId)) {
    throw new TypeError("Published review status identity is malformed");
  }
  return {
    state,
    review,
    failure,
    description,
    baseRef,
    statusId,
    targetUrl,
  };
}

function requireReviewTimeoutInputs(now, reviewTimeoutMs) {
  if (!Number.isFinite(now)) {
    throw new TypeError("Review timeout discovery time is invalid");
  }
  if (!Number.isSafeInteger(reviewTimeoutMs) || reviewTimeoutMs < 1) {
    throw new TypeError("Review timeout is invalid");
  }
}

/** Discover current non-draft pull request heads whose review status expired. */
const TIMED_OUT_AUTOMATED_REVIEWS_QUERY = `
  query TimedOutAutomatedReviews(
    $owner: String!
    $repo: String!
    $cursor: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequests(
        first: 50
        after: $cursor
        states: OPEN
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          number
          isDraft
          headRefOid
          commits(last: 1) {
            nodes {
              commit {
                status {
                  contexts {
                    context
                    state
                    description
                    createdAt
                    creator {
                      __typename
                      login
                      ... on Bot {
                        databaseId
                      }
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

function reviewTimeoutContext(pull, pullNumber) {
  const commitNodes = pull?.commits?.nodes;
  if (!Array.isArray(commitNodes)) {
    throw new TypeError(`PR #${pullNumber} commit rollup is malformed`);
  }
  const status = commitNodes[0]?.commit?.status;
  if (status == null) return undefined;
  const contexts = status?.contexts;
  if (!Array.isArray(contexts)) {
    throw new TypeError(`PR #${pullNumber} status rollup is malformed`);
  }
  const descriptionPrefix = `PR#${pullNumber} `;
  return contexts.find((context) => {
    if (
      context?.context !== AUTOMATED_REVIEW_STATUS_CONTEXT ||
      !isPinnedGraphqlBot(context?.creator, GITHUB_ACTIONS_LOGIN) ||
      typeof context?.description !== "string"
    ) return false;
    if (context.state === "PENDING") {
      return context.description.startsWith(descriptionPrefix);
    }
    return context.state === "FAILURE" &&
      (context.description ===
          reviewFailureDescription(pullNumber, "unavailable") ||
        reviewFailureKindFromDescription(
            context.description,
            pullNumber,
            true,
          ) !== undefined);
  });
}

function timeoutDiscoveryPage(response) {
  const pullRequests = response?.repository?.pullRequests;
  if (!Array.isArray(pullRequests?.nodes)) {
    throw new TypeError("Open pull request rollup is malformed");
  }
  const pageInfo = pullRequests?.pageInfo;
  if (pageInfo?.hasNextPage !== true) {
    return { nodes: pullRequests.nodes, cursor: undefined };
  }
  if (typeof pageInfo?.endCursor !== "string" || !pageInfo.endCursor) {
    throw new TypeError("Open pull request cursor is malformed");
  }
  return { nodes: pullRequests.nodes, cursor: pageInfo.endCursor };
}

function timedOutReviewTarget(pull, now, reviewTimeoutMs) {
  if (pull?.isDraft === true) return undefined;
  const pullNumber = pull?.number;
  const headSha = pull?.headRefOid;
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new TypeError("Open pull request number is invalid");
  }
  if (typeof headSha !== "string" || !FULL_SHA.test(headSha)) {
    throw new TypeError(`PR #${pullNumber} head commit is invalid`);
  }
  const timeoutContext = reviewTimeoutContext(pull, pullNumber);
  if (!timeoutContext) return undefined;
  if (timeoutContext.state === "FAILURE") {
    return { pullNumber, headSha: headSha.toLowerCase() };
  }
  const createdAt = Date.parse(timeoutContext?.createdAt ?? "");
  if (Number.isFinite(createdAt) && now - createdAt < reviewTimeoutMs) {
    return undefined;
  }
  return { pullNumber, headSha: headSha.toLowerCase() };
}

export async function findTimedOutAutomatedReviews({
  github,
  owner,
  repo,
  now = Date.now(),
  reviewTimeoutMs = AUTOMATED_REVIEW_TIMEOUT_MS,
}) {
  requireReviewTimeoutInputs(now, reviewTimeoutMs);
  const targets = [];
  let cursor;
  for (let page = 0; page < MAX_TIMEOUT_DISCOVERY_PAGES; page += 1) {
    const response = await github.graphql(TIMED_OUT_AUTOMATED_REVIEWS_QUERY, {
      owner,
      repo,
      cursor,
    });
    const pageResult = timeoutDiscoveryPage(response);
    for (const pull of pageResult.nodes) {
      const target = timedOutReviewTarget(pull, now, reviewTimeoutMs);
      if (!target) continue;
      targets.push(target);
      if (targets.length >= MAX_TIMEOUT_TARGETS_PER_RUN) return targets;
    }
    if (pageResult.cursor === undefined) return targets;
    cursor = pageResult.cursor;
  }
  throw new Error("Timeout discovery exceeded 1,000 open pull requests");
}

function latestReviewPropagationRetryStatus(
  statuses,
  pullNumber,
  boundary,
  comments = [],
  timeline = [],
  headSha = "",
) {
  const status = latestReviewGateStatusForPull(statuses, pullNumber);
  if (
    status?.state !== "failure" ||
    !isPositiveStatusId(status?.id) ||
    !isPinnedBot(status?.creator, GITHUB_ACTIONS_LOGIN)
  ) return undefined;
  const failureKind = reviewFailureKindFromDescription(
    status.description,
    pullNumber,
    true,
  );
  if (failureKind === undefined) return undefined;
  if (boundary !== undefined) {
    const createdAt = Date.parse(status?.created_at ?? "");
    if (!Number.isFinite(createdAt) || createdAt < boundary.time) {
      return undefined;
    }
    if (
      createdAt === boundary.time &&
      !terminalStatusHasBoundaryProof(
        status,
        comments,
        boundary,
        timeline,
        headSha,
      )
    ) return undefined;
  }
  return { status, failureKind };
}

async function finalizeReviewFailureStatus({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  failureKind,
  targetUrl,
}) {
  const description = reviewFailureDescription(pullNumber, failureKind);
  const response = await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state: "failure",
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description,
    target_url: targetUrl,
  });
  const statusId = response?.data?.id;
  if (!isPositiveStatusId(statusId)) {
    throw new TypeError("Final review failure status identity is malformed");
  }
  return { description, statusId };
}

async function publishReviewPropagationRetryStatus({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  failureKind,
  targetUrl,
}) {
  const description = reviewFailureDescription(
    pullNumber,
    failureKind,
    true,
  );
  const response = await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state: "failure",
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description,
    target_url: targetUrl,
  });
  const statusId = response?.data?.id;
  if (!isPositiveStatusId(statusId)) {
    throw new TypeError("Review propagation retry status identity is malformed");
  }
  return { description, statusId };
}

async function propagateAndFinalizeReviewFailure({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  sourceStatusId,
  failureKind,
  targetUrl,
}) {
  const resolution = await publishReviewResolutionFailure({
    github,
    owner,
    repo,
    pullNumber,
    sourceHeadSha: headSha,
    sourceStatusId,
  });
  const finalStatus = await finalizeReviewFailureStatus({
    github,
    owner,
    repo,
    pullNumber,
    headSha,
    failureKind,
    targetUrl,
  });
  return { resolution, ...finalStatus };
}

/** Propagate one published retry marker, then restore its terminal diagnosis. */
export async function completeReviewFailurePropagation({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  sourceStatusId,
  description,
  targetUrl,
}) {
  if (!isPositiveStatusId(sourceStatusId)) {
    throw new Error("Review failure retry status identity is malformed");
  }
  const failureKind = reviewFailureKindFromDescription(
    description,
    pullNumber,
    true,
  );
  if (failureKind === undefined) {
    throw new Error("Review failure retry description is malformed");
  }
  return propagateAndFinalizeReviewFailure({
    github,
    owner,
    repo,
    pullNumber,
    headSha,
    sourceStatusId,
    failureKind,
    targetUrl,
  });
}

/** Revalidate one discovered timeout and publish under the per-pull lock. */
export async function expireTimedOutAutomatedReview({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  now = Date.now(),
  reviewTimeoutMs = AUTOMATED_REVIEW_TIMEOUT_MS,
}) {
  requireReviewTimeoutInputs(now, reviewTimeoutMs);
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) {
    throw new TypeError("Timed-out pull request number is invalid");
  }
  if (typeof headSha !== "string" || !FULL_SHA.test(headSha)) {
    throw new TypeError("Timed-out pull request head is invalid");
  }
  const response = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  const pull = response?.data;
  if (
    pull?.state !== "open" ||
    typeof pull?.head?.sha !== "string" ||
    pull.head.sha.toLowerCase() !== headSha.toLowerCase()
  ) return { expired: false, reason: "stale-head" };
  if (pull?.draft === true) return { expired: false, reason: "draft" };

  const statuses = await collectAll(
    github,
    github.rest.repos.listCommitStatusesForRef,
    { owner, repo, ref: headSha },
    "timeout review statuses",
  );
  const pullUrl = typeof pull.html_url === "string"
    ? pull.html_url
    : `https://github.com/${owner}/${repo}/pull/${pullNumber}`;
  const retryStatus = latestReviewPropagationRetryStatus(
    statuses,
    pullNumber,
  );
  const retrying = retryStatus !== undefined;
  const pendingStatus = latestPendingReviewStatus(statuses, pullNumber);
  if (!retrying && !pendingStatus) {
    return { expired: false, reason: "status-changed" };
  }
  if (
    !retrying && pendingReviewAge(pendingStatus, now) < reviewTimeoutMs
  ) {
    return { expired: false, reason: "not-expired" };
  }

  const result = await publishAutomatedReviewStatus({
    github,
    owner,
    repo,
    pullNumber,
    headSha,
    pullUrl,
    now,
    reviewTimeoutMs,
    queuePropagationPending: true,
  });
  if (result.state === "failure") {
    const failureKind = reviewFailureKindFromDescription(
      result.description,
      pullNumber,
      true,
    );
    if (failureKind === undefined || !isPositiveStatusId(result.statusId)) {
      throw new Error("Review failure retry status is malformed");
    }
    const propagated = await propagateAndFinalizeReviewFailure({
      github,
      owner,
      repo,
      pullNumber,
      headSha,
      sourceStatusId: result.statusId,
      failureKind,
      targetUrl: result.targetUrl ?? pullUrl,
    });
    return {
      ...result,
      ...propagated,
      expired: true,
      retried: retrying,
    };
  }
  if (typeof result.baseRef === "string") {
    let queueResults;
    try {
      queueResults = await reconcileActiveMergeGroupReviewStatuses({
        github,
        owner,
        repo,
        pullNumber,
        sourceHeadSha: headSha,
        baseRef: result.baseRef,
      });
    } catch (error) {
      if (result.state === "success") {
        await publishReviewPropagationRetryStatus({
          github,
          owner,
          repo,
          pullNumber,
          headSha,
          failureKind: retryStatus?.failureKind ?? "unavailable",
          targetUrl: typeof retryStatus?.status?.target_url === "string"
            ? retryStatus.status.target_url
            : result.targetUrl ?? pullUrl,
        });
      }
      throw error;
    }
    return {
      ...result,
      expired: false,
      reason: result.state === "success" ? "reviewed" : "revalidated",
      queueResults,
    };
  }
  return { ...result, expired: false, reason: "revalidated" };
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
  let sourceStatusId;
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
    sourceStatusId = latestReviewPropagationRetryStatus(
      statuses,
      pullNumber,
    )?.status?.id;
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
    sourceStatusId,
    pullUrl: typeof response?.data?.html_url === "string"
      ? response.data.html_url
      : undefined,
  });
  return { headSha, description, ...result };
}

/** Extract the pull request and base commit represented by a merge queue ref. */
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
    ? { pullNumber, baseHeadSha: match[2].toLowerCase() }
    : undefined;
}

/** Select the boundary captured by the publisher that actually failed. */
export function selectMergeGroupFailureStatusBoundary({
  targetResult,
  targetStatusId,
  publisherStatusId,
}) {
  const statusId = targetResult === "success" &&
      publisherStatusId !== undefined
    ? publisherStatusId
    : targetStatusId;
  return Number.isSafeInteger(statusId) && statusId >= 0
    ? statusId
    : undefined;
}

/** Preserve a trusted merge-group success written after one run's boundary. */
export function shouldPreserveLaterMergeGroupSuccess({
  latestStatus,
  reconciliationStatusId,
  pullNumber,
}) {
  return Number.isSafeInteger(reconciliationStatusId) &&
    reconciliationStatusId >= 0 &&
    Number.isSafeInteger(pullNumber) && pullNumber >= 1 &&
    Number.isSafeInteger(latestStatus?.id) &&
    latestStatus.id !== reconciliationStatusId &&
    latestStatus?.context === AUTOMATED_REVIEW_STATUS_CONTEXT &&
    latestStatus?.state === "success" &&
    isPinnedBot(latestStatus?.creator, GITHUB_ACTIONS_LOGIN) &&
    latestStatus?.description ===
      `Reused exact-head review for PR #${pullNumber}`;
}

function assertMergeGroupInputs({
  pullNumber,
  sourceHeadSha,
  baseHeadSha,
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
  if (!FULL_SHA.test(baseHeadSha)) {
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
  baseHeadSha,
  mergeGroupSha,
}) {
  const response = await github.graphql(ACTIVE_MERGE_QUEUE_BINDING_QUERY, {
    owner,
    repo,
    number: pullNumber,
  });
  const pull = response?.repository?.pullRequest;
  const entry = pull?.mergeQueueEntry;
  const liveBaseHeadSha = entry?.baseCommit?.oid;
  const queueHeadSha = entry?.headCommit?.oid;
  const baseRef = pull?.baseRefName;
  const normalizedBaseHeadSha = baseHeadSha.toLowerCase();
  if (
    pull?.number !== pullNumber || pull?.state !== "OPEN" ||
    pull?.headRefOid?.toLowerCase() !== sourceHeadSha.toLowerCase() ||
    liveBaseHeadSha?.toLowerCase() !== normalizedBaseHeadSha ||
    queueHeadSha?.toLowerCase() !== mergeGroupSha.toLowerCase() ||
    typeof baseRef !== "string" || baseRef.length === 0 ||
    baseRef.length > 1024 || baseRef.includes("\0")
  ) {
    throw new Error(
      "Merge group is not bound to the current pull request head",
    );
  }
  const ref =
    `heads/gh-readonly-queue/${baseRef}/pr-${pullNumber}-${normalizedBaseHeadSha}`;
  const parsed = parseMergeQueuePullNumber(`refs/${ref}`);
  if (
    parsed?.pullNumber !== pullNumber ||
    parsed?.baseHeadSha !== normalizedBaseHeadSha
  ) {
    throw new Error("Merge queue ref identity is malformed");
  }
  const liveRef = await github.rest.git.getRef({ owner, repo, ref });
  if (
    liveRef?.data?.object?.sha?.toLowerCase() !== mergeGroupSha.toLowerCase()
  ) {
    throw new Error("Merge queue ref no longer targets this merge group");
  }
}

async function readMergeGroupSourceEvidence({
  github,
  common,
  pullNumber,
  sourceHeadSha,
}) {
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
  return { reviews, comments, events, statuses, timeline };
}

async function requireCurrentAutomatedReview({
  github,
  common,
  evidence,
  sourceHeadSha,
  pull,
  pullNumber,
  baseBinding,
}) {
  const liveReview = await findAutomatedReview(
    evidence,
    sourceHeadSha,
    (ref) => resolveCommitRef(github, common, ref),
    (login) =>
      isCurrentlyTrustedHuman(github, {
        ...common,
        login,
        pullAuthor: pull?.data?.user?.login,
      }),
    latestReviewResetTime(evidence.statuses, pullNumber, baseBinding),
  );
  if (!liveReview) {
    throw new Error("Pull request does not have current review evidence");
  }
}

function requireTrustedReviewGate(statuses, pullNumber, baseBinding) {
  const status = latestReviewGateStatusForPull(statuses, pullNumber);
  if (!trustedReviewGateReviewer(status, pullNumber, baseBinding)) {
    throw new Error(
      "Pull request head does not have a current trusted review gate",
    );
  }
}

async function requireUnchangedSourcePull({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  baseBinding,
}) {
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
  return current;
}

async function latestTrustedReviewGateStatus({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  baseBinding,
  current,
}) {
  const latestStatuses = await collectAll(
    github,
    github.rest.repos.listCommitStatusesForRef,
    { owner, repo, ref: sourceHeadSha },
    "latest source review statuses",
  );
  const status = latestReviewGateStatusForPull(latestStatuses, pullNumber);
  const reviewer = trustedReviewGateReviewer(status, pullNumber, baseBinding);
  if (!reviewer) {
    throw new Error(
      "Pull request review gate changed while propagating review evidence",
    );
  }
  if (
    reviewer !== CODEX_LOGIN &&
    !await isCurrentlyTrustedHuman(github, {
      owner,
      repo,
      login: reviewer,
      pullAuthor: current?.data?.user?.login,
    })
  ) {
    throw new Error(
      "Human reviewer is no longer trusted for merge queue reuse",
    );
  }
  return status;
}

async function publishSuccessfulMergeGroupReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  mergeGroupSha,
  currentReviewStatus,
  pullUrl,
}) {
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
}

async function publishVerifiedMergeGroupReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  baseHeadSha,
  mergeGroupSha,
  pullUrlRef,
}) {
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
  pullUrlRef.value = pull.data.html_url ?? pullUrlRef.value;
  const common = { owner, repo };
  const evidence = await readMergeGroupSourceEvidence({
    github,
    common,
    pullNumber,
    sourceHeadSha,
  });
  await requireCurrentAutomatedReview({
    github,
    common,
    evidence,
    sourceHeadSha,
    pull,
    pullNumber,
    baseBinding,
  });
  requireTrustedReviewGate(evidence.statuses, pullNumber, baseBinding);
  const current = await requireUnchangedSourcePull({
    github,
    owner,
    repo,
    pullNumber,
    sourceHeadSha,
    baseBinding,
  });
  const currentReviewStatus = await latestTrustedReviewGateStatus({
    github,
    owner,
    repo,
    pullNumber,
    sourceHeadSha,
    baseBinding,
    current,
  });
  try {
    await requireActiveMergeQueueBinding({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      baseHeadSha,
      mergeGroupSha,
    });
  } catch (error) {
    return {
      state: "failure",
      description: undefined,
      failure: error instanceof Error ? error : new Error(String(error)),
      published: false,
    };
  }
  return publishSuccessfulMergeGroupReviewStatus({
    github,
    owner,
    repo,
    pullNumber,
    mergeGroupSha,
    currentReviewStatus,
    pullUrl: pullUrlRef.value,
  });
}

/** Reuse a successful exact-head review for a synthetic merge queue commit. */
export async function publishMergeGroupReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  baseHeadSha,
  mergeGroupSha,
}) {
  const pullUrlRef = {
    value: `https://github.com/${owner}/${repo}/pull/${pullNumber}`,
  };
  try {
    assertMergeGroupInputs({
      pullNumber,
      sourceHeadSha,
      baseHeadSha,
      mergeGroupSha,
    });
    await requireActiveMergeQueueBinding({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      baseHeadSha,
      mergeGroupSha,
    });
  } catch (error) {
    return {
      state: "failure",
      description: undefined,
      failure: error instanceof Error ? error : new Error(String(error)),
      published: false,
    };
  }

  try {
    return await publishVerifiedMergeGroupReviewStatus({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      baseHeadSha,
      mergeGroupSha,
      pullUrlRef,
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: mergeGroupSha,
      state: "failure",
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description: "Could not reuse an exact-head review",
      target_url: pullUrlRef.value,
    });
    return {
      state: "failure",
      description: undefined,
      failure,
      published: true,
    };
  }
}

async function reconcileMergeQueueTarget({
  github,
  owner,
  repo,
  pullNumber,
  sourceHeadSha,
  target,
}) {
  const result = await publishMergeGroupReviewStatus({
    github,
    owner,
    repo,
    pullNumber,
    sourceHeadSha,
    baseHeadSha: target.baseHeadSha,
    mergeGroupSha: target.mergeGroupSha,
  });
  if (result.state !== "failure" || result.published === true) {
    return { result };
  }
  // No replacement status reached this synthetic commit, so any prior
  // success it carries would keep satisfying the queue's required check.
  // Skip only when the exact queue ref demonstrably no longer targets the
  // commit (a confirmed identity change); an operational lookup failure must
  // fail reconciliation so its independent invalidation path takes over.
  const liveTarget = await resolveQueueRefTarget(
    github,
    { owner, repo },
    target.ref,
  );
  if (liveTarget?.toLowerCase() !== target.key) return {};
  return {
    unpublished: result.failure ??
      new Error("Merge queue review status was not replaced"),
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
  const unpublished = [];
  for (const queueRef of refs) {
    const target = mergeQueueTarget(queueRef, pullNumber);
    if (!target || seen.has(target.key)) continue;
    seen.add(target.key);
    const outcome = await reconcileMergeQueueTarget({
      github,
      owner,
      repo,
      pullNumber,
      sourceHeadSha,
      target,
    });
    if (outcome.unpublished) unpublished.push(outcome.unpublished);
    if (outcome.result) results.push(outcome.result);
  }
  if (unpublished.length > 0) {
    throw new Error(
      `Review proof was not replaced on ${unpublished.length} active merge ` +
        `queue commit(s): ${
          unpublished.map((error) => error.message).join("; ")
        }`,
    );
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
 * Immediately before posting, re-fetch the pull request and require it to
 * remain open and non-draft with a current head that matches the event head.
 * That prevents a queued run from consuming review quota after the pull
 * request becomes ineligible or marking an old SHA while its unqualified
 * request targets a newer current head.
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
  let effectiveRequestKey = requestKey;
  if (requestKey === "reopen") {
    const events = await collectAll(
      github,
      github.rest.issues.listEvents,
      { owner, repo, issue_number: pullNumber },
      "review epoch events",
    );
    effectiveRequestKey = durableReviewRequestKey(events, requestKey);
    if (effectiveRequestKey === undefined) {
      return { requested: false, reason: "stale-epoch" };
    }
  }
  const marker = `<!-- automated-review-request: ${headSha.toLowerCase()}${
    effectiveRequestKey === undefined ? "" : ` ${effectiveRequestKey}`
  } -->`;
  const comments = await collectAll(
    github,
    github.rest.issues.listComments,
    { owner, repo, issue_number: pullNumber },
    "request comments",
  );
  const alreadyRequested = hasReviewRequest(
    comments,
    headSha,
    effectiveRequestKey,
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
  if (response?.data?.state !== "open" || response?.data?.draft !== false) {
    return { requested: false, marker, reason: "ineligible-pull" };
  }
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body: `${marker}\n@codex review`,
  });
  return { requested: true, marker };
}
