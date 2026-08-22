const AUTOMATED_REVIEW_LOGINS = new Set([
  "coderabbitai[bot]",
  "chatgpt-codex-connector[bot]",
]);
const CODERABBIT_LOGIN = "coderabbitai[bot]";
const CODERABBIT_RECENT_REVIEW_MARKER = "<!-- recent_review_start -->";
export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";
const SUBMITTED_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

/** Find an actual automated review submitted against the current PR head. */
export function findAutomatedReview({ reviews, comments }, headSha) {
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
      typeof login !== "string" ||
      login.toLowerCase() !== CODERABBIT_LOGIN ||
      typeof body !== "string" ||
      !body.includes(CODERABBIT_RECENT_REVIEW_MARKER) ||
      !body.includes(headSha)
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

/** Publish the current automated-review decision on the exact PR head SHA. */
export async function publishAutomatedReviewStatus({
  github,
  owner,
  repo,
  pullNumber,
  headSha,
  pullUrl,
}) {
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
    review = findAutomatedReview({ reviews, comments }, headSha);
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
