const AUTOMATED_REVIEW_LOGINS = new Set([
  "coderabbitai[bot]",
  "chatgpt-codex-connector[bot]",
]);
const CODERABBIT_LOGIN = "coderabbitai[bot]";
const CODERABBIT_RECENT_REVIEW_MARKER = "<!-- recent_review_start -->";
const CODERABBIT_RECENT_REVIEW_END_MARKER = "<!-- recent_review_end -->";
const CODERABBIT_NO_ACTIONABLE_REVIEW_MARKER =
  "No actionable comments were generated in the recent review.";
const CODERABBIT_REVIEW_RANGE_PATTERN =
  /Reviewing files between\s+([0-9a-f]{40})\s+and\s+([0-9a-f]{40})(?:\.|\s|$)/i;
const CODERABBIT_REQUESTED_COMMIT_PATTERN =
  /Requested commit:\s*([0-9a-f]{40})/i;
const CODERABBIT_SKIPPED_COMMIT_PATTERN =
  /Review skipped for current commit\s*([0-9a-f]{40})/i;
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const CODEX_BOT_ID = 199175422;
const CODEX_NO_FINDING_PREFIX = "Codex Review: Didn't find any major issues.";
const CODEX_REVIEWED_COMMIT_PATTERN =
  /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10})`/i;
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
/** @type {(ref: string) => Promise<string | undefined>} */
const NO_COMMIT_RESOLVER = () => Promise.resolve(undefined);
export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";
const SUBMITTED_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

/** Find an actual automated review submitted against the current PR head. */
export async function findAutomatedReview(
  {
    reviews,
    comments,
    resolveCommit = NO_COMMIT_RESOLVER,
  },
  headSha,
) {
  const events = [
    ...reviews.map((review, index) => ({
      kind: "review",
      value: review,
      order: index,
      time: automatedReviewEventTime(review),
    })),
    ...comments.map((comment, index) => ({
      kind: "comment",
      value: comment,
      order: reviews.length + index,
      time: automatedReviewEventTime(comment),
    })),
  ];
  const everyEventIsTimestamped = events.every((event) =>
    event.time !== undefined
  );
  events.sort((left, right) =>
    everyEventIsTimestamped
      ? right.time - left.time || right.order - left.order
      : right.order - left.order
  );

  for (const event of events) {
    if (event.kind === "review") {
      const review = event.value;
      const login = review?.user?.login;
      if (
        typeof login !== "string" ||
        !AUTOMATED_REVIEW_LOGINS.has(login.toLowerCase()) ||
        review?.commit_id !== headSha
      ) {
        continue;
      }
      const state = review?.state;
      if (
        typeof state !== "string" ||
        !SUBMITTED_REVIEW_STATES.has(state.toUpperCase()) ||
        typeof review?.submitted_at !== "string" ||
        review.submitted_at.length === 0
      ) {
        return undefined;
      }
      return {
        reviewer: login,
        source: "review",
        state: state.toUpperCase(),
        url: typeof review.html_url === "string" ? review.html_url : undefined,
      };
    }

    const comment = event.value;
    const login = comment?.user?.login;
    const body = comment?.body;
    if (
      typeof login === "string" &&
      login.toLowerCase() === CODEX_LOGIN &&
      comment?.user?.type === "Bot" &&
      comment?.user?.id === CODEX_BOT_ID &&
      typeof body === "string"
    ) {
      const reviewedCommit = body.match(CODEX_REVIEWED_COMMIT_PATTERN)?.[1];
      if (typeof reviewedCommit === "string") {
        const resolvedCommit = await resolveCommit(reviewedCommit);
        if (
          typeof resolvedCommit === "string" &&
          FULL_COMMIT_PATTERN.test(resolvedCommit) &&
          resolvedCommit.toLowerCase() === headSha.toLowerCase()
        ) {
          return body.startsWith(CODEX_NO_FINDING_PREFIX)
            ? {
              reviewer: login,
              source: "summary",
              state: "COMMENTED",
              url: typeof comment.html_url === "string"
                ? comment.html_url
                : undefined,
            }
            : undefined;
        }
      }
    }
    if (
      typeof login === "string" &&
      login.toLowerCase() === CODERABBIT_LOGIN &&
      typeof body === "string"
    ) {
      const skippedTip = body.match(CODERABBIT_SKIPPED_COMMIT_PATTERN)?.[1];
      const requestedTip = body.match(
        CODERABBIT_REQUESTED_COMMIT_PATTERN,
      )?.[1];
      if (
        skippedTip?.toLowerCase() === headSha.toLowerCase() ||
        requestedTip?.toLowerCase() === headSha.toLowerCase()
      ) {
        return undefined;
      }
      if (!body.includes(CODERABBIT_RECENT_REVIEW_MARKER)) continue;
      const recentReview = codeRabbitRecentReview(body);
      const reviewedTip = recentReview?.match(
        CODERABBIT_REVIEW_RANGE_PATTERN,
      )?.[2];
      const outcomeTip = skippedTip?.toLowerCase() === headSha.toLowerCase()
        ? skippedTip
        : reviewedTip ?? requestedTip;
      if (
        typeof outcomeTip !== "string" ||
        outcomeTip.toLowerCase() !== headSha.toLowerCase()
      ) {
        continue;
      }
      return recentReview?.includes(CODERABBIT_NO_ACTIONABLE_REVIEW_MARKER) &&
          skippedTip?.toLowerCase() !== headSha.toLowerCase() &&
          reviewedTip?.toLowerCase() === headSha.toLowerCase()
        ? {
          reviewer: login,
          source: "summary",
          state: "COMMENTED",
          url: typeof comment.html_url === "string"
            ? comment.html_url
            : undefined,
        }
        : undefined;
    }
  }
  return undefined;
}

function automatedReviewEventTime(value) {
  for (
    const timestamp of [
      value?.updated_at,
      value?.submitted_at,
      value?.created_at,
    ]
  ) {
    if (typeof timestamp !== "string") continue;
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function codeRabbitRecentReview(body) {
  if (typeof body !== "string") return undefined;
  const start = body.lastIndexOf(CODERABBIT_RECENT_REVIEW_MARKER);
  if (start < 0) return undefined;
  const contentStart = start + CODERABBIT_RECENT_REVIEW_MARKER.length;
  const end = body.indexOf(CODERABBIT_RECENT_REVIEW_END_MARKER, contentStart);
  return end < 0 ? undefined : body.slice(contentStart, end);
}

/** Publish the current automated-review decision on the exact PR head SHA. */
export async function publishAutomatedReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  pullUrl,
  isDraft = false,
}) {
  // Review bots skip drafts, so a draft has no verdict yet. Publish pending so
  // "not reviewed yet" never renders as a pass and never as a missing status.
  if (isDraft) {
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      state: "pending",
      context: AUTOMATED_REVIEW_STATUS_CONTEXT,
      description: "Draft pull request waits for ready for review",
      target_url: pullUrl,
    });
    return { state: "pending", review: undefined, failure: undefined };
  }

  let review;
  let failure;
  try {
    const reviews = await github.paginate(github.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    });
    review = await findAutomatedReview({
      reviews,
      comments,
      resolveCommit: async (ref) => {
        try {
          const response = await github.rest.repos.getCommit({
            owner,
            repo,
            ref,
          });
          const sha = response?.data?.sha;
          return typeof sha === "string" && FULL_COMMIT_PATTERN.test(sha)
            ? sha
            : undefined;
        } catch {
          return undefined;
        }
      },
    }, headSha);
    if (!review) {
      failure = new Error(
        `No automated review was submitted for current commit ${
          headSha.slice(0, 12)
        }. ` +
          "CodeRabbit and Codex skip or rate-limit comments do not count as reviews.",
      );
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  const state = review ? "success" : "failure";
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state,
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    description: review
      ? `Reviewed by ${review.reviewer}`
      : "No CodeRabbit or Codex review for current commit",
    target_url: review?.url ?? pullUrl,
  });
  return { state, review, failure };
}
