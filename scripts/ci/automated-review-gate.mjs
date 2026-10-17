export const AUTOMATED_REVIEW_STATUS_CONTEXT = "Automated review";
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const CODEX_ID = 199175422;
const FULL_SHA = /^[0-9a-f]{40}$/i;

export function hasCompletedReview(reviews, headSha) {
  return reviews.some((review) =>
    review.user?.login === CODEX_LOGIN && review.user?.id === CODEX_ID &&
    review.user?.type === "Bot" && review.commit_id === headSha &&
    ["APPROVED", "COMMENTED", "CHANGES_REQUESTED", "DISMISSED"].includes(
      review.state,
    ) &&
    Boolean(review.submitted_at)
  );
}

function isCurrentRequest(comment, headSha) {
  return comment.user?.login === "github-actions[bot]" &&
    comment.user?.id === 41898282 && comment.user?.type === "Bot" &&
    comment.body ===
      `<!-- automated-review-request: ${headSha} -->\n@codex review`;
}

export function hasCompletedRequest(comment, reactions, headSha) {
  return isCurrentRequest(comment, headSha) &&
    reactions.some((reaction) =>
      reaction.content === "+1" && reaction.user?.login === CODEX_LOGIN &&
      reaction.user?.id === CODEX_ID &&
      ["Bot", "User"].includes(reaction.user?.type)
    );
}

async function completedRequest(github, common, pullNumber, headSha) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...common,
    issue_number: pullNumber,
    per_page: 100,
  });
  for (const comment of comments) {
    if (!isCurrentRequest(comment, headSha)) continue;
    const reactions = await github.paginate(
      github.rest.reactions.listForIssueComment,
      {
        ...common,
        comment_id: comment.id,
        per_page: 100,
      },
    );
    if (hasCompletedRequest(comment, reactions, headSha)) return true;
  }
  return false;
}

export function parseMergeQueuePullNumber(headRef) {
  if (typeof headRef !== "string") return undefined;
  const match =
    /^(?:refs\/heads\/)?gh-readonly-queue\/.+\/pr-([1-9]\d*)-([0-9a-f]{40})$/i
      .exec(headRef);
  const pullNumber = match ? Number(match[1]) : undefined;
  return Number.isSafeInteger(pullNumber)
    ? { pullNumber, baseHeadSha: match[2].toLowerCase() }
    : undefined;
}

const QUEUE_BINDING = `
  query ReviewQueueBinding($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number state headRefOid baseRefName
        mergeQueueEntry { baseCommit { oid } headCommit { oid } }
      }
    }
  }
`;

async function verifyMergeGroup(
  github,
  common,
  pullNumber,
  headSha,
  mergeGroup,
) {
  const queue = parseMergeQueuePullNumber(mergeGroup.head_ref);
  if (queue?.pullNumber !== pullNumber || !FULL_SHA.test(mergeGroup.head_sha)) {
    throw new Error("Merge group identity is malformed");
  }
  const headRef = mergeGroup.head_ref.startsWith("refs/heads/")
    ? mergeGroup.head_ref
    : `refs/heads/${mergeGroup.head_ref}`;
  const response = await github.graphql(QUEUE_BINDING, {
    ...common,
    number: pullNumber,
  });
  const pull = response?.repository?.pullRequest;
  if (
    pull?.number !== pullNumber || pull?.state !== "OPEN" ||
    pull?.headRefOid !== headSha ||
    pull?.mergeQueueEntry?.baseCommit?.oid !== queue.baseHeadSha ||
    pull?.mergeQueueEntry?.headCommit?.oid !== mergeGroup.head_sha ||
    headRef !==
      `refs/heads/gh-readonly-queue/${pull?.baseRefName}/pr-${pullNumber}-${queue.baseHeadSha}`
  ) {
    throw new Error(
      "Merge group is not bound to the current pull request head",
    );
  }
  const ref = await github.rest.git.getRef({
    ...common,
    ref: headRef.slice(5),
  });
  if (ref.data.object.sha !== mergeGroup.head_sha) {
    throw new Error("Merge queue ref no longer targets this merge group");
  }
}

/**
 * @param {{github: unknown, owner: string, repo: string, pullNumber: number,
 *   mergeGroup?: {head_sha: string, head_ref: string}}} options
 */
export async function publishReviewStatus(
  { github, owner, repo, pullNumber, mergeGroup = undefined },
) {
  const common = { owner, repo };
  const params = { ...common, pull_number: pullNumber };
  const { data: pull } = await github.rest.pulls.get(params);
  if (pull.state !== "open") return;
  const headSha = pull.head.sha;
  if (!FULL_SHA.test(headSha)) {
    throw new Error("Pull request head is malformed");
  }
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    ...params,
    per_page: 100,
  });
  const completed = hasCompletedReview(reviews, headSha) ||
    await completedRequest(github, common, pullNumber, headSha);
  const { data: current } = await github.rest.pulls.get(params);
  if (current.state !== "open" || current.head.sha !== headSha) return;
  if (mergeGroup) {
    await verifyMergeGroup(github, common, pullNumber, headSha, mergeGroup);
  }
  await github.rest.repos.createCommitStatus({
    ...common,
    sha: mergeGroup?.head_sha ?? headSha,
    context: AUTOMATED_REVIEW_STATUS_CONTEXT,
    state: completed ? "success" : "pending",
    description: completed
      ? "Codex reviewed the current pull request head"
      : "Waiting for Codex to review the current pull request head",
    target_url: pull.html_url,
  });
}

export async function reconcileReviewEvent({ github, context }) {
  const { owner, repo } = context.repo;
  const payload = context.payload;
  const mergeGroup = payload.merge_group;
  let pullNumber = payload.pull_request?.number ?? payload.issue?.number;
  if (mergeGroup) {
    pullNumber = parseMergeQueuePullNumber(mergeGroup.head_ref)?.pullNumber;
    if (!pullNumber) {
      throw new Error("Could not identify the merge queue pull request");
    }
  }
  if (payload.workflow_run) {
    const run = payload.workflow_run;
    const match = /^automated-review-wakeup-pr-([1-9]\d*)$/.exec(
      run.display_title ?? "",
    );
    if (
      run.event !== "pull_request_review" ||
      !/^\.github\/workflows\/automated-review-wakeup\.yml(?:@|$)/.test(
        run.path ?? "",
      ) ||
      !match || !Number.isSafeInteger(Number(match[1]))
    ) throw new Error("Could not validate the review wakeup run");
    pullNumber = Number(match[1]);
  }
  if (!pullNumber && context.eventName !== "schedule") return;
  const pulls = pullNumber
    ? [pullNumber]
    : (await github.paginate(github.rest.pulls.list, {
      owner,
      repo,
      state: "open",
      per_page: 100,
    }))
      .map((pull) => pull.number);
  for (const number of pulls) {
    await publishReviewStatus({
      github,
      owner,
      repo,
      pullNumber: number,
      mergeGroup,
    });
    // Completion can arrive after checks_requested. Reconcile the live queue ref too.
    if (mergeGroup) continue;
    const binding = await github.graphql(QUEUE_BINDING, {
      owner,
      repo,
      number,
    });
    const pull = binding?.repository?.pullRequest;
    const entry = pull?.mergeQueueEntry;
    if (entry?.headCommit?.oid && entry?.baseCommit?.oid) {
      await publishReviewStatus({
        github,
        owner,
        repo,
        pullNumber: number,
        mergeGroup: {
          head_sha: entry.headCommit.oid,
          head_ref:
            `refs/heads/gh-readonly-queue/${pull.baseRefName}/pr-${number}-${entry.baseCommit.oid}`,
        },
      });
    }
  }
}
