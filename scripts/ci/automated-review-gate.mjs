const AUTOMATED_REVIEW_LOGINS = new Set([
  "coderabbitai[bot]",
  "chatgpt-codex-connector[bot]",
]);
const CODERABBIT_LOGIN = "coderabbitai[bot]";
const CODERABBIT_RECENT_REVIEW_MARKER = "<!-- recent_review_start -->";
const CODERABBIT_RECENT_REVIEW_END_MARKER = "<!-- recent_review_end -->";
const CODERABBIT_NO_ACTIONABLE_REVIEW_MARKER =
  "No actionable comments were generated in the recent review.";
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
  for (let index = reviews.length - 1; index >= 0; index--) {
    const review = reviews[index];
    const login = review?.user?.login;
    const state = review?.state;
    if (
      typeof login !== "string" ||
      !AUTOMATED_REVIEW_LOGINS.has(login.toLowerCase()) ||
      typeof state !== "string" ||
      !SUBMITTED_REVIEW_STATES.has(state.toUpperCase()) ||
      review?.commit_id !== headSha ||
      typeof review?.submitted_at !== "string" ||
      review.submitted_at.length === 0
    ) {
      continue;
    }
    return {
      reviewer: login,
      source: "review",
      state: state.toUpperCase(),
      url: typeof review.html_url === "string" ? review.html_url : undefined,
    };
  }

  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index];
    const login = comment?.user?.login;
    const body = comment?.body;
    if (
      typeof login === "string" &&
      login.toLowerCase() === CODEX_LOGIN &&
      comment?.user?.type === "Bot" &&
      comment?.user?.id === CODEX_BOT_ID &&
      typeof body === "string" &&
      body.startsWith(CODEX_NO_FINDING_PREFIX)
    ) {
      const reviewedCommit = body.match(CODEX_REVIEWED_COMMIT_PATTERN)?.[1];
      if (typeof reviewedCommit === "string") {
        const resolvedCommit = await resolveCommit(reviewedCommit);
        if (
          typeof resolvedCommit === "string" &&
          FULL_COMMIT_PATTERN.test(resolvedCommit) &&
          resolvedCommit.toLowerCase() === headSha.toLowerCase()
        ) {
          return {
            reviewer: login,
            source: "summary",
            state: "COMMENTED",
            url: typeof comment.html_url === "string"
              ? comment.html_url
              : undefined,
          };
        }
      }
    }
    const recentReview = codeRabbitRecentReview(body);
    if (
      typeof login !== "string" ||
      login.toLowerCase() !== CODERABBIT_LOGIN ||
      !recentReview?.includes(CODERABBIT_NO_ACTIONABLE_REVIEW_MARKER) ||
      !recentReview.includes(headSha)
    ) {
      continue;
    }
    return {
      reviewer: login,
      source: "summary",
      state: "COMMENTED",
      url: typeof comment.html_url === "string" ? comment.html_url : undefined,
    };
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
