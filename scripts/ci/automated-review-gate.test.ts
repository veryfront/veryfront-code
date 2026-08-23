import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  findAutomatedReview,
  publishAutomatedReviewStatus,
} from "./automated-review-gate.mjs";

const HEAD_SHA = "a".repeat(40);
const STALE_SHA = "b".repeat(40);
const CODEX_BOT_ID = 199175422;
const WORKFLOW_PATH = new URL(
  "../../.github/workflows/automated-review-gate.yml",
  import.meta.url,
);

function review(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    user: { login: "coderabbitai[bot]" },
    state: "COMMENTED",
    commit_id: HEAD_SHA,
    submitted_at: "2026-08-22T12:00:00Z",
    html_url:
      "https://github.com/veryfront/veryfront-code/pull/1#pullrequestreview-1",
    ...overrides,
  };
}

function codeRabbitSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    user: { login: "coderabbitai[bot]" },
    body: [
      "<!-- recent_review_start -->",
      "No actionable comments were generated in the recent review.",
      `Reviewing files between ${STALE_SHA} and ${HEAD_SHA}.`,
      "<!-- recent_review_end -->",
    ].join("\n"),
    html_url:
      "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-1",
    created_at: "2026-08-22T12:00:00Z",
    updated_at: "2026-08-22T12:00:00Z",
    ...overrides,
  };
}

function codexNoFindingComment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    user: {
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
      id: CODEX_BOT_ID,
    },
    body: [
      "Codex Review: Didn't find any major issues. Nice work!",
      `**Reviewed commit:** \`${HEAD_SHA.slice(0, 10)}\``,
    ].join("\n\n"),
    html_url:
      "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-2",
    created_at: "2026-08-22T12:01:00Z",
    updated_at: "2026-08-22T12:01:00Z",
    ...overrides,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

describe("automated review gate", () => {
  it("accepts submitted CodeRabbit and Codex reviews for the current head", async () => {
    assertEquals(
      (await findAutomatedReview(
        { reviews: [review()], comments: [] },
        HEAD_SHA,
      ))
        ?.reviewer,
      "coderabbitai[bot]",
    );
    assertEquals(
      (await findAutomatedReview({
        reviews: [
          review({ user: { login: "chatgpt-codex-connector[bot]" } }),
        ],
        comments: [],
      }, HEAD_SHA))?.reviewer,
      "chatgpt-codex-connector[bot]",
    );
    assertEquals(
      (await findAutomatedReview(
        { reviews: [], comments: [codeRabbitSummary()] },
        HEAD_SHA,
      ))
        ?.source,
      "summary",
    );
  });

  it("accepts an authenticated Codex no-finding comment for the current head", async () => {
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [codexNoFindingComment()],
          resolveCommit: () => Promise.resolve(HEAD_SHA),
        },
        HEAD_SHA,
      ),
      {
        reviewer: "chatgpt-codex-connector[bot]",
        source: "summary",
        state: "COMMENTED",
        url:
          "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-2",
      },
    );
  });

  it("rejects a Codex comment unless it resolves to the exact full head", async () => {
    for (
      const resolvedCommit of [STALE_SHA, HEAD_SHA.slice(0, 39), undefined]
    ) {
      assertEquals(
        await findAutomatedReview(
          {
            reviews: [],
            comments: [codexNoFindingComment()],
            resolveCommit: () => Promise.resolve(resolvedCommit),
          },
          HEAD_SHA,
        ),
        undefined,
      );
    }
  });

  it("rejects stale or unauthenticated Codex issue comments", async () => {
    const currentHeadBody = [
      "Codex Review: Didn't find any major issues. Nice work!",
      `**Reviewed commit:** \`${HEAD_SHA.slice(0, 10)}\``,
    ].join("\n\n");
    const rejectedComments = [
      codexNoFindingComment({
        body: [
          "Codex Review: Didn't find any major issues. Nice work!",
          `**Reviewed commit:** \`${STALE_SHA.slice(0, 10)}\``,
        ].join("\n\n"),
      }),
      codexNoFindingComment({
        user: { login: "maintainer", type: "User", id: 1 },
      }),
      codexNoFindingComment({
        user: {
          login: "chatgpt-codex-connector[bot]",
          type: "Bot",
          id: CODEX_BOT_ID + 1,
        },
      }),
      codexNoFindingComment({
        user: {
          login: "chatgpt-codex-connector[bot]",
          type: "User",
          id: CODEX_BOT_ID,
        },
      }),
      codexNoFindingComment({ body: "@codex review" }),
      codexNoFindingComment({
        body: `Codex Review: Action not completed.\n\n${currentHeadBody}`,
      }),
      codexNoFindingComment({
        body:
          `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${
            HEAD_SHA.slice(0, 9)
          }\``,
      }),
      codexNoFindingComment({
        body:
          `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${
            HEAD_SHA.slice(0, 11)
          }\``,
      }),
    ];
    const resolveCommit = (ref: string) =>
      Promise.resolve(ref === HEAD_SHA.slice(0, 10) ? HEAD_SHA : STALE_SHA);

    for (const comment of rejectedComments) {
      assertEquals(
        await findAutomatedReview(
          { reviews: [], comments: [comment], resolveCommit },
          HEAD_SHA,
        ),
        undefined,
      );
    }
  });

  it("rejects skipped comments, stale reviews, pending reviews, and humans", async () => {
    const skippedIssueComment = {
      user: { login: "coderabbitai[bot]" },
      body: "rate limited, review skipped",
    };
    assertEquals(
      await findAutomatedReview({
        reviews: [
          review({ commit_id: STALE_SHA }),
          review({ state: "PENDING" }),
          review({ state: "CHANGES_REQUESTED" }),
          review({ state: "DISMISSED" }),
          review({ user: { login: "maintainer" } }),
        ],
        comments: [
          skippedIssueComment,
          codeRabbitSummary({
            body: "<!-- recent_review_start -->\nstale review",
          }),
          codeRabbitSummary({
            body: [
              "<!-- recent_review_start -->",
              `Reviewing files through ${STALE_SHA}.`,
              "<!-- recent_review_end -->",
              `Review skipped for current commit ${HEAD_SHA}.`,
            ].join("\n"),
          }),
          codeRabbitSummary({
            body: [
              "<!-- recent_review_start -->",
              "No actionable comments were generated in the recent review.",
              `Reviewing files between ${HEAD_SHA} and ${STALE_SHA}.`,
              "<!-- recent_review_end -->",
            ].join("\n"),
          }),
          codeRabbitSummary({
            body: [
              "<!-- recent_review_start -->",
              "Review limit reached. This review was skipped.",
              `Requested commit: ${HEAD_SHA}.`,
              "<!-- recent_review_end -->",
            ].join("\n"),
          }),
        ],
      }, HEAD_SHA),
      undefined,
    );

    const newerUnmarkedCurrentSkip = codeRabbitSummary({
      body: `Review skipped for current commit ${HEAD_SHA}.`,
      created_at: "2026-08-22T12:06:00Z",
      updated_at: "2026-08-22T12:06:00Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [codexNoFindingComment(), newerUnmarkedCurrentSkip],
          resolveCommit: () => Promise.resolve(HEAD_SHA),
        },
        HEAD_SHA,
      ),
      undefined,
    );
  });

  it("makes the newest CodeRabbit summary authoritative", async () => {
    const skipped = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "Review limit reached. This review was skipped.",
        `Requested commit: ${HEAD_SHA}.`,
        "<!-- recent_review_end -->",
      ].join("\n"),
      html_url:
        "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-3",
    });
    assertEquals(
      await findAutomatedReview(
        { reviews: [], comments: [codeRabbitSummary(), skipped] },
        HEAD_SHA,
      ),
      undefined,
    );

    const undatedSkip = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "Review limit reached. This review was skipped.",
        `Requested commit: ${HEAD_SHA}.`,
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: undefined,
      updated_at: undefined,
    });
    assertEquals(
      await findAutomatedReview(
        { reviews: [], comments: [codeRabbitSummary(), undatedSkip] },
        HEAD_SHA,
      ),
      undefined,
    );
  });

  it("lets a current-head skip override a stale retained review range", async () => {
    const staleRangeWithCurrentSkip = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        `Reviewing files between ${STALE_SHA} and ${HEAD_SHA}.`,
        "<!-- recent_review_end -->",
        `Review skipped for current commit ${HEAD_SHA}.`,
      ].join("\n"),
      created_at: "2026-08-22T12:02:00Z",
      updated_at: "2026-08-22T12:02:00Z",
    });
    const olderSuccess = codeRabbitSummary({
      created_at: "2026-08-22T12:01:00Z",
      updated_at: "2026-08-22T12:01:00Z",
    });

    assertEquals(
      await findAutomatedReview(
        { reviews: [], comments: [olderSuccess, staleRangeWithCurrentSkip] },
        HEAD_SHA,
      ),
      undefined,
    );
  });

  it("fails closed when exact-head event chronology is indeterminate", async () => {
    const olderSuccess = codeRabbitSummary({
      created_at: "2026-08-22T12:01:00Z",
      updated_at: "2026-08-22T12:01:00Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [review({ state: "PENDING", submitted_at: undefined })],
          comments: [olderSuccess],
        },
        HEAD_SHA,
      ),
      undefined,
    );

    assertEquals(
      await findAutomatedReview(
        {
          reviews: [
            review({ state: "PENDING", submitted_at: "2026-08-22T12:02:00Z" }),
          ],
          comments: [
            olderSuccess,
            {
              user: { login: "human" },
              body: "untimestamped noise",
            },
          ],
        },
        HEAD_SHA,
      ),
      undefined,
    );
  });

  it("makes the newest exact-head bot outcome authoritative across reviewers", async () => {
    const failedCodex = codexNoFindingComment({
      body: [
        "Codex Review: Action not completed.",
        `**Reviewed commit:** \`${HEAD_SHA.slice(0, 10)}\``,
      ].join("\n\n"),
      created_at: "2026-08-22T12:02:00Z",
      updated_at: "2026-08-22T12:02:00Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [codeRabbitSummary(), codexNoFindingComment(), failedCodex],
          resolveCommit: () => Promise.resolve(HEAD_SHA),
        },
        HEAD_SHA,
      ),
      undefined,
    );

    const newerCodeRabbit = codeRabbitSummary({
      created_at: "2026-08-22T12:03:00Z",
      updated_at: "2026-08-22T12:03:00Z",
      html_url:
        "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-4",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [codexNoFindingComment(), failedCodex, newerCodeRabbit],
          resolveCommit: () => Promise.resolve(HEAD_SHA),
        },
        HEAD_SHA,
      ))?.reviewer,
      "coderabbitai[bot]",
    );

    const newerStaleCodeRabbit = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        `Reviewing files between ${HEAD_SHA} and ${STALE_SHA}.`,
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:04:00Z",
      updated_at: "2026-08-22T12:04:00Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [codexNoFindingComment(), newerStaleCodeRabbit],
          resolveCommit: () => Promise.resolve(HEAD_SHA),
        },
        HEAD_SHA,
      ))?.reviewer,
      "chatgpt-codex-connector[bot]",
    );

    const newerCurrentSkipWithStaleRange = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        `Reviewing files between ${HEAD_SHA} and ${STALE_SHA}.`,
        "<!-- recent_review_end -->",
        `Review skipped for current commit ${HEAD_SHA}.`,
      ].join("\n"),
      created_at: "2026-08-22T12:05:00Z",
      updated_at: "2026-08-22T12:05:00Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [codexNoFindingComment(), newerCurrentSkipWithStaleRange],
          resolveCommit: () => Promise.resolve(HEAD_SHA),
        },
        HEAD_SHA,
      ),
      undefined,
    );
  });

  it("publishes the automated review decision on the exact pull request head", async () => {
    const statuses: Array<Record<string, unknown>> = [];
    const listReviews = () => Promise.resolve();
    const listComments = () => Promise.resolve();
    const github = {
      paginate: (endpoint: unknown) =>
        Promise.resolve(endpoint === listReviews ? [review()] : []),
      rest: {
        issues: { listComments },
        pulls: { listReviews },
        repos: {
          createCommitStatus: (status: Record<string, unknown>) => {
            statuses.push(status);
            return Promise.resolve();
          },
        },
      },
    };
    const result = await publishAutomatedReviewStatus({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD_SHA,
      pullUrl: "https://github.com/veryfront/veryfront-code/pull/1",
    });
    assertEquals(result.state, "success");
    assertEquals(statuses[0]?.sha, HEAD_SHA);
    assertEquals(statuses[0]?.state, "success");
    assertEquals(statuses[0]?.context, "Automated review");

    github.paginate = () => Promise.resolve([]);
    const missing = await publishAutomatedReviewStatus({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: STALE_SHA,
      pullUrl: "https://github.com/veryfront/veryfront-code/pull/1",
    });
    assertEquals(missing.state, "failure");
    assert(
      missing.failure instanceof Error &&
        missing.failure.message.includes(STALE_SHA.slice(0, 12)),
      "the failure must name the unreviewed head commit",
    );
    assertEquals(statuses[1]?.sha, STALE_SHA);
    assertEquals(statuses[1]?.state, "failure");
  });

  it("resolves a Codex comment to the exact commit before publishing success", async () => {
    const statuses: Array<Record<string, unknown>> = [];
    const resolvedRefs: string[] = [];
    const listReviews = () => Promise.resolve();
    const listComments = () => Promise.resolve();
    const github = {
      paginate: (endpoint: unknown) =>
        Promise.resolve(
          endpoint === listComments ? [codexNoFindingComment()] : [],
        ),
      rest: {
        issues: { listComments },
        pulls: { listReviews },
        repos: {
          createCommitStatus: (status: Record<string, unknown>) => {
            statuses.push(status);
            return Promise.resolve();
          },
          getCommit: ({ ref }: { ref: string }) => {
            resolvedRefs.push(ref);
            return Promise.resolve({ data: { sha: HEAD_SHA } });
          },
        },
      },
    };

    const result = await publishAutomatedReviewStatus({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD_SHA,
      pullUrl: "https://github.com/veryfront/veryfront-code/pull/1",
    });

    assertEquals(result.state, "success");
    assertEquals(resolvedRefs, [HEAD_SHA.slice(0, 10)]);
    assertEquals(statuses[0]?.state, "success");
    assertEquals(
      statuses[0]?.target_url,
      "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-2",
    );
  });

  it("publishes failure when a Codex commit cannot be resolved exactly", async () => {
    const statuses: Array<Record<string, unknown>> = [];
    const listReviews = () => Promise.resolve();
    const listComments = () => Promise.resolve();
    const github = {
      paginate: (endpoint: unknown) =>
        Promise.resolve(
          endpoint === listComments ? [codexNoFindingComment()] : [],
        ),
      rest: {
        issues: { listComments },
        pulls: { listReviews },
        repos: {
          createCommitStatus: (status: Record<string, unknown>) => {
            statuses.push(status);
            return Promise.resolve();
          },
          getCommit: () =>
            Promise.reject(Object.assign(new Error("ambiguous commit"), {
              status: 422,
            })),
        },
      },
    };

    const result = await publishAutomatedReviewStatus({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD_SHA,
      pullUrl: "https://github.com/veryfront/veryfront-code/pull/1",
    });

    assertEquals(result.state, "failure");
    assertEquals(result.review, undefined);
    assertEquals(statuses[0]?.state, "failure");
    assertEquals(statuses[0]?.sha, HEAD_SHA);
  });

  it("fails closed when the review lookup throws", async () => {
    const statuses: Array<Record<string, unknown>> = [];
    const github = {
      paginate: () => Promise.reject(new Error("secondary rate limit")),
      rest: {
        issues: { listComments: () => Promise.resolve() },
        pulls: { listReviews: () => Promise.resolve() },
        repos: {
          createCommitStatus: (status: Record<string, unknown>) => {
            statuses.push(status);
            return Promise.resolve();
          },
        },
      },
    };
    const result = await publishAutomatedReviewStatus({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD_SHA,
      pullUrl: "https://github.com/veryfront/veryfront-code/pull/1",
    });
    assertEquals(result.state, "failure");
    assertEquals(result.review, undefined);
    assert(
      result.failure instanceof Error &&
        result.failure.message.includes("secondary rate limit"),
      "the transport error must be reported, not swallowed",
    );
    assertEquals(statuses.length, 1);
    assertEquals(statuses[0]?.state, "failure");
    assertEquals(statuses[0]?.sha, HEAD_SHA);
  });

  it("holds a draft pull request at pending instead of success", async () => {
    const statuses: Array<Record<string, unknown>> = [];
    let listed = false;
    const github = {
      paginate: () => {
        listed = true;
        return Promise.resolve([review()]);
      },
      rest: {
        issues: { listComments: () => Promise.resolve() },
        pulls: { listReviews: () => Promise.resolve() },
        repos: {
          createCommitStatus: (status: Record<string, unknown>) => {
            statuses.push(status);
            return Promise.resolve();
          },
        },
      },
    };
    const result = await publishAutomatedReviewStatus({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD_SHA,
      pullUrl: "https://github.com/veryfront/veryfront-code/pull/1",
      isDraft: true,
    });
    assertEquals(result.state, "pending");
    assertEquals(listed, false);
    assertEquals(statuses.length, 1);
    assertEquals(statuses[0]?.state, "pending");
    assertEquals(statuses[0]?.context, "Automated review");
    assertEquals(statuses[0]?.sha, HEAD_SHA);
  });

  it("uses trusted base code and reruns when a real review is submitted", async () => {
    const workflow = record(
      parse(await Deno.readTextFile(WORKFLOW_PATH)),
      "automated review workflow",
    );
    const triggers = record(workflow.on, "automated review triggers");
    assertEquals(
      record(triggers.pull_request_target, "pull_request_target trigger").types,
      ["opened", "synchronize", "reopened", "ready_for_review"],
    );
    assertEquals(
      record(triggers.pull_request_review, "pull_request_review trigger").types,
      ["submitted", "dismissed"],
    );
    assertEquals(
      record(triggers.issue_comment, "issue_comment trigger").types,
      ["created", "edited"],
    );

    const permissions = record(
      workflow.permissions,
      "automated review permissions",
    );
    assertEquals(permissions, {
      contents: "read",
      issues: "read",
      "pull-requests": "read",
      statuses: "write",
    });

    assertEquals(
      record(workflow.concurrency, "automated review concurrency"),
      {
        group:
          "automated-review-${{ github.event.pull_request.number || github.event.issue.number }}",
        queue: "max",
      },
    );

    const job = record(
      record(workflow.jobs, "automated review jobs").review,
      "automated review job",
    );
    assertEquals(job.name, "publish automated review status");
    assertEquals(job["timeout-minutes"], 5);
    assert(
      typeof job.if === "string" &&
        job.if.includes("github.event.issue.pull_request"),
      "issue comments must run the gate only for pull requests",
    );
    assert(
      typeof job.if === "string" &&
        job.if.includes(
          "github.event.pull_request.head.repo.full_name == github.repository",
        ),
      "review events must be skipped on forks, where the token cannot write a status",
    );

    const steps = job.steps;
    assert(Array.isArray(steps), "automated review job steps must be an array");
    const checkout = record(steps[0], "automated review checkout");
    assertEquals(
      record(checkout.with, "automated review checkout inputs").ref,
      "${{ github.event.repository.default_branch }}",
    );
    assertEquals(
      record(
        checkout.with,
        "automated review checkout inputs",
      )["persist-credentials"],
      false,
    );
    const gate = record(steps[1], "automated review gate step");
    assertEquals(
      gate.uses,
      "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
    );
    assert(
      typeof record(gate.with, "automated review gate inputs").script ===
          "string" &&
        String(record(gate.with, "automated review gate inputs").script)
          .includes(
            "publishAutomatedReviewStatus",
          ),
      "the workflow must call the tested review gate",
    );
    assert(
      String(record(gate.with, "automated review gate inputs").script).includes(
        "isDraft: pullRequest.draft === true",
      ),
      "the workflow must hand draft state to the tested review gate",
    );
    const script = String(
      record(gate.with, "automated review gate inputs").script,
    );
    assert(
      script.includes("Review gate is unavailable on the default branch") &&
        script.includes('state: "failure"'),
      "a gate that fails to load must publish a failure status, not no status",
    );
  });
});
