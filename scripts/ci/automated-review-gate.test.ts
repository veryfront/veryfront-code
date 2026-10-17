import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  hasCompletedRequest,
  hasCompletedReview,
  parseMergeQueuePullNumber,
  publishReviewStatus,
  reconcileReviewEvent,
} from "./automated-review-gate.mjs";

const HEAD = "a".repeat(40);
const NEXT = "b".repeat(40);
const GROUP = "c".repeat(40);
const BASE = "d".repeat(40);
const reviewer = {
  login: "chatgpt-codex-connector[bot]",
  id: 199175422,
  type: "Bot",
};
const review = (overrides = {}) => ({
  user: reviewer,
  commit_id: HEAD,
  state: "COMMENTED",
  submitted_at: "2026-10-17T10:00:00Z",
  ...overrides,
});

function fixture(
  reviews: Record<string, unknown>[] = [],
  heads = [HEAD, HEAD],
  comments: Record<string, unknown>[] = [],
  reactions: Record<string, unknown>[] = [],
) {
  const statuses: Record<string, unknown>[] = [];
  let reads = 0;
  const github = {
    paginate: (
      endpoint: unknown,
      _params: unknown,
    ): Promise<Record<string, unknown>[]> =>
      Promise.resolve(
        endpoint === github.rest.pulls.listReviews
          ? reviews
          : endpoint === github.rest.issues.listComments
          ? comments
          : reactions,
      ),
    graphql: () =>
      Promise.resolve({
        repository: {
          pullRequest: {
            number: 42,
            state: "OPEN",
            headRefOid: HEAD,
            baseRefName: "main",
            mergeQueueEntry: {
              baseCommit: { oid: BASE },
              headCommit: { oid: GROUP },
            },
          },
        },
      }),
    rest: {
      issues: { listComments: () => {} },
      reactions: { listForIssueComment: () => {} },
      pulls: {
        list: () => {},
        get: () =>
          Promise.resolve({
            data: {
              number: 42,
              state: "open",
              head: { sha: heads[Math.min(reads++, heads.length - 1)] },
              html_url: "https://github.com/owner/repo/pull/42",
            },
          }),
        listReviews: () => {},
      },
      git: {
        getRef: () => Promise.resolve({ data: { object: { sha: GROUP } } }),
      },
      repos: {
        createCommitStatus: (status: Record<string, unknown>) => {
          statuses.push(status);
          return Promise.resolve({});
        },
      },
    },
  };
  return { github, statuses };
}

describe("automated review completion", () => {
  it("accepts a completed Codex review of the current head regardless of its verdict or text", () => {
    for (
      const state of ["COMMENTED", "CHANGES_REQUESTED", "APPROVED", "DISMISSED"]
    ) {
      for (const body of [undefined, "", "An issue needs a fix."]) {
        assertEquals(hasCompletedReview([review({ state, body })], HEAD), true);
      }
    }
  });

  it("rejects pending, stale, and impersonated reviews", () => {
    for (
      const candidate of [
        review({ state: "PENDING" }),
        review({ submitted_at: null }),
        review({ commit_id: NEXT }),
        review({ user: { ...reviewer, id: 1 } }),
        review({ user: { ...reviewer, type: "User" } }),
        review({ user: { ...reviewer, login: "other[bot]" } }),
      ]
    ) assertEquals(hasCompletedReview([candidate], HEAD), false);
  });

  it("accepts only Codex completion reactions on the trusted request for this head", () => {
    const request = {
      user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
      body: `<!-- automated-review-request: ${HEAD} -->\n@codex review`,
    };
    const reaction = { user: reviewer, content: "+1" };
    for (const type of ["Bot", "User"]) {
      assertEquals(
        hasCompletedRequest(request, [{
          ...reaction,
          user: { ...reviewer, type },
        }], HEAD),
        true,
      );
    }
    assertEquals(
      hasCompletedRequest(request, [{
        ...reaction,
        user: { ...reviewer, type: "Organization" },
      }], HEAD),
      false,
    );
    assertEquals(hasCompletedRequest(request, [reaction], NEXT), false);
    assertEquals(
      hasCompletedRequest(request, [{ ...reaction, content: "eyes" }], HEAD),
      false,
    );
    assertEquals(
      hasCompletedRequest(request, [{
        ...reaction,
        user: { ...reviewer, id: 1 },
      }], HEAD),
      false,
    );
    assertEquals(
      hasCompletedRequest({ ...request, user: reviewer }, [reaction], HEAD),
      false,
    );
    assertEquals(
      hasCompletedRequest(
        { ...request, body: "@codex review" },
        [reaction],
        HEAD,
      ),
      false,
    );
  });

  it("publishes pending until the current head has a completed review", async () => {
    for (
      const [reviews, state] of [[[], "pending"], [
        [review()],
        "success",
      ]] as const
    ) {
      const { github, statuses } = fixture([...reviews]);
      await publishReviewStatus({
        github,
        owner: "owner",
        repo: "repo",
        pullNumber: 42,
      });
      assertEquals(statuses.length, 1);
      assertEquals(statuses[0]?.sha, HEAD);
      assertEquals(statuses[0]?.context, "Automated review");
      assertEquals(statuses[0]?.state, state);
    }
  });

  it("publishes completion for a clean run using its SHA-bound request reaction", async () => {
    const { github, statuses } = fixture([], [HEAD, HEAD], [{
      id: 123,
      user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
      body: `<!-- automated-review-request: ${HEAD} -->\n@codex review`,
    }], [{ user: reviewer, content: "+1" }]);
    await publishReviewStatus({
      github,
      owner: "owner",
      repo: "repo",
      pullNumber: 42,
    });
    assertEquals(statuses[0]?.state, "success");
  });

  it("does not publish a stale result if the PR head changes during reconciliation", async () => {
    const { github, statuses } = fixture([review()], [HEAD, NEXT]);
    await publishReviewStatus({
      github,
      owner: "owner",
      repo: "repo",
      pullNumber: 42,
    });
    assertEquals(statuses, []);
  });

  it("reports review completion on the bound merge-group SHA", async () => {
    for (
      const [reviews, state] of [[[], "pending"], [
        [review()],
        "success",
      ]] as const
    ) {
      const { github, statuses } = fixture([...reviews]);
      await publishReviewStatus({
        github,
        owner: "owner",
        repo: "repo",
        pullNumber: 42,
        mergeGroup: {
          head_sha: GROUP,
          head_ref: `refs/heads/gh-readonly-queue/main/pr-42-${BASE}`,
        },
      });
      assertEquals(statuses[0]?.sha, GROUP);
      assertEquals(statuses[0]?.state, state);
    }
  });

  it("accepts merge-group refs with or without the refs/heads prefix", async () => {
    const { github, statuses } = fixture([review()]);
    await publishReviewStatus({
      github,
      owner: "owner",
      repo: "repo",
      pullNumber: 42,
      mergeGroup: {
        head_sha: GROUP,
        head_ref: `gh-readonly-queue/main/pr-42-${BASE}`,
      },
    });
    assertEquals(statuses[0]?.sha, GROUP);
    assertEquals(statuses[0]?.state, "success");
  });

  it("does not attest a merge group that no longer belongs to the current PR head", async () => {
    const { github, statuses } = fixture([review()]);
    github.graphql = () =>
      Promise.resolve({
        repository: {
          pullRequest: {
            number: 42,
            state: "OPEN",
            headRefOid: NEXT,
            baseRefName: "main",
            mergeQueueEntry: {
              baseCommit: { oid: BASE },
              headCommit: { oid: GROUP },
            },
          },
        },
      });
    await assertRejects(() =>
      publishReviewStatus({
        github,
        owner: "owner",
        repo: "repo",
        pullNumber: 42,
        mergeGroup: {
          head_sha: GROUP,
          head_ref: `refs/heads/gh-readonly-queue/main/pr-42-${BASE}`,
        },
      })
    );
    assertEquals(statuses, []);
  });

  it("does not attest a stale queue ref", async () => {
    const { github, statuses } = fixture([review()]);
    github.rest.git.getRef = () =>
      Promise.resolve({ data: { object: { sha: NEXT } } });
    await assertRejects(() =>
      publishReviewStatus({
        github,
        owner: "owner",
        repo: "repo",
        pullNumber: 42,
        mergeGroup: {
          head_sha: GROUP,
          head_ref: `refs/heads/gh-readonly-queue/main/pr-42-${BASE}`,
        },
      })
    );
    assertEquals(statuses, []);
  });

  it("parses only merge queue refs with a full base commit", () => {
    assertEquals(
      parseMergeQueuePullNumber(
        `refs/heads/gh-readonly-queue/main/pr-42-${BASE}`,
      ),
      { pullNumber: 42, baseHeadSha: BASE },
    );
    for (
      const ref of [
        "main",
        "pr-42",
        `gh-readonly-queue/main/pr-0-${BASE}`,
        "gh-readonly-queue/main/pr-42-deadbeef",
      ]
    ) {
      assertEquals(parseMergeQueuePullNumber(ref), undefined);
    }
  });
  it("reconciles both the live PR head and its active queue entry after a review", async () => {
    const { github, statuses } = fixture([review()]);
    await reconcileReviewEvent({
      github,
      context: {
        repo: { owner: "owner", repo: "repo" },
        eventName: "workflow_run",
        payload: {
          workflow_run: {
            display_title: "automated-review-wakeup-pr-42",
            event: "pull_request_review",
            path: ".github/workflows/automated-review-wakeup.yml",
          },
        },
      },
    });
    assertEquals(statuses.map((status) => [status.sha, status.state]), [[
      HEAD,
      "success",
    ], [GROUP, "success"]]);
  });

  it("reports the merge_group event on the synthetic SHA rather than the event commit", async () => {
    const { github, statuses } = fixture([review()]);
    await reconcileReviewEvent({
      github,
      context: {
        repo: { owner: "owner", repo: "repo" },
        eventName: "merge_group",
        payload: {
          merge_group: {
            head_sha: GROUP,
            head_ref: `refs/heads/gh-readonly-queue/main/pr-42-${BASE}`,
          },
        },
      },
    });
    assertEquals(statuses.map((status) => [status.sha, status.state]), [[
      GROUP,
      "success",
    ]]);
  });

  it("rejects unrelated workflow completions before accessing a PR", async () => {
    const { github, statuses } = fixture([review()]);
    await assertRejects(() =>
      reconcileReviewEvent({
        github,
        context: {
          repo: { owner: "owner", repo: "repo" },
          eventName: "workflow_run",
          payload: {
            workflow_run: {
              display_title: "automated-review-wakeup-pr-42",
              event: "pull_request_review",
              path: ".github/workflows/other.yml",
            },
          },
        },
      })
    );
    assertEquals(statuses, []);
  });
  it("periodically reconciles open PRs so late completion reactions are observed", async () => {
    const { github, statuses } = fixture([review()]);
    const paginate = github.paginate;
    github.paginate = (endpoint, params) =>
      endpoint === github.rest.pulls.list
        ? Promise.resolve([{ number: 42 }])
        : paginate(endpoint, params);
    await reconcileReviewEvent({
      github,
      context: {
        repo: { owner: "owner", repo: "repo" },
        eventName: "schedule",
        payload: {},
      },
    });
    assertEquals(statuses.map((status) => [status.sha, status.state]), [[
      HEAD,
      "success",
    ], [GROUP, "success"]]);
  });

  it("does not publish success when review retrieval fails", async () => {
    const { github, statuses } = fixture([review()]);
    github.paginate = () => Promise.reject(new Error("GitHub unavailable"));
    await assertRejects(() =>
      publishReviewStatus({
        github,
        owner: "owner",
        repo: "repo",
        pullNumber: 42,
      })
    );
    assertEquals(statuses, []);
  });
});
