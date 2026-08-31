import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  completeReviewFailurePropagation,
  expireTimedOutAutomatedReview,
  findAutomatedReview,
  findTimedOutAutomatedReviews,
  invalidateReviewProof,
  matchesReviewWakeupPullRequest,
  parseMergeQueuePullNumber,
  parseReviewWakeupRun,
  publishAutomatedReviewStatus,
  publishMergeGroupReviewStatus,
  publishReviewPropagationRetryStatus,
  publishReviewResolutionFailure,
  reconcileActiveMergeGroupReviewStatuses,
  requestAutomatedReview,
  reviewBaseBinding,
  selectMergeGroupFailureStatusBoundary,
  shouldPreserveLaterMergeGroupSuccess,
} from "./automated-review-gate.mjs";

const HEAD = "a4804e5b9a0c9c45da7c4866d9eb317c878b029c";
const OTHER_HEAD = "d258d506fede01c84b61bc40488059447d755a5a";
const BASE_HEAD = "e724246c0e05c8dcf0db41f024f4592128222937";
const NEW_HEAD = "b8459394dd5bac3a6736ee4c7723d7f291abb382";
const BASE_REPOSITORY_ID = 1_101_259_327;
const BASE_REF = "main";
const OTHER_BASE_REF = "release";
const CODERABBIT_ID = 136622811;
const CODEX_ID = 199175422;
const GITHUB_ACTIONS_ID = 41898282;
const WORKFLOW_PATH = new URL(
  "../../.github/workflows/automated-review-gate.yml",
  import.meta.url,
);
const WAKEUP_WORKFLOW_PATH = new URL(
  "../../.github/workflows/automated-review-wakeup.yml",
  import.meta.url,
);

const bot = (login: string, id: number) => ({ login, id, type: "Bot" });

function review(overrides: Record<string, unknown> = {}) {
  return {
    user: bot("chatgpt-codex-connector[bot]", CODEX_ID),
    state: "COMMENTED",
    commit_id: HEAD,
    html_url: "https://example.test/review",
    ...overrides,
  };
}

function automatedReviewStatus(overrides: Record<string, unknown> = {}) {
  return {
    context: "Automated review",
    state: "success",
    description: `PR#1 base:${
      reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
    } by:chatgpt-codex-connector[bot]`,
    creator: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
    target_url: "https://example.test/review-proof",
    ...overrides,
  };
}

function automatedReviewResetStatus(
  createdAt = "2026-08-25T08:00:00Z",
  overrides: Record<string, unknown> = {},
) {
  return automatedReviewStatus({
    state: "pending",
    description: `PR#1 reset base:${
      reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
    }`,
    created_at: createdAt,
    ...overrides,
  });
}

function reviewRequestComment(
  createdAt = "2026-08-25T08:00:00Z",
  id = 100,
) {
  return {
    id,
    user: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
    body: `<!-- automated-review-request: ${HEAD} base-42 -->\n@codex review`,
    created_at: createdAt,
  };
}

function codexComment(
  ref = HEAD.slice(0, 10),
  overrides: Record<string, unknown> = {},
) {
  const createdAt = typeof overrides.created_at === "string"
    ? overrides.created_at
    : "2026-08-25T08:00:00Z";
  return {
    user: bot("chatgpt-codex-connector[bot]", CODEX_ID),
    body: [
      "Codex Review: Didn't find any major issues. Already looking forward to the next diff.",
      `**Reviewed commit:** \`${ref}\``,
    ].join("\n\n"),
    html_url: "https://example.test/comment",
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function codexFindingComment(
  ref = HEAD.slice(0, 10),
  overrides: Record<string, unknown> = {},
) {
  return {
    user: bot("chatgpt-codex-connector[bot]", CODEX_ID),
    body: [
      "Codex Review: Found an actionable issue.",
      `**Reviewed commit:** \`${ref}\``,
    ].join("\n\n"),
    html_url: "https://example.test/finding",
    ...overrides,
  };
}

function codexRateLimitComment(
  createdAt = "2026-08-25T08:01:00Z",
) {
  return {
    id: 103,
    user: bot("chatgpt-codex-connector[bot]", CODEX_ID),
    body:
      "You have reached your Codex usage limits for security reviews. Please try again later.",
    html_url: "https://example.test/rate-limit",
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function pendingAutomatedReviewStatus(
  createdAt = "2026-08-25T08:00:00Z",
  pullNumber = 1,
  id = 100,
) {
  return automatedReviewStatus({
    id,
    state: "pending",
    description: `PR#${pullNumber} waits for review ${HEAD.slice(0, 12)}`,
    created_at: createdAt,
  });
}

function associatedPull(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    state: "open",
    html_url: "https://example.test/pr/1",
    head: { sha: HEAD },
    base: { ref: BASE_REF, repo: { id: BASE_REPOSITORY_ID } },
    ...overrides,
  };
}

function activeQueueBinding(overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      pullRequest: {
        number: 1,
        state: "OPEN",
        headRefOid: HEAD,
        baseRefName: BASE_REF,
        mergeQueueEntry: {
          state: "AWAITING_CHECKS",
          baseCommit: { oid: BASE_HEAD },
          headCommit: { oid: OTHER_HEAD },
        },
        ...overrides,
      },
    },
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

describe("automated review evidence", () => {
  it("accepts the compact Codex no-findings verdict and rejects stale verdicts", async () => {
    const fixtures = [
      {
        pr: 4012,
        head: HEAD,
        reviews: [],
        comments: [codexComment()],
        expected: "codex-comment",
      },
      {
        pr: 4025,
        head: "666c7af8e7b9245b9449d8a5378ddcc422a6c9f9",
        reviews: [],
        comments: [codexComment("24bb89dc4f")],
        expected: undefined,
      },
      {
        pr: 4028,
        head: OTHER_HEAD,
        reviews: [],
        comments: [],
        expected: undefined,
      },
    ];

    for (const fixture of fixtures) {
      const result = await findAutomatedReview(
        fixture,
        fixture.head,
        (ref) =>
          Promise.resolve(
            ref === fixture.head.slice(0, 10) ? fixture.head : undefined,
          ),
      );
      assertEquals(result?.source, fixture.expected, `PR #${fixture.pr}`);
    }
  });

  it("accepts an exact-head Codex approval but not a findings review", async () => {
    assertEquals(
      (await findAutomatedReview({
        reviews: [review({ state: "APPROVED" })],
        comments: [],
      }, HEAD))?.source,
      "pull-request-review",
    );
    assertEquals(
      await findAutomatedReview({
        reviews: [review({
          state: "COMMENTED",
          body: "P1: This exact-head review has an actionable finding.",
        })],
        comments: [],
      }, HEAD),
      undefined,
    );
  });

  it("lets an exact-head Codex finding supersede an earlier no-findings comment", async () => {
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [review({
            state: "COMMENTED",
            body: "P1: A later exact-head review found an actionable defect.",
          })],
          comments: [codexComment()],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("lets a later exact-head no-findings comment supersede a Codex finding", async () => {
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [review({
            state: "COMMENTED",
            body: "P1: An earlier exact-head review reported a false positive.",
            submitted_at: "2026-08-25T08:00:00Z",
          })],
          comments: [codexComment(HEAD.slice(0, 10), {
            created_at: "2026-08-25T08:00:01Z",
          })],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ))?.source,
      "codex-comment",
    );
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [review({
            id: 101,
            state: "COMMENTED",
            body: "P1: An earlier exact-head review reported a false positive.",
            submitted_at: "2026-08-25T08:00:00Z",
          })],
          comments: [codexComment(HEAD.slice(0, 10), {
            id: 102,
            created_at: "2026-08-25T08:00:00Z",
          })],
          timeline: [
            { event: "reviewed", id: 101 },
            { event: "commented", id: 102 },
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ))?.source,
      "codex-comment",
    );
  });

  it("lets an exact-head Codex finding comment supersede an earlier no-findings comment", async () => {
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [codexComment(), codexFindingComment()],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("treats an edited Codex finding comment as newer than a later-created clean verdict", async () => {
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [
            codexFindingComment(HEAD.slice(0, 10), {
              id: 100,
              created_at: "2026-08-25T08:00:00Z",
              updated_at: "2026-08-25T08:00:02Z",
            }),
            codexComment(HEAD.slice(0, 10), {
              id: 101,
              created_at: "2026-08-25T08:00:01Z",
              updated_at: "2026-08-25T08:00:01Z",
            }),
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("treats a same-second verdict after an edited finding as ambiguous", async () => {
    const findingId = 100;
    const verdictId = 101;
    const finding = codexFindingComment(HEAD.slice(0, 10), {
      id: findingId,
      created_at: "2026-08-25T08:00:00Z",
      updated_at: "2026-08-25T08:00:02Z",
    });
    const verdict = codexComment(HEAD.slice(0, 10), {
      id: verdictId,
      created_at: "2026-08-25T08:00:02Z",
      updated_at: "2026-08-25T08:00:02Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [finding, verdict],
          timeline: [
            { event: "commented", id: findingId },
            { event: "commented", id: verdictId },
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("does not let an edited clean verdict grant success", async () => {
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [
            codexComment(HEAD.slice(0, 10), {
              id: 100,
              created_at: "2026-08-25T08:00:00Z",
              updated_at: "2026-08-25T08:00:03Z",
            }),
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("requires clean verdicts to have a valid creation timestamp", async () => {
    for (const createdAt of [undefined, "", "not-a-date"]) {
      assertEquals(
        await findAutomatedReview(
          {
            reviews: [],
            comments: [
              codexComment(HEAD.slice(0, 10), {
                created_at: createdAt,
                updated_at: "2026-08-25T08:00:00Z",
              }),
            ],
          },
          HEAD,
          () => Promise.resolve(HEAD),
        ),
        undefined,
        `created_at ${createdAt}`,
      );
    }
  });

  it("requires clean verdicts to have a matching valid update timestamp", async () => {
    for (const updatedAt of [undefined, "", "not-a-date"]) {
      assertEquals(
        await findAutomatedReview(
          {
            reviews: [],
            comments: [
              codexComment(HEAD.slice(0, 10), {
                created_at: "2026-08-25T08:00:00Z",
                updated_at: updatedAt,
              }),
            ],
          },
          HEAD,
          () => Promise.resolve(HEAD),
        ),
        undefined,
        `updated_at ${updatedAt}`,
      );
    }
  });

  it("does not let an edited clean verdict supersede a finding after a base boundary", async () => {
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [
            codexComment(HEAD.slice(0, 10), {
              id: 100,
              created_at: "2026-08-25T08:00:00Z",
              updated_at: "2026-08-25T08:00:03Z",
            }),
            codexFindingComment(HEAD.slice(0, 10), {
              id: 101,
              created_at: "2026-08-25T08:00:02Z",
              updated_at: "2026-08-25T08:00:02Z",
            }),
          ],
          events: [{
            event: "base_ref_changed",
            created_at: "2026-08-25T08:00:01Z",
          }],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("lets only a provably later unedited clean verdict supersede an earlier finding", async () => {
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [
            codexFindingComment(HEAD.slice(0, 10), {
              id: 100,
              created_at: "2026-08-25T08:00:00Z",
              updated_at: "2026-08-25T08:00:00Z",
            }),
            codexComment(HEAD.slice(0, 10), {
              id: 101,
              created_at: "2026-08-25T08:00:01Z",
              updated_at: "2026-08-25T08:00:01Z",
            }),
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ))?.source,
      "codex-comment",
    );
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [
            codexFindingComment(HEAD.slice(0, 10), {
              id: 100,
              created_at: "2026-08-25T08:00:00Z",
              updated_at: "2026-08-25T08:00:00Z",
            }),
            codexComment(HEAD.slice(0, 10), {
              id: 101,
              created_at: "2026-08-25T08:00:00Z",
              updated_at: "2026-08-25T08:00:00Z",
            }),
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("lets an exact-head Codex finding comment override a Codex approval", async () => {
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [review({ state: "APPROVED" })],
          comments: [codexFindingComment()],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
  });

  it("does not let CodeRabbit satisfy the Codex gate", async () => {
    assertEquals(
      await findAutomatedReview({
        reviews: [review({
          user: bot("coderabbitai[bot]", CODERABBIT_ID),
          state: "APPROVED",
        })],
        comments: [],
      }, HEAD),
      undefined,
    );
  });

  it("rejects wrong review identity, head, and non-submitted states", async () => {
    const rejected = [
      review({ user: bot("maintainer", CODEX_ID) }),
      review({ user: bot("chatgpt-codex-connector[bot]", CODEX_ID + 1) }),
      review({ commit_id: OTHER_HEAD }),
      review({ state: "DISMISSED" }),
      review({ state: "CHANGES_REQUESTED" }),
      review({ state: "PENDING" }),
      review({ state: "unknown" }),
      review({ state: undefined }),
    ];
    for (const candidate of rejected) {
      assertEquals(
        await findAutomatedReview({
          reviews: [candidate],
          comments: [],
        }, HEAD),
        undefined,
      );
    }
  });

  it("accepts exact-head review evidence read by the trusted reconciler", async () => {
    assertEquals(
      (await findAutomatedReview(
        { reviews: [review({ state: "APPROVED" })], comments: [] },
        HEAD,
      ))?.source,
      "pull-request-review",
    );
    assertEquals(
      (await findAutomatedReview(
        { reviews: [], comments: [codexComment()] },
        HEAD,
        () => Promise.resolve(HEAD),
      ))?.source,
      "codex-comment",
    );
  });

  it("accepts only an exact-head approval from a trusted non-author human", async () => {
    const humanApproval = review({
      user: { login: "trusted-maintainer", id: 7, type: "User" },
      state: "APPROVED",
    });
    assertEquals(
      (await findAutomatedReview(
        { reviews: [humanApproval], comments: [] },
        HEAD,
        undefined,
        (login: string) => Promise.resolve(login === "trusted-maintainer"),
      ))?.source,
      "human-approval",
    );
    for (
      const candidate of [
        review({ ...humanApproval, commit_id: OTHER_HEAD }),
        review({ ...humanApproval, state: "COMMENTED" }),
      ]
    ) {
      assertEquals(
        await findAutomatedReview(
          { reviews: [candidate], comments: [] },
          HEAD,
          undefined,
          () => Promise.resolve(true),
        ),
        undefined,
      );
    }
    assertEquals(
      await findAutomatedReview(
        { reviews: [humanApproval], comments: [] },
        HEAD,
        undefined,
        () => Promise.resolve(false),
      ),
      undefined,
    );
  });

  it("honors each trusted human reviewer's latest exact-head state", async () => {
    const human = { login: "trusted-maintainer", id: 7, type: "User" };
    const approval = review({
      id: 100,
      user: human,
      state: "APPROVED",
      submitted_at: "2026-08-25T07:00:00Z",
    });
    const withdrawal = review({
      id: 101,
      user: human,
      state: "CHANGES_REQUESTED",
      submitted_at: "2026-08-25T07:01:00Z",
    });
    const isTrusted = (login: string) => Promise.resolve(login === human.login);

    assertEquals(
      await findAutomatedReview(
        { reviews: [approval, withdrawal], comments: [] },
        HEAD,
        undefined,
        isTrusted,
      ),
      undefined,
    );
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [
            withdrawal,
            review({
              ...approval,
              id: 102,
              submitted_at: "2026-08-25T07:02:00Z",
            }),
          ],
          comments: [],
        },
        HEAD,
        undefined,
        isTrusted,
      ))?.source,
      "human-approval",
    );
  });

  it("accepts only the pinned Codex canonical no-findings comment", async () => {
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [codexComment()],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ))?.source,
      "codex-comment",
    );
    const rejected = [
      codexComment(OTHER_HEAD.slice(0, 10)),
      codexComment(HEAD.slice(0, 9)),
      codexComment(HEAD.slice(0, 10), { user: bot("maintainer", CODEX_ID) }),
      codexComment(HEAD.slice(0, 10), {
        user: bot("chatgpt-codex-connector[bot]", CODEX_ID + 1),
      }),
      codexComment(HEAD.slice(0, 10), {
        body: `Codex Review: Found an issue.\n\n**Reviewed commit:** \`${
          HEAD.slice(0, 10)
        }\``,
      }),
      codexComment(HEAD.slice(0, 10), {
        body:
          `Codex Review: Didn't find any major issues.\n\nReviewed commit: ${
            HEAD.slice(0, 10)
          }`,
      }),
      codexComment(HEAD.slice(0, 10), {
        body: [
          "Codex Review: Didn't find any major issues.",
          `**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
          `**Reviewed commit:** \`${OTHER_HEAD.slice(0, 10)}\``,
        ].join("\n\n"),
      }),
    ];
    for (const candidate of rejected) {
      assertEquals(
        await findAutomatedReview(
          { reviews: [], comments: [candidate] },
          HEAD,
          () => Promise.resolve(HEAD),
        ),
        undefined,
      );
    }
  });

  it("rejects stale and ambiguous Codex short refs", async () => {
    for (const resolved of [OTHER_HEAD, undefined]) {
      assertEquals(
        await findAutomatedReview(
          { reviews: [], comments: [codexComment()] },
          HEAD,
          () => Promise.resolve(resolved),
        ),
        undefined,
      );
    }
  });

  it("revokes a comment-only proof when the comment is deleted", async () => {
    const evidence = {
      reviews: [],
      comments: [codexComment()],
    };
    assertEquals(
      (await findAutomatedReview(
        evidence,
        HEAD,
        () => Promise.resolve(HEAD),
      ))?.source,
      "codex-comment",
    );
    evidence.comments = [];
    assertEquals(await findAutomatedReview(evidence, HEAD), undefined);
  });

  it("requires review evidence newer than the durable base-reset epoch", async () => {
    const reviewNotBefore = Date.parse("2026-08-25T08:00:00Z");
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [review({
            state: "APPROVED",
            submitted_at: "2026-08-25T07:59:59Z",
          })],
          comments: [
            codexFindingComment(HEAD.slice(0, 10), {
              created_at: "2026-08-25T07:59:58Z",
            }),
            codexComment(HEAD.slice(0, 10), {
              created_at: "2026-08-25T07:59:59Z",
            }),
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        reviewNotBefore,
      ),
      undefined,
    );
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [
            codexFindingComment(HEAD.slice(0, 10), {
              created_at: "2026-08-25T07:59:58Z",
            }),
            codexComment(HEAD.slice(0, 10), {
              created_at: "2026-08-25T08:00:01Z",
            }),
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        reviewNotBefore,
      ))?.source,
      "codex-comment",
    );
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [
            codexComment(HEAD.slice(0, 10), {
              created_at: "2026-08-25T08:00:01Z",
            }),
            codexFindingComment(HEAD.slice(0, 10), {
              created_at: "2026-08-25T08:00:02Z",
            }),
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        reviewNotBefore,
      ),
      undefined,
    );
  });

  it("keeps exact-head approval valid when a normal request marker is posted later", async () => {
    const approval = review({
      id: 101,
      user: { login: "trusted-maintainer", id: 7, type: "User" },
      state: "APPROVED",
      submitted_at: "2026-08-25T08:00:00Z",
    });
    const request = {
      id: 102,
      user: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
      body: `<!-- automated-review-request: ${HEAD} -->\n@codex review`,
      created_at: "2026-08-25T08:00:01Z",
    };

    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [approval],
          comments: [request],
          timeline: [
            { event: "reviewed", id: 101 },
            { event: "commented", id: request.id },
          ],
        },
        HEAD,
        undefined,
        () => Promise.resolve(true),
      ))?.source,
      "human-approval",
    );
  });

  it("uses the durable base reset instead of a later request marker as the boundary", async () => {
    const resetAt = "2026-08-25T08:00:00Z";
    const approval = review({
      id: 101,
      user: { login: "trusted-maintainer", id: 7, type: "User" },
      state: "APPROVED",
      submitted_at: "2026-08-25T08:00:01Z",
    });
    const request = reviewRequestComment("2026-08-25T08:00:02Z", 102);

    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [approval],
          comments: [request],
          timeline: [
            { event: "reviewed", id: 101 },
            { event: "commented", id: request.id },
          ],
        },
        HEAD,
        undefined,
        () => Promise.resolve(true),
        Date.parse(resetAt),
      ))?.source,
      "human-approval",
    );
  });

  it("uses a base-ref issue event before the asynchronous reset status exists", async () => {
    const oldVerdict = codexComment(HEAD.slice(0, 10), {
      id: 101,
      created_at: "2026-08-25T08:00:00Z",
    });
    const freshVerdict = codexComment(HEAD.slice(0, 10), {
      id: 103,
      created_at: "2026-08-25T08:00:01Z",
    });
    const baseChange = {
      event: "base_ref_changed",
      id: 102,
      created_at: "2026-08-25T08:00:00Z",
    };

    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [oldVerdict],
          events: [baseChange],
          timeline: [{ event: "commented", id: 101 }],
        },
        HEAD,
        () => Promise.resolve(HEAD),
      ),
      undefined,
    );
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [freshVerdict],
          events: [baseChange],
          timeline: [{ event: "commented", id: 103 }],
        },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        Date.parse("2026-08-25T08:00:02Z"),
      ))?.source,
      "codex-comment",
    );
  });

  it("orders same-second evidence through the pull request timeline", async () => {
    const request = reviewRequestComment();
    const humanApprovalId = 101;
    const codexVerdictId = 102;
    const codexVerdict = codexComment(HEAD.slice(0, 10), {
      id: codexVerdictId,
      created_at: request.created_at,
    });
    const humanApproval = review({
      id: humanApprovalId,
      user: { login: "trusted-maintainer", id: 7, type: "User" },
      state: "APPROVED",
      submitted_at: request.created_at,
    });
    const timeline = [
      { event: "commented", id: request.id },
      { event: "reviewed", id: humanApprovalId },
      { event: "commented", id: codexVerdictId },
    ];
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [humanApproval],
          comments: [request, codexVerdict],
          timeline,
        },
        HEAD,
        () => Promise.resolve(HEAD),
        () => Promise.resolve(true),
        Date.parse(request.created_at),
      ))?.source,
      "human-approval",
    );
    assertEquals(
      (await findAutomatedReview(
        { reviews: [], comments: [request, codexVerdict], timeline },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        Date.parse(request.created_at),
      ))?.source,
      "codex-comment",
    );

    const findingId = 103;
    const finding = codexFindingComment(HEAD.slice(0, 10), {
      id: findingId,
      created_at: request.created_at,
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [request, codexVerdict, finding],
          timeline: [...timeline, { event: "commented", id: findingId }],
        },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        Date.parse(request.created_at),
      ),
      undefined,
    );

    const beforeRequestId = 99;
    const beforeRequest = codexComment(HEAD.slice(0, 10), {
      id: beforeRequestId,
      created_at: request.created_at,
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [beforeRequest, request],
          timeline: [
            { event: "commented", id: beforeRequestId },
            { event: "commented", id: request.id },
          ],
        },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        Date.parse(request.created_at),
      ),
      undefined,
    );

    const ambiguousFinding = codexFindingComment(HEAD.slice(0, 10), {
      id: 104,
      created_at: request.created_at,
    });
    const laterVerdict = codexComment(HEAD.slice(0, 10), {
      id: 105,
      created_at: "2026-08-25T08:00:01Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [request, ambiguousFinding, laterVerdict],
          timeline: [],
        },
        HEAD,
        () => Promise.resolve(HEAD),
        undefined,
        Date.parse(request.created_at),
      ),
      undefined,
    );
  });
});

function githubFixture(options: {
  pages?: Record<string, unknown[][]>;
  pageResponses?: Record<string, unknown[][][]>;
  headResponses?: string[];
  pullResponses?: Record<string, unknown>[];
  commit?: string | undefined;
  commitResponses?: (string | undefined)[];
  commitError?: Error;
  failAfterFirstPage?: string;
  pullError?: Error;
  permission?: string;
  permissionError?: Error;
  pullAuthor?: string;
  draft?: boolean;
  queueBindings?: Record<string, unknown>[];
  queueBindingError?: Error;
  queueRefHeads?: (string | undefined)[];
  queueRefError?: Error;
  statusIds?: unknown[];
  commentError?: Error;
} = {}) {
  const endpoints = {
    reviews: () => undefined,
    comments: () => undefined,
    events: () => undefined,
    statuses: () => undefined,
    refs: () => undefined,
    timeline: () => undefined,
  };
  const published: Record<string, unknown>[] = [];
  const commentsPosted: Record<string, unknown>[] = [];
  const refReads: Record<string, unknown>[] = [];
  const graphqlReads: { query: unknown; variables: unknown }[] = [];
  const pageReads = new Map<string, number>();
  let pullRead = 0;
  let commitRead = 0;
  let queueBindingRead = 0;
  let queueRefRead = 0;
  let statusWrite = 0;
  const github = {
    graphql: (query: unknown, variables: unknown) => {
      graphqlReads.push({ query, variables });
      if (options.queueBindingError) {
        return Promise.reject(options.queueBindingError);
      }
      const responses = options.queueBindings ?? [activeQueueBinding()];
      const data = responses[
        Math.min(queueBindingRead++, responses.length - 1)
      ];
      return Promise.resolve(data);
    },
    paginate: {
      async *iterator(endpoint: unknown) {
        const name = Object.entries(endpoints).find(([, value]) =>
          value === endpoint
        )?.[0];
        if (!name) throw new Error("unknown endpoint");
        const pageRead = pageReads.get(name) ?? 0;
        pageReads.set(name, pageRead + 1);
        const pages = options.pageResponses?.[name]?.[pageRead] ??
          options.pages?.[name] ?? [[]];
        for (let index = 0; index < pages.length; index++) {
          if (options.failAfterFirstPage === name && index === 1) {
            throw new Error("pagination failed");
          }
          yield { data: pages[index] };
        }
      },
    },
    rest: {
      pulls: {
        listReviews: endpoints.reviews,
        get: () => {
          if (options.pullError) return Promise.reject(options.pullError);
          if (options.pullResponses) {
            const data = options.pullResponses[
              Math.min(pullRead++, options.pullResponses.length - 1)
            ];
            return Promise.resolve({ data });
          }
          const heads = options.headResponses ?? [HEAD];
          const head = heads[Math.min(pullRead++, heads.length - 1)];
          return Promise.resolve({
            data: associatedPull({
              head: { sha: head },
              draft: options.draft ?? false,
              user: { login: options.pullAuthor ?? "pull-author" },
            }),
          });
        },
      },
      issues: {
        listComments: endpoints.comments,
        listEvents: endpoints.events,
        listEventsForTimeline: endpoints.timeline,
        createComment: (comment: Record<string, unknown>) => {
          if (options.commentError) return Promise.reject(options.commentError);
          commentsPosted.push(comment);
          return Promise.resolve();
        },
      },
      git: {
        listMatchingRefs: endpoints.refs,
        getRef: (parameters: Record<string, unknown>) => {
          refReads.push(parameters);
          if (options.queueRefError) {
            return Promise.reject(options.queueRefError);
          }
          const heads = options.queueRefHeads ?? [OTHER_HEAD];
          const sha = heads[Math.min(queueRefRead++, heads.length - 1)];
          return Promise.resolve({ data: { object: { sha } } });
        },
      },
      repos: {
        listCommitStatusesForRef: endpoints.statuses,
        getCommit: () => {
          if (options.commitError) return Promise.reject(options.commitError);
          const commits = options.commitResponses ?? [options.commit];
          const sha = commits[Math.min(commitRead++, commits.length - 1)];
          return Promise.resolve({ data: { sha } });
        },
        getCollaboratorPermissionLevel: () =>
          options.permissionError
            ? Promise.reject(options.permissionError)
            : Promise.resolve({
              data: {
                permission: options.permission ?? "read",
                user: { login: "trusted-maintainer" },
              },
            }),
        createCommitStatus: (value: Record<string, unknown>) => {
          published.push(value);
          const statusIds = options.statusIds ??
            [1000 + published.length];
          const id = statusIds[Math.min(statusWrite++, statusIds.length - 1)];
          return Promise.resolve({
            data: id === undefined ? { ...value } : { ...value, id },
          });
        },
      },
    },
  };
  return { github, published, commentsPosted, refReads, graphqlReads };
}

describe("automated review publication", () => {
  it("fully paginates every evidence source before publishing success", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[], []],
        comments: [[], [codexComment()]],
        events: [[], []],
      },
      headResponses: [HEAD],
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "success");
    assertEquals(result.statusId, 1001);
    assertEquals(fixture.published[0]?.sha, HEAD);
    assertEquals(
      fixture.published[0]?.description,
      `PR#1 base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } by:chatgpt-codex-connector[bot]`,
    );
  });

  it("fails a source success whose status id is missing", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[]],
        comments: [[codexComment()]],
        events: [[]],
      },
      headResponses: [HEAD],
      commit: HEAD,
      statusIds: [undefined, 1002],
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "failure");
    assertEquals(result.statusId, 1002);
    assertEquals(fixture.published[0]?.state, "success");
    assertEquals(fixture.published[1]?.state, "failure");
  });

  it("fails a source success whose status id is invalid or non-positive", async () => {
    for (const statusId of [0, -1, 1.5, "1001"]) {
      const fixture = githubFixture({
        pages: {
          reviews: [[]],
          comments: [[codexComment()]],
          events: [[]],
        },
        headResponses: [HEAD],
        commit: HEAD,
        statusIds: [statusId, 1002],
      });
      const result = await publishAutomatedReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        pullUrl: "https://example.test/pr/1",
      });

      assertEquals(result.state, "failure", `status id ${statusId}`);
      assertEquals(result.statusId, 1002, `status id ${statusId}`);
      assertEquals(fixture.published[0]?.state, "success");
      assertEquals(fixture.published[1]?.state, "failure");
    }
  });

  it("attempts a failure status before rejecting a malformed fallback id", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[]],
        comments: [[codexComment()]],
        events: [[]],
      },
      headResponses: [HEAD],
      commit: HEAD,
      statusIds: [undefined, undefined],
    });

    await assertRejects(
      () =>
        publishAutomatedReviewStatus({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          pullUrl: "https://example.test/pr/1",
        }),
      Error,
      "Published review status identity is malformed",
    );
    assertEquals(fixture.published[0]?.state, "success");
    assertEquals(fixture.published[1]?.state, "failure");
  });

  it("does not let an old-head failure close a newer queued commit", async () => {
    const fixture = githubFixture({
      commit: OTHER_HEAD,
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
          object: { sha: BASE_HEAD },
        }]],
      },
    });
    const result = await publishReviewResolutionFailure({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
    });
    assertEquals(result, { queueFailures: 0, skipped: true });
    assertEquals(fixture.published, []);
  });

  it("does not cross queue ownership when the head changes after failure begins", async () => {
    const fixture = githubFixture({
      commitResponses: [HEAD, HEAD, NEW_HEAD],
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      queueBindings: [activeQueueBinding({ headRefOid: NEW_HEAD })],
    });
    const result = await publishReviewResolutionFailure({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
    });
    assertEquals(result, { queueFailures: 0, skipped: false });
    assertEquals(
      fixture.published.map((status) => [status.sha, status.state]),
      [[HEAD, "failure"]],
    );
  });

  it("propagates operational queue ownership lookup failures", async () => {
    const fixture = githubFixture({
      commit: HEAD,
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
      queueRefError: Object.assign(new Error("queue ref unavailable"), {
        status: 503,
      }),
    });

    await assertRejects(
      () =>
        publishReviewResolutionFailure({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          sourceHeadSha: HEAD,
        }),
      Error,
      "queue ref unavailable",
    );
    assertEquals(
      fixture.published.map((status) => [status.sha, status.state]),
      [[HEAD, "failure"]],
      "an ownership outage must fail the job instead of reporting queue invalidation complete",
    );
  });

  it("skips only a confirmed missing queue ref", async () => {
    const fixture = githubFixture({
      commit: HEAD,
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
      queueRefError: Object.assign(new Error("queue ref not found"), {
        status: 404,
      }),
    });

    assertEquals(
      await publishReviewResolutionFailure({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        sourceHeadSha: HEAD,
      }),
      { queueFailures: 0, skipped: false },
    );
  });

  it("rejects a malformed successful queue ref lookup", async () => {
    const fixture = githubFixture({
      commit: HEAD,
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
      queueRefHeads: [undefined],
    });

    await assertRejects(
      () =>
        publishReviewResolutionFailure({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          sourceHeadSha: HEAD,
        }),
      Error,
      "Merge queue ref response has a malformed commit",
    );
  });

  it("rejects a malformed final source ownership lookup", async () => {
    const fixture = githubFixture({
      commitResponses: [HEAD, HEAD, undefined],
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
    });

    await assertRejects(
      () =>
        publishReviewResolutionFailure({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          sourceHeadSha: HEAD,
        }),
      Error,
      "Commit ref response has a malformed commit",
    );
    assertEquals(
      fixture.published.map((status) => [status.sha, status.state]),
      [[HEAD, "failure"]],
      "a malformed final source response must not leave queue invalidation looking complete",
    );
  });

  it("accepts an exact-head trusted human approval as the escalation path", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({
          user: { login: "trusted-maintainer", id: 7, type: "User" },
          state: "APPROVED",
        })]],
      },
      permission: "write",
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "success");
    assertEquals(result.review?.source, "human-approval");
  });

  it("fails visibly when a collaborator permission lookup fails", async () => {
    const permissionError = Object.assign(
      new Error("collaborator permission unavailable"),
      { status: 500 },
    );
    const fixture = githubFixture({
      pages: {
        reviews: [[review({
          user: { login: "trusted-maintainer", id: 7, type: "User" },
          state: "APPROVED",
        })]],
      },
      permissionError,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "failure");
    assertEquals(result.failure, permissionError);
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("treats a missing collaborator as untrusted review evidence", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({
          user: { login: "external-reviewer", id: 7, type: "User" },
          state: "APPROVED",
        })]],
      },
      permissionError: Object.assign(new Error("not found"), { status: 404 }),
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "pending");
    assertEquals(result.failure, undefined);
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("holds an unreviewed head at pending until proof arrives", async () => {
    const fixture = githubFixture();
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "pending");
    assertEquals(result.review, undefined);
    assertEquals(result.failure, undefined);
    assertEquals(fixture.published[0]?.state, "pending");
    assertEquals(
      fixture.published[0]?.description,
      `PR#1 waits for review ${HEAD.slice(0, 12)}`,
    );
  });

  it("fails a current-head Codex usage-limit reply", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexRateLimitComment()]],
        statuses: [[pendingAutomatedReviewStatus()]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "commented", id: 103 },
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:05:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "failure");
    assertEquals(result.description, "PR#1 automated review rate limited");
    assertEquals(fixture.published[0]?.state, "failure");
    assertEquals(
      fixture.published[0]?.target_url,
      "https://example.test/rate-limit",
    );
  });

  it("fails a triggering usage-limit reply that beats the first pending status", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexRateLimitComment()]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "commented", id: 103 },
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewFailureCommentId: 103,
    });

    assertEquals(result.state, "failure");
    assertEquals(result.description, "PR#1 automated review rate limited");
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("does not bind a delayed limit-comment event to a newer head", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexRateLimitComment()]],
        timeline: [[
          { event: "commented", id: 103 },
          { event: "committed", sha: HEAD },
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewFailureCommentId: 103,
    });

    assertEquals(result.state, "pending");
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("binds a limit reply to the force-pushed head", async () => {
    for (
      const forcePush of [
        { after_commit: HEAD },
        { after_commit: { sha: HEAD } },
        { after_commit: null, commit_id: HEAD },
      ]
    ) {
      const fixture = githubFixture({
        pages: {
          comments: [[codexRateLimitComment()]],
          timeline: [[
            { event: "head_ref_force_pushed", ...forcePush },
            { event: "commented", id: 103 },
          ]],
        },
      });
      const result = await publishAutomatedReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        pullUrl: "https://example.test/pr/1",
        reviewFailureCommentId: 103,
      });

      assertEquals(result.state, "failure");
      assertEquals(
        result.description,
        "PR#1 automated review rate limited",
      );
    }
  });

  it("does not bind a delayed limit reply across a same-head base reset", async () => {
    const resetStatus = automatedReviewResetStatus(
      "2026-08-25T08:01:00Z",
      { id: 100 },
    );
    const fixture = githubFixture({
      pages: {
        comments: [[codexRateLimitComment("2026-08-25T08:00:00Z")]],
        events: [[{
          event: "base_ref_changed",
          created_at: "2026-08-25T08:01:00Z",
        }]],
        statuses: [[resetStatus]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "commented", id: 103 },
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewFailureCommentId: 103,
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 100);
    assertEquals(fixture.published, []);
  });

  it("rejects a same-second old-epoch limit reply as ambiguous", async () => {
    const resetStatus = automatedReviewResetStatus(
      "2026-08-25T08:00:00Z",
      { id: 100 },
    );
    const fixture = githubFixture({
      pages: {
        comments: [[codexRateLimitComment("2026-08-25T08:00:00Z")]],
        events: [[{
          event: "base_ref_changed",
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[resetStatus]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "commented", id: 103 },
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 100);
    assertEquals(fixture.published, []);
  });

  it("orders same-second limit replies after lifecycle events", async () => {
    for (
      const event of ["base_ref_changed", "reopened", "ready_for_review"]
    ) {
      const fixture = githubFixture({
        pages: {
          comments: [[codexRateLimitComment("2026-08-25T08:00:00Z")]],
          events: [[{
            event,
            id: 102,
            created_at: "2026-08-25T08:00:00Z",
          }]],
          timeline: [[
            { event: "committed", sha: HEAD },
            { event, id: 102 },
            { event: "commented", id: 103 },
          ]],
        },
      });
      const result = await publishAutomatedReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        pullUrl: "https://example.test/pr/1",
        reviewFailureCommentId: 103,
      });

      assertEquals(result.state, "failure", event);
      assertEquals(
        result.description,
        "PR#1 automated review rate limited",
        event,
      );

      const staleFixture = githubFixture({
        pages: {
          comments: [[codexRateLimitComment("2026-08-25T08:00:00Z")]],
          events: [[{
            event,
            id: 102,
            created_at: "2026-08-25T08:00:00Z",
          }]],
          timeline: [[
            { event: "committed", sha: HEAD },
            { event: "commented", id: 103 },
            { event, id: 102 },
          ]],
        },
      });
      const staleResult = await publishAutomatedReviewStatus({
        github: staleFixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        pullUrl: "https://example.test/pr/1",
        reviewFailureCommentId: 103,
      });
      assertEquals(staleResult.state, "pending", event);
    }
  });

  it("does not treat two missing comment ids as a triggering limit reply", async () => {
    const comment = {
      ...codexRateLimitComment("2026-08-25T07:59:59Z"),
      id: undefined,
    };
    const fixture = githubFixture({
      pages: {
        comments: [[comment]],
        statuses: [[pendingAutomatedReviewStatus()]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 100);
    assertEquals(fixture.published, []);
  });

  it("does not apply an old-head usage-limit reply to a newer pending epoch", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexRateLimitComment("2026-08-25T07:59:59Z")]],
        statuses: [[pendingAutomatedReviewStatus()]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:05:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 100);
    assertEquals(fixture.published, []);
  });

  it("lets later exact-head proof recover a rate-limited review", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[
          codexRateLimitComment(),
          codexComment(HEAD.slice(0, 10), {
            id: 104,
            created_at: "2026-08-25T08:02:00Z",
            updated_at: "2026-08-25T08:02:00Z",
          }),
        ]],
        statuses: [[automatedReviewStatus({
          id: 105,
          state: "failure",
          description: "PR#1 automated review rate limited",
          target_url: "https://example.test/rate-limit",
        })]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:05:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "success");
    assertEquals(fixture.published[0]?.state, "success");
  });

  it("fails pending review evidence at the 30-minute timeout", async () => {
    const fixture = githubFixture({
      pages: { statuses: [[pendingAutomatedReviewStatus()]] },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:30:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "failure");
    assertEquals(result.description, "PR#1 automated review timed out");
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("keeps a younger unreviewed head pending", async () => {
    const fixture = githubFixture({
      pages: { statuses: [[pendingAutomatedReviewStatus()]] },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:29:59Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 100);
    assertEquals(fixture.published, []);
  });

  it("reuses the first pending status instead of refreshing its timeout", async () => {
    const fixture = githubFixture({
      pages: { statuses: [[pendingAutomatedReviewStatus()]] },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 100);
    assertEquals(fixture.published, []);
  });

  it("retains the pending anchor behind an operational failure", async () => {
    const fixture = githubFixture({
      pages: {
        statuses: [[
          automatedReviewStatus({
            id: 106,
            state: "failure",
            description: "PR#1 review status unavailable",
            created_at: "2026-08-25T08:05:00Z",
          }),
          pendingAutomatedReviewStatus("2026-08-25T08:00:00Z"),
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:30:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "failure");
    assertEquals(result.description, "PR#1 automated review timed out");
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("preserves a terminal review failure across unrelated edits", async () => {
    const terminalStatus = automatedReviewStatus({
      id: 105,
      state: "failure",
      description: "PR#1 automated review rate limited",
      target_url: "https://example.test/rate-limit",
      created_at: "2026-08-25T08:00:00Z",
    });
    const fixture = githubFixture({
      pages: { statuses: [[terminalStatus]] },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "failure");
    assertEquals(result.statusId, 105);
    assertEquals(result.description, "PR#1 automated review rate limited");
    assertEquals(fixture.published, []);
  });

  it("preserves a same-second terminal failure proven after a lifecycle reset", async () => {
    const limitComment = {
      ...codexRateLimitComment("2026-08-25T08:00:00Z"),
      updated_at: "2026-08-25T08:00:01Z",
    };
    const terminalStatus = automatedReviewStatus({
      id: 105,
      state: "failure",
      description: "PR#1 automated review rate limited",
      target_url: limitComment.html_url,
      created_at: "2026-08-25T08:00:00Z",
    });
    const fixture = githubFixture({
      pages: {
        comments: [[limitComment]],
        events: [[{
          event: "reopened",
          id: 102,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[terminalStatus]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "reopened", id: 102 },
          { event: "commented", id: 103 },
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "failure");
    assertEquals(result.statusId, 105);
    assertEquals(result.description, "PR#1 automated review rate limited");
    assertEquals(fixture.published, []);

    const staleFixture = githubFixture({
      pages: {
        comments: [[limitComment]],
        events: [[{
          event: "reopened",
          id: 102,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[terminalStatus]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "commented", id: 103 },
          { event: "reopened", id: 102 },
        ]],
      },
    });
    const staleResult = await publishAutomatedReviewStatus({
      github: staleFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(staleResult.state, "pending");
    assertEquals(staleFixture.published[0]?.state, "pending");

    const lateTerminalStatus = automatedReviewStatus({
      id: 106,
      state: "failure",
      description: "PR#1 automated review rate limited",
      target_url: limitComment.html_url,
      created_at: "2026-08-25T10:00:00Z",
    });
    const lateFixture = githubFixture({
      pages: {
        comments: [[limitComment]],
        events: [[{
          event: "reopened",
          id: 102,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[lateTerminalStatus]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "commented", id: 103 },
          { event: "reopened", id: 102 },
        ]],
      },
    });
    const lateResult = await publishAutomatedReviewStatus({
      github: lateFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(lateResult.state, "pending");
    assertEquals(lateFixture.published[0]?.state, "pending");

    const oldTimeout = automatedReviewStatus({
      id: 107,
      state: "failure",
      description: "PR#1 automated review timed out",
      created_at: "2026-08-25T08:00:00Z",
    });
    const newPending = pendingAutomatedReviewStatus(
      "2026-08-25T09:01:00Z",
    );
    const oldTimeoutFixture = githubFixture({
      pages: {
        events: [[{
          event: "ready_for_review",
          id: 108,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[newPending, oldTimeout]],
      },
    });
    const oldTimeoutResult = await publishAutomatedReviewStatus({
      github: oldTimeoutFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(oldTimeoutResult.state, "pending");
    assertEquals(oldTimeoutResult.statusId, 100);
    assertEquals(oldTimeoutFixture.published, []);
  });

  it("ignores terminal descriptions from another status context", async () => {
    const fixture = githubFixture({
      pages: {
        statuses: [[automatedReviewStatus({
          id: 105,
          context: "Unrelated check",
          state: "failure",
          description: "PR#1 automated review timed out",
          created_at: "2026-08-25T08:00:00Z",
        })]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(fixture.published.length, 1);
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("republishes terminal evidence hidden behind a later generic failure", async () => {
    const republishedTerminalStatus = automatedReviewStatus({
      id: 1001,
      state: "failure",
      description: "PR#1 automated review timed out",
      created_at: "2026-08-25T08:02:00Z",
    });
    const fixture = githubFixture({
      pageResponses: {
        statuses: [
          [[
            automatedReviewStatus({
              id: 106,
              state: "failure",
              description: "PR#1 review status unavailable",
              created_at: "2026-08-25T08:01:00Z",
            }),
            automatedReviewStatus({
              id: 105,
              state: "failure",
              description: "PR#1 automated review timed out",
              created_at: "2026-08-25T08:00:00Z",
            }),
          ]],
          [[republishedTerminalStatus]],
        ],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "failure");
    assertEquals(result.statusId, 1001);
    assertEquals(result.description, "PR#1 automated review timed out");
    assertEquals(fixture.published[0]?.state, "failure");
    assertEquals(
      fixture.published[0]?.target_url,
      "https://example.test/review-proof",
    );
    assertEquals(
      await publishReviewResolutionFailure({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        sourceHeadSha: HEAD,
        sourceStatusId: result.statusId,
      }),
      { queueFailures: 0, skipped: false },
    );
  });

  it("preserves queue-retry failures until propagation completes", async () => {
    const retryStatus = automatedReviewStatus({
      id: 105,
      state: "failure",
      description: "PR#1 automated review timed out; queue retry pending",
      target_url: "https://example.test/pr/1",
      created_at: "2026-08-25T08:00:00Z",
    });
    const fixture = githubFixture({
      pages: { statuses: [[retryStatus]] },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "failure");
    assertEquals(result.statusId, 105);
    assertEquals(result.description, retryStatus.description);
    assertEquals(fixture.published, []);

    const resetFixture = githubFixture({
      pages: {
        events: [[{
          event: "ready_for_review",
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[retryStatus]],
      },
    });
    const resetResult = await publishAutomatedReviewStatus({
      github: resetFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(resetResult.state, "pending");
    assertEquals(resetFixture.published[0]?.state, "pending");

    const hiddenFixture = githubFixture({
      pages: {
        statuses: [[
          automatedReviewStatus({
            id: 106,
            state: "failure",
            description: "PR#1 review status unavailable",
          }),
          retryStatus,
        ]],
      },
    });
    const hiddenResult = await publishAutomatedReviewStatus({
      github: hiddenFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(hiddenResult.state, "failure");
    assertEquals(hiddenResult.description, retryStatus.description);
    assertEquals(hiddenFixture.published[0]?.state, "failure");
    assertEquals(
      hiddenFixture.published[0]?.description,
      retryStatus.description,
    );

    const sameSecondRetry = automatedReviewStatus({
      id: 107,
      state: "failure",
      description: "PR#1 review status unavailable; queue retry pending",
      created_at: "2026-08-25T09:00:00Z",
    });
    const sameSecondFixture = githubFixture({
      pages: {
        events: [[{
          event: "ready_for_review",
          id: 108,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[sameSecondRetry]],
      },
    });
    const sameSecondResult = await publishAutomatedReviewStatus({
      github: sameSecondFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(sameSecondResult.state, "failure");
    assertEquals(sameSecondResult.statusId, 107);
    assertEquals(sameSecondResult.description, sameSecondRetry.description);
    assertEquals(sameSecondFixture.published, []);

    const oldLimitComment = codexRateLimitComment(
      "2026-08-25T08:00:00Z",
    );
    const lateRateMarker = automatedReviewStatus({
      id: 109,
      state: "failure",
      description:
        "PR#1 automated review rate limited; queue retry pending",
      target_url: oldLimitComment.html_url,
      created_at: "2026-08-25T10:00:00Z",
    });
    const staleRateFixture = githubFixture({
      pages: {
        comments: [[oldLimitComment]],
        events: [[{
          event: "ready_for_review",
          id: 108,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[lateRateMarker]],
        timeline: [[
          { event: "committed", sha: HEAD },
          { event: "commented", id: 103 },
          { event: "ready_for_review", id: 108 },
        ]],
      },
    });
    const staleRateResult = await publishAutomatedReviewStatus({
      github: staleRateFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(staleRateResult.state, "pending");

    const lateTimeoutMarker = automatedReviewStatus({
      id: 110,
      state: "failure",
      description: "PR#1 automated review timed out; queue retry pending",
      created_at: "2026-08-25T10:00:00Z",
    });
    const staleTimeoutFixture = githubFixture({
      pages: {
        events: [[{
          event: "ready_for_review",
          id: 108,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[
          lateTimeoutMarker,
          pendingAutomatedReviewStatus("2026-08-25T08:00:00Z"),
        ]],
      },
    });
    const staleTimeoutResult = await publishAutomatedReviewStatus({
      github: staleTimeoutFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(staleTimeoutResult.state, "pending");
  });

  it("does not adopt an unavailable retry from an older review epoch", async () => {
    const origin = githubFixture();
    const retry = await publishReviewPropagationRetryStatus({
      github: origin.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      failureKind: "unavailable",
      targetUrl: "https://example.test/pr/1",
      reviewRequestKey: "base-42",
    });
    const fixture = githubFixture({
      pages: {
        events: [[{
          event: "base_ref_changed",
          id: 43,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[automatedReviewStatus({
          id: 105,
          state: "failure",
          description: retry.description,
          created_at: "2026-08-25T09:00:01Z",
        })]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.reviewRequestKey, "base-43");
  });

  it("does not time out a pending status from before a base reset", async () => {
    const fixture = githubFixture({
      pages: {
        events: [[{
          event: "base_ref_changed",
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[pendingAutomatedReviewStatus(
          "2026-08-25T07:00:00Z",
        )]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:30:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "pending");
    assertEquals(fixture.published.length, 1);
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("times out a same-second pending status created by ready-for-review", async () => {
    const fixture = githubFixture({
      pages: {
        events: [[{
          event: "ready_for_review",
          id: 102,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[pendingAutomatedReviewStatus(
          "2026-08-25T08:00:00Z",
        )]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      now: Date.parse("2026-08-25T08:30:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.state, "failure");
    assertEquals(result.description, "PR#1 automated review timed out");
  });

  it("lets a reopen epoch supersede an older base change", async () => {
    const verdict = codexComment(HEAD.slice(0, 10), {
      id: 104,
      created_at: "2026-08-25T08:01:00Z",
      updated_at: "2026-08-25T08:01:00Z",
    });
    const fixture = githubFixture({
      pages: {
        comments: [[verdict]],
        events: [[
          {
            event: "base_ref_changed",
            created_at: "2026-08-25T08:00:00Z",
          },
          {
            event: "reopened",
            created_at: "2026-08-25T09:00:00Z",
          },
        ]],
        statuses: [[automatedReviewResetStatus(
          "2026-08-25T09:00:00Z",
          { id: 100 },
        )]],
        timeline: [[{ event: "commented", id: 104 }]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 100);
    assertEquals(fixture.published, []);
  });

  it("preserves fresh proof that wins the reopen publisher race", async () => {
    const verdict = codexComment(HEAD.slice(0, 10), {
      id: 103,
      created_at: "2026-08-25T09:00:01Z",
      updated_at: "2026-08-25T09:00:01Z",
    });
    const fixture = githubFixture({
      pages: {
        comments: [[verdict]],
        events: [[{
          event: "reopened",
          id: 102,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        timeline: [[
          { event: "reopened", id: 102 },
          { event: "commented", id: 103 },
        ]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "reopen-42",
    });

    assertEquals(result.state, "success");
    assertEquals(result.review?.source, "codex-comment");
    assertEquals(fixture.published.length, 1);
    assertEquals(fixture.published[0]?.state, "success");
    assertEquals(
      fixture.published[0]?.description,
      `PR#1 base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } by:chatgpt-codex-connector[bot]`,
    );
  });

  it("clears terminal evidence when a pull request becomes ready", async () => {
    const fixture = githubFixture({
      pages: {
        events: [[{
          event: "ready_for_review",
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[
          automatedReviewStatus({
            id: 106,
            state: "pending",
            description: "PR#1 draft waits for review",
            created_at: "2026-08-25T08:30:00Z",
          }),
          automatedReviewStatus({
            id: 105,
            state: "failure",
            description: "PR#1 automated review timed out",
            created_at: "2026-08-25T08:00:00Z",
          }),
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(fixture.published.length, 1);
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("forces a run-bound reset when ready evidence is ambiguous", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          id: 103,
          created_at: "2026-08-25T09:00:00Z",
          updated_at: "2026-08-25T09:00:00Z",
        })]],
        events: [[{
          event: "ready_for_review",
          id: 41,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        timeline: [[
          { event: "ready_for_review", id: 41 },
          { event: "commented", id: 103 },
        ]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "ready",
      reviewEpochNotBefore: "2026-08-25T09:00:00Z",
      reviewEpochRunKey: "9001",
    });

    assertEquals(result.state, "pending");
    assertEquals(
      fixture.published[0]?.description,
      `PR#1 reset base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } key:ready-r-6y1-t-mt8fp9c0-e-15`,
    );
  });

  it("keeps run-bound reset descriptions within GitHub's status limit", async () => {
    const fixture = githubFixture({
      pages: {
        events: [[{
          event: "base_ref_changed",
          id: 12_345_678_901,
          created_at: "2026-08-25T09:00:00Z",
        }]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1234,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1234",
      reviewResetKey: "base",
      reviewEpochNotBefore: "2026-08-25T09:00:00Z",
      reviewEpochRunKey: "12345678901",
    });

    assertEquals(result.state, "pending");
    assert(
      result.description.length <= 140,
      "commit-status descriptions must fit GitHub's 140-character limit",
    );
  });

  it("keeps a published run-bound reset as the active proof boundary", async () => {
    const fixture = githubFixture({
      commit: HEAD,
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          id: 103,
          created_at: "2026-08-25T09:00:00Z",
          updated_at: "2026-08-25T09:00:00Z",
        })]],
        events: [[{
          event: "ready_for_review",
          id: 41,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[automatedReviewStatus({
          id: 104,
          state: "pending",
          description: `PR#1 reset base:${
            reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
          } key:ready-run-9001-at-1787644800000-event-41`,
          created_at: "2026-08-25T10:00:00Z",
        })]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.review, undefined);
    assertEquals(fixture.published, []);
  });

  it("applies a run-bound reset when validating terminal failures", async () => {
    const reset = automatedReviewResetStatus("2026-08-25T10:00:00Z", {
      id: 106,
      description: `PR#1 reset base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } key:ready-run-9001-at-1787644800000-event-41`,
    });
    const fixture = githubFixture({
      pages: {
        events: [[{
          event: "ready_for_review",
          id: 41,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[
          reset,
          automatedReviewStatus({
            id: 105,
            state: "failure",
            description: "PR#1 automated review timed out",
            created_at: "2026-08-25T09:00:00Z",
          }),
          pendingAutomatedReviewStatus("2026-08-25T08:30:00Z"),
        ]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.statusId, 106);
  });

  it("prefers a newly visible epoch over a superseded run-bound reset", async () => {
    const reset = automatedReviewResetStatus("2026-08-25T08:00:00Z", {
      id: 104,
      description: `PR#1 reset base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } key:base-run-9001-at-1787644800000-event-42`,
    });
    const fixture = githubFixture({
      pages: {
        events: [[
          {
            event: "base_ref_changed",
            id: 42,
            created_at: "2026-08-25T08:00:00Z",
          },
          {
            event: "base_ref_changed",
            id: 43,
            created_at: "2026-08-25T08:00:00Z",
          },
        ]],
        statuses: [[reset]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.reviewRequestKey, "base-43");
  });

  it("starts a fresh pending epoch when a pull request reopens", async () => {
    const fixture = githubFixture({
      pages: {
        events: [[{
          event: "reopened",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[pendingAutomatedReviewStatus()]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "reopen",
    });

    assertEquals(result.state, "pending");
    assertEquals(fixture.published.length, 1);
    assertEquals(fixture.published[0]?.state, "pending");
    assertEquals(
      fixture.published[0]?.description,
      `PR#1 reset base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } key:10c4ec5f2d10`,
    );

    const superseded = githubFixture({
      pages: {
        events: [[
          {
            event: "reopened",
            id: 42,
            created_at: "2026-08-25T09:00:00Z",
          },
          {
            event: "ready_for_review",
            id: 43,
            created_at: "2026-08-25T10:00:00Z",
          },
        ]],
        statuses: [[pendingAutomatedReviewStatus(
          "2026-08-25T09:00:00Z",
        )]],
      },
    });
    const supersededResult = await publishAutomatedReviewStatus({
      github: superseded.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "reopen",
    });
    assertEquals(supersededResult.state, "pending");
    assertEquals(
      superseded.published[0]?.description,
      `PR#1 waits for review ${HEAD.slice(0, 12)}`,
    );

    const supersededBase = githubFixture({
      pages: {
        events: [[
          {
            event: "base_ref_changed",
            id: 42,
            created_at: "2026-08-25T09:00:00Z",
          },
          {
            event: "reopened",
            id: 43,
            created_at: "2026-08-25T10:00:00Z",
          },
        ]],
        statuses: [[pendingAutomatedReviewStatus(
          "2026-08-25T09:00:00Z",
        )]],
      },
    });
    const supersededBaseResult = await publishAutomatedReviewStatus({
      github: supersededBase.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "base",
    });
    assertEquals(supersededBaseResult.state, "pending");
    assertEquals(
      supersededBase.published[0]?.description,
      `PR#1 waits for review ${HEAD.slice(0, 12)}`,
    );

    const notVisible = githubFixture({
      pages: {
        events: [[{
          event: "reopened",
          id: 41,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[pendingAutomatedReviewStatus()]],
      },
    });
    const notVisibleResult = await publishAutomatedReviewStatus({
      github: notVisible.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "reopen",
      reviewEpochNotBefore: "2026-08-25T09:00:00Z",
    });
    assertEquals(notVisibleResult.state, "failure");
    assertEquals(
      notVisibleResult.description,
      "PR#1 review status unavailable",
    );

    const tiedReset = automatedReviewResetStatus(
      "2026-08-25T09:00:00Z",
      {
        id: 100,
        description: `PR#1 reset base:${
          reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
        } key:160accde50a8`,
      },
    );
    const tiedFixture = githubFixture({
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          id: 103,
          created_at: "2026-08-25T09:00:00Z",
          updated_at: "2026-08-25T09:00:00Z",
        })]],
        events: [[{
          event: "reopened",
          id: 41,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        statuses: [[tiedReset]],
        timeline: [[
          { event: "reopened", id: 41 },
          { event: "commented", id: 103 },
        ]],
      },
      commit: HEAD,
    });
    const tiedResult = await publishAutomatedReviewStatus({
      github: tiedFixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "reopen",
      reviewEpochNotBefore: "2026-08-25T09:00:00Z",
      reviewEpochRunKey: "9001",
    });
    assertEquals(tiedResult.state, "pending");
    assertEquals(
      tiedFixture.published[0]?.description,
      `PR#1 reset base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } key:reopen-r-6y1-t-mt8fp9c0-e-15`,
    );

    const runReset = automatedReviewResetStatus(
      "2026-08-25T09:00:01Z",
      {
        id: 101,
        description: `PR#1 reset base:${
          reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
        } key:reopen-r-6y1-t-mt8fp9c0-e-15`,
      },
    );

    const rerun = await publishAutomatedReviewStatus({
      github: githubFixture({
        pages: {
          events: [[{
            event: "reopened",
            id: 41,
            created_at: "2026-08-25T09:00:00Z",
          }]],
          statuses: [[runReset, tiedReset]],
        },
      }).github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "reopen",
      reviewEpochNotBefore: "2026-08-25T09:00:00Z",
      reviewEpochRunKey: "9001",
    });
    assertEquals(rerun.state, "pending");
    assertEquals(rerun.statusId, 101);
  });

  it("fails when exact-ref lookup is operationally unavailable", async () => {
    const fixture = githubFixture({
      pages: { comments: [[codexComment()]] },
      commitError: Object.assign(new Error("commit lookup unavailable"), {
        status: 503,
      }),
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "failure");
    assert(result.failure instanceof Error);
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("treats a missing exact ref as absent review evidence", async () => {
    const fixture = githubFixture({
      pages: { comments: [[codexComment()]] },
      commitError: Object.assign(new Error("commit not found"), {
        status: 404,
      }),
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "pending");
    assertEquals(result.failure, undefined);
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("fails closed on partial pagination and the 500-item cap", async () => {
    const partialPages = [
      "reviews",
      "comments",
      "events",
      "statuses",
      "timeline",
    ].map((source) =>
      githubFixture({
        pages: { [source]: [[], []] },
        failAfterFirstPage: source,
      })
    );
    for (
      const fixture of [
        ...partialPages,
        githubFixture({
          pages: { reviews: [Array.from({ length: 501 }, () => review())] },
        }),
      ]
    ) {
      const result = await publishAutomatedReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        pullUrl: "https://example.test/pr/1",
      });
      assertEquals(result.state, "failure");
      assert(result.failure instanceof Error);
      assertEquals(fixture.published[0]?.state, "failure");
    }
  });

  it("fails the captured head when it drifts before publication", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment()]],
      },
      commit: HEAD,
      headResponses: [OTHER_HEAD],
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "failure");
    assertEquals(fixture.published[0]?.sha, HEAD);
  });

  it("clears accepted proof when the final head refetch rejects", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment()]],
      },
      commit: HEAD,
      pullError: new Error("pull unavailable"),
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "failure");
    assertEquals(result.review, undefined);
    assertEquals(fixture.published[0]?.state, "failure");
    assertEquals(
      fixture.published[0]?.target_url,
      "https://example.test/pr/1",
    );
  });

  it("rejects human approvals from the pull author or a read-only reviewer", async () => {
    for (
      const options of [
        { permission: "write", pullAuthor: "reviewer" },
        { permission: "read", pullAuthor: "pull-author" },
      ]
    ) {
      const fixture = githubFixture({
        pages: {
          reviews: [[review({
            user: { login: "reviewer", id: 7, type: "User" },
            state: "APPROVED",
          })]],
        },
        ...options,
      });
      const result = await publishAutomatedReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        pullUrl: "https://example.test/pr/1",
      });
      assertEquals(result.state, "pending");
      assertEquals(result.review, undefined);
      assertEquals(fixture.published[0]?.state, "pending");
    }
  });

  it("keeps drafts pending after confirming the captured head", async () => {
    const fixture = githubFixture({ draft: true });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "pending");
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("records a durable base reset when the pull request is still draft", async () => {
    const fixture = githubFixture({
      draft: true,
      pages: { comments: [[codexComment()]] },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "base-42",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.review, undefined);
    assertEquals(
      fixture.published[0]?.description,
      `PR#1 reset base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } key:088423c07825`,
    );
  });

  it("does not mint a newer draft reset when the same base-edit run is retried", async () => {
    const fixture = githubFixture({
      draft: true,
      pages: {
        statuses: [[automatedReviewResetStatus(
          "2026-08-25T08:00:00Z",
          {
            description: `PR#1 reset base:${
              reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
            } key:088423c07825`,
          },
        )]],
      },
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "base-42",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.description, "PR#1 draft waits for review");
  });

  it("forces a fresh review after a base edit even when old proof exists", async () => {
    const fixture = githubFixture({
      pages: { comments: [[codexComment()]] },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "base-42",
    });
    assertEquals(result.state, "pending");
    assertEquals(result.review, undefined);
    assertEquals(fixture.published[0]?.state, "pending");
    assertEquals(
      fixture.published[0]?.description,
      `PR#1 reset base:${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } key:088423c07825`,
    );
  });

  it("blocks old proof before the base-edit run publishes its reset", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          id: 101,
          created_at: "2026-08-25T08:00:00Z",
        })]],
        events: [[
          {
            event: "base_ref_changed",
            id: 102,
            created_at: "2026-08-25T08:00:01Z",
          },
        ]],
        timeline: [[{ event: "commented", id: 101 }]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "pending");
    assertEquals(result.review, undefined);
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("keeps proof after the base event valid when the reset status lands later", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          id: 103,
          created_at: "2026-08-25T08:00:01Z",
        })]],
        events: [[{
          event: "base_ref_changed",
          id: 102,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[automatedReviewResetStatus(
          "2026-08-25T08:00:02Z",
        )]],
        timeline: [[{ event: "commented", id: 103 }]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });

    assertEquals(result.state, "success");
    assertEquals(result.review?.source, "codex-comment");
    assertEquals(fixture.published[0]?.state, "success");
  });

  it("does not repeat a processed base-edit reset when its run is rerun", async () => {
    const request = reviewRequestComment();
    const verdict = codexComment(HEAD.slice(0, 10), {
      id: 101,
      created_at: "2026-08-25T08:01:00Z",
    });
    const fixture = githubFixture({
      pages: {
        comments: [[request, verdict]],
        statuses: [[automatedReviewResetStatus()]],
        timeline: [[
          { event: "commented", id: request.id },
          { event: "commented", id: 101 },
        ]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      reviewResetKey: "base-42",
    });
    assertEquals(result.state, "success");
    assertEquals(result.review?.source, "codex-comment");
    assertEquals(fixture.published[0]?.state, "success");
  });

  it("keeps pre-retarget proof invalid after the request marker is deleted", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          created_at: "2026-08-25T07:59:59Z",
        })]],
        statuses: [[automatedReviewResetStatus()]],
      },
      commit: HEAD,
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "pending");
    assertEquals(result.review, undefined);
    assertEquals(fixture.published[0]?.state, "pending");
  });

  it("fails accepted proof when the base changes during reconciliation", async () => {
    const fixture = githubFixture({
      pages: { comments: [[codexComment()]] },
      commit: HEAD,
      pullResponses: [
        associatedPull({
          draft: false,
          user: { login: "pull-author" },
        }),
        associatedPull({
          draft: false,
          user: { login: "pull-author" },
          base: {
            ref: OTHER_BASE_REF,
            repo: { id: BASE_REPOSITORY_ID },
          },
        }),
      ],
    });
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(result.state, "failure");
    assertEquals(result.review, undefined);
    assertEquals(fixture.published[0]?.state, "failure");
  });
});

describe("automated review timeout watchdog", () => {
  const timeoutPull = (
    pullNumber: number,
    createdAt?: string,
    overrides: Record<string, unknown> = {},
    statusState = "PENDING",
    statusCreator: Record<string, unknown> = {
      __typename: "Bot",
      login: "github-actions",
      databaseId: GITHUB_ACTIONS_ID,
    },
    statusDescription = `PR#${pullNumber} waits for review ${
      HEAD.slice(0, 12)
    }`,
  ) => ({
    number: pullNumber,
    isDraft: false,
    headRefOid: HEAD,
    commits: {
      nodes: [{
        commit: {
          status: {
            contexts: createdAt === undefined
              ? []
              : [{
                context: "Automated review",
                state: statusState,
                description: statusDescription,
                createdAt,
                creator: statusCreator,
              }],
          },
        },
      }],
    },
    ...overrides,
  });

  const timeoutDiscoveryFixture = (
    pages: Array<Record<string, unknown>[]>,
    queryReads: unknown[] = [],
  ) => {
    let read = 0;
    return {
      graphql: (query: unknown, variables: Record<string, unknown>) => {
        assert(String(query).includes("TimedOutAutomatedReviews"));
        queryReads.push(query);
        const nodes = pages[read] ?? [];
        const hasNextPage = read < pages.length - 1;
        read += 1;
        return Promise.resolve({
          repository: {
            pullRequests: {
              nodes,
              pageInfo: {
                hasNextPage,
                endCursor: hasNextPage ? `cursor-${read}` : null,
              },
            },
          },
          variables,
        });
      },
    };
  };

  it("discovers only expired pending reviews for open non-draft heads", async () => {
    const github = timeoutDiscoveryFixture([[
      timeoutPull(1, "2026-08-25T08:00:00Z"),
      timeoutPull(2, "2026-08-25T08:00:00Z", { isDraft: true }),
    ]]);

    assertEquals(
      await findTimedOutAutomatedReviews({
        github,
        owner: "veryfront",
        repo: "veryfront-code",
        now: Date.parse("2026-08-25T08:30:00Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      [{ pullNumber: 1, headSha: HEAD }],
    );
  });

  it("does not discover a younger pending status or a completed status", async () => {
    const github = timeoutDiscoveryFixture([[
      timeoutPull(1, "2026-08-25T08:00:01Z"),
      timeoutPull(2, "2026-08-25T08:00:00Z", {}, "SUCCESS"),
    ]]);

    assertEquals(
      await findTimedOutAutomatedReviews({
        github,
        owner: "veryfront",
        repo: "veryfront-code",
        now: Date.parse("2026-08-25T08:30:00Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      [],
    );
  });

  it("rediscovers operational failures that may hide a pending anchor", async () => {
    const github = timeoutDiscoveryFixture([[
      timeoutPull(
        1,
        "2026-08-25T08:05:00Z",
        {},
        "FAILURE",
        {
          __typename: "Bot",
          login: "github-actions",
          databaseId: GITHUB_ACTIONS_ID,
        },
        "PR#1 review status unavailable",
      ),
    ]]);

    assertEquals(
      await findTimedOutAutomatedReviews({
        github,
        owner: "veryfront",
        repo: "veryfront-code",
        now: Date.parse("2026-08-25T08:06:00Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      [{ pullNumber: 1, headSha: HEAD }],
    );
  });

  it("bounds scheduled fan-out when many reviews time out together", async () => {
    const pulls = Array.from({ length: 26 }, (_, index) =>
      timeoutPull(index + 1, "2026-08-25T08:00:00Z")
    );
    const github = timeoutDiscoveryFixture([pulls]);

    const targets = await findTimedOutAutomatedReviews({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      now: Date.parse("2026-08-25T08:30:00Z"),
      reviewTimeoutMs: 1_800_000,
    });
    assertEquals(targets.length, 25);
  });

  it("rotates bounded discovery across eligible pull requests", async () => {
    const pulls = Array.from({ length: 30 }, (_, index) =>
      timeoutPull(index + 1, "2026-08-25T08:00:00Z")
    );
    const discover = (now: string) =>
      findTimedOutAutomatedReviews({
        github: timeoutDiscoveryFixture([pulls]),
        owner: "veryfront",
        repo: "veryfront-code",
        now: Date.parse(now),
        reviewTimeoutMs: 1_800_000,
      });
    const first = await discover("2026-08-25T08:30:00Z");
    const second = await discover("2026-08-25T08:40:00Z");

    assertEquals(first.length, 25);
    assertEquals(second.length, 25);
    assert(
      first.some((target: { pullNumber: number }, index: number) =>
        target.pullNumber !== second[index]?.pullNumber
      ),
      "successive watchdog intervals must not select the same bounded batch",
    );
    assertEquals(
      new Set(
        [...first, ...second].map((target: { pullNumber: number }) =>
          target.pullNumber
        ),
      ).size,
      30,
    );
  });

  it("does not let spoofed pending statuses starve the timeout batch", async () => {
    const spoofedCreator = {
      __typename: "Bot",
      login: "github-actions",
      databaseId: GITHUB_ACTIONS_ID + 1,
    };
    const pulls = [
      ...Array.from({ length: 25 }, (_, index) =>
        timeoutPull(
          index + 1,
          "2026-08-25T08:00:00Z",
          {},
          "PENDING",
          spoofedCreator,
        )),
      timeoutPull(26, "2026-08-25T08:00:00Z"),
    ];
    const queryReads: unknown[] = [];
    const github = timeoutDiscoveryFixture([pulls], queryReads);

    assertEquals(
      await findTimedOutAutomatedReviews({
        github,
        owner: "veryfront",
        repo: "veryfront-code",
        now: Date.parse("2026-08-25T08:30:00Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      [{ pullNumber: 26, headSha: HEAD }],
    );
    const query = String(queryReads[0]);
    for (const field of ["creator", "__typename", "login", "databaseId"]) {
      assert(
        query.includes(field),
        `timeout discovery must request the status creator ${field} field`,
      );
    }
  });

  it("continues bounded discovery beyond 500 open pull requests", async () => {
    const pages = Array.from({ length: 11 }, (_, pageIndex) =>
      Array.from({ length: 50 }, (_, itemIndex) => {
        const pullNumber = pageIndex * 50 + itemIndex + 1;
        return timeoutPull(
          pullNumber,
          pullNumber === 550 ? "2026-08-25T08:00:00Z" : undefined,
        );
      })
    );
    const github = timeoutDiscoveryFixture(pages);

    assertEquals(
      await findTimedOutAutomatedReviews({
        github,
        owner: "veryfront",
        repo: "veryfront-code",
        now: Date.parse("2026-08-25T08:30:00Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      [{ pullNumber: 550, headSha: HEAD }],
    );
  });

  it("fails visibly instead of silently truncating beyond 1,000 pulls", async () => {
    const pages = Array.from({ length: 21 }, (_, pageIndex) =>
      Array.from({ length: 50 }, (_, itemIndex) =>
        timeoutPull(pageIndex * 50 + itemIndex + 1, undefined)
      )
    );
    const github = timeoutDiscoveryFixture(pages);

    await assertRejects(
      () =>
        findTimedOutAutomatedReviews({
          github,
          owner: "veryfront",
          repo: "veryfront-code",
          now: Date.parse("2026-08-25T08:30:00Z"),
          reviewTimeoutMs: 1_800_000,
        }),
      Error,
      "exceeded 1,000 open pull requests",
    );
  });

  it("revalidates and expires the same pending status under the publisher", async () => {
    const retryTimeoutStatus = automatedReviewStatus({
      id: 1001,
      state: "failure",
      description: "PR#1 automated review timed out; queue retry pending",
    });
    const fixture = githubFixture({
      pages: {
        refs: [[]],
      },
      pageResponses: {
        statuses: [
          [[pendingAutomatedReviewStatus()]],
          [[pendingAutomatedReviewStatus()]],
          [[retryTimeoutStatus]],
          [[retryTimeoutStatus]],
        ],
      },
      commit: HEAD,
    });
    const result = await expireTimedOutAutomatedReview({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      now: Date.parse("2026-08-25T08:30:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.expired, true);
    assert("state" in result);
    assertEquals(result.state, "failure");
    assert(fixture.published.length > 0);
    assertEquals(
      fixture.published.every((status) => status.state === "failure"),
      true,
    );
    assertEquals(
      fixture.published.at(-1)?.description,
      "PR#1 automated review timed out",
      "queue propagation must preserve the terminal source diagnosis",
    );
  });

  it("retries queue propagation after a terminal timeout failure", async () => {
    const retryDescription =
      "PR#1 automated review timed out; queue retry pending";
    const retryStatus = automatedReviewStatus({
      id: 1001,
      state: "failure",
      description: retryDescription,
      target_url: "https://example.test/pr/1",
    });
    const firstAttempt = githubFixture({
      pageResponses: {
        statuses: [
          [[pendingAutomatedReviewStatus()]],
          [[pendingAutomatedReviewStatus()]],
          [[retryStatus]],
        ],
      },
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      commit: HEAD,
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
      queueRefError: Object.assign(new Error("queue ref unavailable"), {
        status: 503,
      }),
    });

    await assertRejects(
      () =>
        expireTimedOutAutomatedReview({
          github: firstAttempt.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          now: Date.parse("2026-08-25T08:30:00Z"),
          reviewTimeoutMs: 1_800_000,
        }),
      Error,
      "queue ref unavailable",
    );
    assertEquals(firstAttempt.published[0]?.description, retryDescription);

    const discovery = timeoutDiscoveryFixture([[
      timeoutPull(
        1,
        "2026-08-25T08:30:00Z",
        {},
        "FAILURE",
        {
          __typename: "Bot",
          login: "github-actions",
          databaseId: GITHUB_ACTIONS_ID,
        },
        retryDescription,
      ),
    ]]);
    assertEquals(
      await findTimedOutAutomatedReviews({
        github: discovery,
        owner: "veryfront",
        repo: "veryfront-code",
        now: Date.parse("2026-08-25T08:30:01Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      [{ pullNumber: 1, headSha: HEAD }],
    );

    const repaired = githubFixture({
      pages: {
        comments: [[codexComment()]],
        refs: [[]],
      },
      pageResponses: {
        statuses: [
          [[retryStatus]],
          [[retryStatus]],
        ],
      },
      commit: HEAD,
    });
    const repairedResult = await expireTimedOutAutomatedReview({
      github: repaired.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      now: Date.parse("2026-08-25T08:30:01Z"),
      reviewTimeoutMs: 1_800_000,
    });
    assertEquals(repairedResult.expired, false);
    assertEquals(repairedResult.reason, "reviewed");
    assert("state" in repairedResult);
    assertEquals(repairedResult.state, "success");
    assertEquals(repaired.published[0]?.state, "success");

    const retry = githubFixture({
      pageResponses: {
        statuses: [
          [[retryStatus]],
          [[retryStatus]],
          [[retryStatus]],
          [[retryStatus]],
        ],
      },
      pages: { refs: [[]] },
      commit: HEAD,
      statusIds: [1002],
    });
    const result = await expireTimedOutAutomatedReview({
      github: retry.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      now: Date.parse("2026-08-25T08:30:01Z"),
      reviewTimeoutMs: 1_800_000,
    });
    assertEquals(result.expired, true);
    assert("retried" in result);
    assert("statusId" in result);
    assertEquals(result.retried, true);
    assertEquals(result.statusId, 1002);
    assertEquals(
      retry.published[0]?.description,
      "PR#1 automated review timed out",
    );

    const unavailableRetryStatus = automatedReviewStatus({
      id: 1001,
      state: "failure",
      description: "PR#1 review status unavailable; queue retry pending",
      target_url: "https://example.test/pr/1",
    });
    const revalidationOutage = githubFixture({
      pageResponses: {
        statuses: [
          [[retryStatus]],
          [[], []],
          [[unavailableRetryStatus]],
          [[unavailableRetryStatus]],
        ],
      },
      pages: { refs: [[]] },
      failAfterFirstPage: "statuses",
      commit: HEAD,
      statusIds: [1001, 1002],
    });
    const outageResult = await expireTimedOutAutomatedReview({
      github: revalidationOutage.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      now: Date.parse("2026-08-25T08:30:01Z"),
      reviewTimeoutMs: 1_800_000,
    });
    assert("state" in outageResult);
    assertEquals(outageResult.state, "failure");
    assertEquals(
      revalidationOutage.published[0]?.description,
      "PR#1 review status unavailable; epoch:9f2e6d33a371; queue retry pending",
    );

    const queueOutage = githubFixture({
      pages: {
        comments: [[codexComment()]],
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      pageResponses: {
        statuses: [
          [[retryStatus]],
          [[retryStatus]],
        ],
      },
      commit: HEAD,
      statusIds: [1001, 1002],
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
    });
    await assertRejects(
      () =>
        expireTimedOutAutomatedReview({
          github: queueOutage.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          now: Date.parse("2026-08-25T08:30:01Z"),
          reviewTimeoutMs: 1_800_000,
        }),
      Error,
      "queue binding unavailable",
    );
    assertEquals(queueOutage.published[0]?.state, "success");
    assertEquals(
      queueOutage.published.at(-1)?.description,
      retryDescription,
    );

    const publishedQueueFailure = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      pageResponses: {
        statuses: [
          [[retryStatus]],
          [[retryStatus]],
          [[pendingAutomatedReviewStatus()]],
        ],
      },
      statusIds: [1001, 1002, 1003],
    });
    await assertRejects(
      () =>
        expireTimedOutAutomatedReview({
          github: publishedQueueFailure.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          now: Date.parse("2026-08-25T08:30:01Z"),
          reviewTimeoutMs: 1_800_000,
        }),
      Error,
      "active merge queue review failed",
    );
    assertEquals(publishedQueueFailure.published[0]?.state, "success");
    assertEquals(publishedQueueFailure.published[1]?.sha, OTHER_HEAD);
    assertEquals(publishedQueueFailure.published[1]?.state, "failure");
    assertEquals(
      publishedQueueFailure.published.at(-1)?.description,
      retryDescription,
    );
  });

  it("reconciles an unavailable failure without a pending anchor", async () => {
    const unavailableStatus = automatedReviewStatus({
      id: 106,
      state: "failure",
      description: "PR#1 review status unavailable",
    });
    const fixture = githubFixture({
      pageResponses: {
        statuses: [
          [[unavailableStatus]],
          [[unavailableStatus]],
        ],
      },
      pages: {
        comments: [[{
          user: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
          body: `<!-- automated-review-request: ${HEAD} -->\n@codex review`,
        }]],
        events: [[{
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        refs: [[]],
      },
    });
    const result = await expireTimedOutAutomatedReview({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      now: Date.parse("2026-08-25T08:30:01Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.expired, false);
    assertEquals(result.reason, "revalidated");
    assert("state" in result);
    assertEquals(result.state, "pending");
    assertEquals(fixture.published[0]?.state, "pending");
    assertEquals(
      fixture.commentsPosted[0]?.body,
      `<!-- automated-review-request: ${HEAD} base-42 -->\n@codex review`,
    );

    const runReset = automatedReviewResetStatus(
      "2026-08-25T08:00:00Z",
      {
        id: 100,
        description: `PR#1 reset base:${
          reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
        } key:base-run-9001-at-1787644800000-event-42`,
      },
    );
    const runRecovery = githubFixture({
      pageResponses: {
        statuses: [
          [[unavailableStatus, runReset]],
          [[unavailableStatus, runReset]],
        ],
      },
      pages: {
        comments: [[{
          user: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
          body: `<!-- automated-review-request: ${HEAD} base-42 -->\n@codex review`,
        }]],
        events: [[{
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        refs: [[]],
      },
    });
    const runRecoveryResult = await expireTimedOutAutomatedReview({
      github: runRecovery.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      now: Date.parse("2026-08-25T08:05:00Z"),
      reviewTimeoutMs: 1_800_000,
    });
    assertEquals(runRecoveryResult.reason, "revalidated");
    assertEquals(
      runRecovery.commentsPosted[0]?.body,
      `<!-- automated-review-request: ${HEAD} base-run-9001-at-1787644800000-event-42 -->\n@codex review`,
    );

    const queueOutage = githubFixture({
      pageResponses: {
        statuses: [
          [[unavailableStatus]],
          [[unavailableStatus]],
        ],
      },
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
      statusIds: [1001, 1002],
    });
    await assertRejects(
      () =>
        expireTimedOutAutomatedReview({
          github: queueOutage.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          now: Date.parse("2026-08-25T08:30:01Z"),
          reviewTimeoutMs: 1_800_000,
        }),
      Error,
      "queue binding unavailable",
    );
    assertEquals(queueOutage.published[0]?.state, "pending");
    assertEquals(
      queueOutage.published.at(-1)?.description,
      "PR#1 review status unavailable; epoch:9f2e6d33a371; queue retry pending",
    );

    const requestOutage = githubFixture({
      pageResponses: {
        statuses: [
          [[unavailableStatus]],
          [[unavailableStatus]],
        ],
      },
      pages: { refs: [[]] },
      commentError: new Error("request comment unavailable"),
      statusIds: [1001, 1002],
    });
    await assertRejects(
      () =>
        expireTimedOutAutomatedReview({
          github: requestOutage.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          now: Date.parse("2026-08-25T08:30:01Z"),
          reviewTimeoutMs: 1_800_000,
        }),
      Error,
      "request comment unavailable",
    );
    assertEquals(requestOutage.published[0]?.state, "pending");
    assertEquals(
      requestOutage.published.at(-1)?.description,
      "PR#1 review status unavailable; epoch:9f2e6d33a371; queue retry pending",
    );
  });

  it("marks a propagated unavailable retry as finalized", async () => {
    const retryStatus = automatedReviewStatus({
      id: 1001,
      state: "failure",
      description:
        "PR#1 review status unavailable; epoch:9f2e6d33a371; queue retry pending",
      target_url: "https://example.test/pr/1",
      created_at: "2026-08-25T08:00:00Z",
    });
    const fixture = githubFixture({
      pages: {
        statuses: [[retryStatus]],
        refs: [[]],
      },
      commit: HEAD,
      statusIds: [1002],
    });
    const result = await completeReviewFailurePropagation({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      sourceStatusId: 1001,
      description: retryStatus.description,
      targetUrl: retryStatus.target_url,
    });

    assertEquals(result.finalized, true);
    assertEquals(
      fixture.published.at(-1)?.description,
      "PR#1 review status unavailable; retry finalized",
    );
  });

  it("does not finalize a retry after a newer lifecycle epoch", async () => {
    const retryStatus = automatedReviewStatus({
      id: 1001,
      state: "failure",
      description: "PR#1 automated review timed out; queue retry pending",
      target_url: "https://example.test/pr/1",
      created_at: "2026-08-25T08:00:00Z",
    });
    const fixture = githubFixture({
      pageResponses: {
        statuses: [
          [[retryStatus]],
          [[retryStatus]],
        ],
      },
      pages: {
        comments: [[]],
        events: [[{
          event: "base_ref_changed",
          id: 102,
          created_at: "2026-08-25T09:00:00Z",
        }]],
        refs: [[]],
        timeline: [[]],
      },
      commit: HEAD,
    });

    const result = await completeReviewFailurePropagation({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      sourceStatusId: 1001,
      description: retryStatus.description,
      targetUrl: retryStatus.target_url,
    });
    assertEquals(result.finalized, false);
    assertEquals(result.statusId, 1001);
    assertEquals(fixture.published, []);
  });

  it("publishes review proof that arrives before timeout revalidation", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment()]],
        statuses: [[pendingAutomatedReviewStatus()]],
        refs: [[]],
      },
      commit: HEAD,
    });
    const result = await expireTimedOutAutomatedReview({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      now: Date.parse("2026-08-25T08:30:00Z"),
      reviewTimeoutMs: 1_800_000,
    });

    assertEquals(result.expired, false);
    assertEquals(result.reason, "reviewed");
    assert("state" in result);
    assertEquals(result.state, "success");
    assertEquals(fixture.published[0]?.state, "success");
  });

  it("does not overwrite a later status or a changed head", async () => {
    const laterStatus = automatedReviewStatus({ id: 101 });
    const changedStatusFixture = githubFixture({
      pages: { statuses: [[laterStatus]] },
    });
    assertEquals(
      await expireTimedOutAutomatedReview({
        github: changedStatusFixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        now: Date.parse("2026-08-25T08:30:00Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      { expired: false, reason: "status-changed" },
    );
    assertEquals(changedStatusFixture.published, []);

    const changedHeadFixture = githubFixture({ headResponses: [OTHER_HEAD] });
    assertEquals(
      await expireTimedOutAutomatedReview({
        github: changedHeadFixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        now: Date.parse("2026-08-25T08:30:00Z"),
        reviewTimeoutMs: 1_800_000,
      }),
      { expired: false, reason: "stale-head" },
    );
    assertEquals(changedHeadFixture.published, []);
  });
});

describe("merge queue review propagation", () => {
  it("extracts only a fully qualified merge-queue pull request ref", () => {
    assertEquals(
      parseMergeQueuePullNumber(
        `refs/heads/gh-readonly-queue/main/pr-4135-${OTHER_HEAD}`,
      ),
      { pullNumber: 4135, baseHeadSha: OTHER_HEAD },
    );
    for (
      const ref of [
        `refs/heads/main/pr-4135-${OTHER_HEAD}`,
        "refs/heads/gh-readonly-queue/main/pr-0-deadbeef",
        `refs/heads/gh-readonly-queue/main/pr-4135-${OTHER_HEAD}extra`,
        `refs/heads/gh-readonly-queue/main/not-pr-4135-${OTHER_HEAD}`,
        "",
      ]
    ) assertEquals(parseMergeQueuePullNumber(ref), undefined);
  });

  it("preserves only a pinned success published after the captured boundary", () => {
    const later = {
      id: 101,
      context: "Automated review",
      state: "success",
      creator: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
      description: "Reused exact-head review for PR #1",
    };
    const shouldPreserve = (status: Record<string, unknown>, boundary = 100) =>
      shouldPreserveLaterMergeGroupSuccess({
        latestStatus: status,
        reconciliationStatusId: boundary,
        pullNumber: 1,
      });

    assertEquals(shouldPreserve(later), true);
    assertEquals(shouldPreserve({ ...later, id: 100 }), false);
    assertEquals(
      shouldPreserve({ ...later, id: 99 }),
      true,
      "the API's reverse-chronological order, not numeric ID order, proves recency",
    );
    assertEquals(shouldPreserve({ ...later, state: "failure" }), false);
    assertEquals(
      shouldPreserve({
        ...later,
        creator: bot("github-actions[bot]", GITHUB_ACTIONS_ID + 1),
      }),
      false,
    );
    assertEquals(
      shouldPreserve({
        ...later,
        description: "Reused exact-head review for PR #2",
      }),
      false,
    );
  });

  it("uses the boundary captured by the publisher that failed", () => {
    const boundary = (targetResult: string, publisherStatusId?: number) =>
      selectMergeGroupFailureStatusBoundary({
        targetResult,
        targetStatusId: 100,
        publisherStatusId,
      });
    const success = {
      id: 101,
      context: "Automated review",
      state: "success",
      creator: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
      description: "Reused exact-head review for PR #1",
    };

    assertEquals(boundary("failure", undefined), 100);
    assertEquals(boundary("success", 101), 101);
    assertEquals(
      boundary("success", undefined),
      100,
      "a publisher without an output falls back to the resolver boundary",
    );
    assertEquals(
      shouldPreserveLaterMergeGroupSuccess({
        latestStatus: success,
        reconciliationStatusId: boundary("success", 101),
        pullNumber: 1,
      }),
      false,
      "a success published before the locked publisher starts is not later",
    );
    assertEquals(
      shouldPreserveLaterMergeGroupSuccess({
        latestStatus: success,
        reconciliationStatusId: boundary("success", undefined),
        pullNumber: 1,
      }),
      true,
      "a newer success survives when the older publisher produced no boundary",
    );
    assertEquals(
      shouldPreserveLaterMergeGroupSuccess({
        latestStatus: { ...success, id: 102 },
        reconciliationStatusId: boundary("success", 101),
        pullNumber: 1,
      }),
      true,
      "a success published after the locked publisher starts is preserved",
    );
  });

  it("fails every exact queue ref still owned by the current source", async () => {
    const secondQueueHead = BASE_HEAD;
    const fixture = githubFixture({
      commit: HEAD,
      pages: {
        refs: [[
          {
            ref: `refs/heads/gh-readonly-queue/main/pr-1-${BASE_HEAD}`,
            object: { sha: OTHER_HEAD },
          },
          {
            ref: `refs/heads/gh-readonly-queue/release/pr-1-${OTHER_HEAD}`,
            object: { sha: secondQueueHead },
          },
          {
            ref: `refs/heads/gh-readonly-queue/main/pr-2-${BASE_HEAD}`,
            object: { sha: secondQueueHead },
          },
        ]],
      },
      pullError: new Error("pull lookup unavailable"),
      queueRefHeads: [OTHER_HEAD, secondQueueHead],
    });
    const result = await publishReviewResolutionFailure({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
    });
    assertEquals(result.queueFailures, 2);
    assertEquals(
      fixture.published.map((status) => [status.sha, status.state]),
      [
        [HEAD, "failure"],
        [OTHER_HEAD, "failure"],
        [secondQueueHead, "failure"],
      ],
    );
  });

  it("reuses the current exact-head Codex gate on the synthetic queue SHA", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        statuses: [[automatedReviewStatus()]],
      },
      headResponses: [HEAD, HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "success");
    assertEquals(fixture.published, [{
      owner: "veryfront",
      repo: "veryfront-code",
      sha: OTHER_HEAD,
      state: "success",
      context: "Automated review",
      description: "Reused exact-head review for PR #1",
      target_url: "https://example.test/review-proof",
    }]);
    assertEquals(fixture.refReads, [
      {
        owner: "veryfront",
        repo: "veryfront-code",
        ref: `heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
      },
      {
        owner: "veryfront",
        repo: "veryfront-code",
        ref: `heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
      },
    ]);
    assertEquals(
      fixture.graphqlReads.map(({ variables }) => variables),
      [
        { owner: "veryfront", repo: "veryfront-code", number: 1 },
        { owner: "veryfront", repo: "veryfront-code", number: 1 },
      ],
    );
    assert(
      fixture.graphqlReads.every(({ query }) =>
        typeof query === "string" &&
        query.includes("query ActiveMergeQueueBinding") &&
        query.includes("mergeQueueEntry")
      ),
      "binding checks must use the expected GraphQL operation and fields",
    );
  });

  it("fails closed when the live merge-queue binding does not match", async () => {
    const staleBindings = [
      ["source", activeQueueBinding({ headRefOid: OTHER_HEAD })],
      [
        "base",
        activeQueueBinding({
          mergeQueueEntry: {
            state: "AWAITING_CHECKS",
            baseCommit: { oid: HEAD },
            headCommit: { oid: OTHER_HEAD },
          },
        }),
      ],
      [
        "synthetic head",
        activeQueueBinding({
          mergeQueueEntry: {
            state: "AWAITING_CHECKS",
            baseCommit: { oid: BASE_HEAD },
            headCommit: { oid: HEAD },
          },
        }),
      ],
      ["missing entry", activeQueueBinding({ mergeQueueEntry: null })],
    ] as const;
    for (const [label, binding] of staleBindings) {
      const fixture = githubFixture({
        pages: {
          reviews: [[review({ state: "APPROVED" })]],
          statuses: [[automatedReviewStatus()]],
        },
        queueBindings: [binding],
      });
      const result = await publishMergeGroupReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        sourceHeadSha: HEAD,
        baseHeadSha: BASE_HEAD,
        mergeGroupSha: OTHER_HEAD,
      });
      assertEquals(result.state, "failure", label);
      assertEquals(
        fixture.published,
        [],
        `${label}: an unbound synthetic commit must not receive a status`,
      );
    }

    const replacedRef = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        statuses: [[automatedReviewStatus()]],
      },
      queueRefHeads: [HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: replacedRef.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "failure");
    assertEquals(replacedRef.published, []);
  });

  it("rechecks the live merge-queue binding before publishing success", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        statuses: [[automatedReviewStatus()]],
      },
      queueBindings: [
        activeQueueBinding(),
        activeQueueBinding({ headRefOid: OTHER_HEAD }),
      ],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "failure");
    assertEquals(fixture.published, []);
  });

  it("does not reuse proof that predates a base-ref issue event", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          id: 101,
          created_at: "2026-08-25T08:00:00Z",
        })]],
        events: [[
          {
            event: "base_ref_changed",
            id: 102,
            created_at: "2026-08-25T08:00:01Z",
          },
        ]],
        statuses: [[automatedReviewStatus()]],
        timeline: [[{ event: "commented", id: 101 }]],
      },
      commit: HEAD,
      headResponses: [HEAD, HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });

    assertEquals(result.state, "failure");
    assertEquals(fixture.published[0]?.sha, OTHER_HEAD);
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("reuses proof after the base event even when the reset status landed later", async () => {
    const fixture = githubFixture({
      pages: {
        comments: [[codexComment(HEAD.slice(0, 10), {
          id: 103,
          created_at: "2026-08-25T08:00:01Z",
        })]],
        events: [[{
          event: "base_ref_changed",
          id: 102,
          created_at: "2026-08-25T08:00:00Z",
        }]],
        statuses: [[
          automatedReviewStatus(),
          automatedReviewResetStatus("2026-08-25T08:00:02Z"),
        ]],
        timeline: [[{ event: "commented", id: 103 }]],
      },
      commit: HEAD,
      headResponses: [HEAD, HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "success");
    assertEquals(fixture.published[0]?.sha, OTHER_HEAD);
    assertEquals(fixture.published[0]?.state, "success");
  });

  it("does not reuse a source review status from another pull request", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        statuses: [[automatedReviewStatus()]],
      },
      queueBindings: [activeQueueBinding({ number: 2 })],
      pullResponses: [
        associatedPull({ number: 2 }),
        associatedPull({ number: 2 }),
      ],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 2,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "failure");
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("selects the latest source status owned by the queued pull request", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        statuses: [[
          automatedReviewStatus({
            state: "pending",
            description: `PR#2 reset base:${
              reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
            }`,
          }),
          automatedReviewStatus(),
        ]],
      },
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "success");
    assertEquals(fixture.published[0]?.state, "success");
  });

  it("fails closed for stale, superseded, spoofed, or missing source proof", async () => {
    const cases = [
      { statuses: [] },
      { statuses: [automatedReviewStatus({ state: "pending" })] },
      {
        statuses: [
          automatedReviewStatus({ state: "pending" }),
          automatedReviewStatus(),
        ],
      },
      {
        statuses: [automatedReviewStatus({
          creator: bot("github-actions[bot]", GITHUB_ACTIONS_ID + 1),
        })],
      },
      {
        statuses: [automatedReviewStatus({
          description: `PR#1 base:${
            reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
          } by:coderabbitai[bot]`,
        })],
      },
      {
        statuses: [automatedReviewStatus({
          description: `PR#1 base:${
            reviewBaseBinding(BASE_REPOSITORY_ID, OTHER_BASE_REF)
          } by:chatgpt-codex-connector[bot]`,
        })],
      },
    ];
    for (const candidate of cases) {
      const fixture = githubFixture({
        pages: {
          reviews: [[review({ state: "APPROVED" })]],
          statuses: [[...candidate.statuses]],
        },
        headResponses: [HEAD, HEAD],
      });
      const result = await publishMergeGroupReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        sourceHeadSha: HEAD,
        baseHeadSha: BASE_HEAD,
        mergeGroupSha: OTHER_HEAD,
      });
      assertEquals(result.state, "failure");
      assertEquals(fixture.published[0]?.sha, OTHER_HEAD);
      assertEquals(fixture.published[0]?.state, "failure");
    }

    const drift = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        statuses: [[automatedReviewStatus()]],
      },
      headResponses: [HEAD, OTHER_HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: drift.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "failure");

    const sourceDrift = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        statuses: [[automatedReviewStatus()]],
      },
      headResponses: [OTHER_HEAD],
    });
    const sourceDriftResult = await publishMergeGroupReviewStatus({
      github: sourceDrift.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(sourceDriftResult.state, "failure");
  });

  it("revokes a copied queue status when source review proof is revoked", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({ state: "APPROVED" })]],
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
        statuses: [[automatedReviewStatus({ state: "pending" })]],
      },
      headResponses: [HEAD, HEAD],
    });
    const results = await reconcileActiveMergeGroupReviewStatuses({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseRef: BASE_REF,
    });
    assertEquals(results.length, 1);
    assertEquals(results[0]?.state, "failure");
    assertEquals(fixture.published[0]?.sha, OTHER_HEAD);
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("surfaces an unpublished queue failure to the workflow", async () => {
    const fixture = githubFixture({
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
    });

    await assertRejects(
      () =>
        reconcileActiveMergeGroupReviewStatuses({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          sourceHeadSha: HEAD,
          baseRef: BASE_REF,
        }),
      Error,
      "queue binding unavailable",
    );
    assertEquals(
      fixture.published,
      [],
      "the workflow fallback must handle a failure that could not be published safely",
    );
  });

  it("fails closed when a queue failure cannot reach a live entry", async () => {
    const fixture = githubFixture({
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
        statuses: [[automatedReviewStatus({ state: "pending" })]],
      },
      headResponses: [HEAD, HEAD],
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
    });
    await assertRejects(
      () =>
        reconcileActiveMergeGroupReviewStatuses({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          sourceHeadSha: HEAD,
          baseRef: BASE_REF,
        }),
      Error,
      "Review proof was not replaced on 1 active merge queue commit",
    );
    assertEquals(fixture.published, []);
  });

  it("skips an unverifiable entry whose ref no longer targets it", async () => {
    const fixture = githubFixture({
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
        statuses: [[automatedReviewStatus({ state: "pending" })]],
      },
      headResponses: [HEAD, HEAD],
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
      queueRefHeads: [NEW_HEAD],
    });
    const results = await reconcileActiveMergeGroupReviewStatuses({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseRef: BASE_REF,
    });
    assertEquals(results, []);
    assertEquals(fixture.published, []);
  });

  it("propagates an operational ref lookup during the unpublished recheck", async () => {
    const fixture = githubFixture({
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
        statuses: [[automatedReviewStatus({ state: "pending" })]],
      },
      headResponses: [HEAD, HEAD],
      queueBindingError: Object.assign(
        new Error("queue binding unavailable"),
        { status: 503 },
      ),
      queueRefError: Object.assign(new Error("queue ref unavailable"), {
        status: 503,
      }),
    });
    await assertRejects(
      () =>
        reconcileActiveMergeGroupReviewStatuses({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          sourceHeadSha: HEAD,
          baseRef: BASE_REF,
        }),
      Error,
      "queue ref unavailable",
    );
    assertEquals(fixture.published, []);
  });

  it("rechecks source proof immediately before publishing queue success", async () => {
    const fixture = githubFixture({
      pageResponses: {
        statuses: [
          [[automatedReviewStatus()]],
          [[automatedReviewStatus({ state: "pending" })]],
        ],
      },
      pages: { reviews: [[review({ state: "APPROVED" })]] },
      headResponses: [HEAD, HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "failure");
    assertEquals(fixture.published, [{
      owner: "veryfront",
      repo: "veryfront-code",
      sha: OTHER_HEAD,
      state: "failure",
      context: "Automated review",
      description: "Could not reuse an exact-head review",
      target_url: "https://example.test/pr/1",
    }]);
  });

  it("does not reuse cached success after live review evidence is revoked", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[review({
          state: "COMMENTED",
          body: "P1: This exact-head review has an actionable finding.",
        })]],
        statuses: [[automatedReviewStatus()]],
      },
      headResponses: [HEAD, HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "failure");
    assertEquals(fixture.published[0]?.sha, OTHER_HEAD);
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("revalidates a human reviewer's trust before queue reuse", async () => {
    const description = `PR#1 base:${
      reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
    } by:trusted-maintainer`;
    for (
      const candidate of [
        { permission: "read", pullAuthor: "pull-author", state: "failure" },
        {
          permission: "write",
          pullAuthor: "trusted-maintainer",
          state: "failure",
        },
        { permission: "write", pullAuthor: "pull-author", state: "success" },
      ]
    ) {
      const fixture = githubFixture({
        pages: {
          reviews: [[review({
            user: { login: "trusted-maintainer", id: 7, type: "User" },
            state: "APPROVED",
          })]],
          statuses: [[automatedReviewStatus({ description })]],
        },
        permission: candidate.permission,
        pullAuthor: candidate.pullAuthor,
      });
      const result = await publishMergeGroupReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        sourceHeadSha: HEAD,
        baseHeadSha: BASE_HEAD,
        mergeGroupSha: OTHER_HEAD,
      });
      assertEquals(result.state, candidate.state);
      assertEquals(fixture.published[0]?.state, candidate.state);
    }
  });
});

function requestFixture(options: {
  comments?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  eventResponses?: Record<string, unknown>[][];
  reviews?: Record<string, unknown>[];
  statuses?: Record<string, unknown>[];
  timeline?: Record<string, unknown>[];
  currentHead?: string;
  headResponses?: string[];
  updatedAtResponses?: string[];
  currentState?: string;
  draft?: boolean;
} = {}) {
  const posted: Record<string, unknown>[] = [];
  const state = {
    comments: options.comments ?? [],
    events: options.events ?? [],
    reviews: options.reviews ?? [],
    statuses: options.statuses ?? [],
    timeline: options.timeline ?? [],
    currentHead: options.currentHead ?? HEAD,
    currentState: options.currentState ?? "open",
    draft: options.draft ?? false,
  };
  const listComments = () => undefined;
  const listEvents = () => undefined;
  const listReviews = () => undefined;
  const listStatuses = () => undefined;
  const listTimeline = () => undefined;
  let eventRead = 0;
  let pullRead = 0;
  let updatedAtRead = 0;
  const github = {
    paginate: {
      async *iterator(endpoint: unknown) {
        if (endpoint === listComments) yield { data: state.comments };
        else if (endpoint === listEvents) {
          const events = options.eventResponses?.[
            Math.min(eventRead++, options.eventResponses.length - 1)
          ] ?? state.events;
          yield { data: events };
        } else if (endpoint === listReviews) yield { data: state.reviews };
        else if (endpoint === listStatuses) yield { data: state.statuses };
        else if (endpoint === listTimeline) yield { data: state.timeline };
        else throw new Error("unknown endpoint");
      },
    },
    rest: {
      issues: {
        listComments,
        listEvents,
        listEventsForTimeline: listTimeline,
        createComment: (comment: Record<string, unknown>) => {
          posted.push(comment);
          return Promise.resolve();
        },
      },
      pulls: {
        listReviews,
        get: () =>
          Promise.resolve({
            data: {
              head: {
                sha: options.headResponses?.[
                  Math.min(pullRead++, options.headResponses.length - 1)
                ] ?? state.currentHead,
              },
              base: { ref: BASE_REF, repo: { id: BASE_REPOSITORY_ID } },
              user: { login: "pull-author" },
              state: state.currentState,
              draft: state.draft,
              updated_at: options.updatedAtResponses?.[
                Math.min(
                  updatedAtRead++,
                  options.updatedAtResponses.length - 1,
                )
              ] ?? "2026-08-25T08:00:00Z",
            },
          }),
      },
      repos: {
        listCommitStatusesForRef: listStatuses,
        getCommit: () => Promise.resolve({ data: { sha: HEAD } }),
      },
    },
  };
  return { github, posted, state };
}

describe("automated review request", () => {
  it("requests an automated review at most once per head commit", async () => {
    const fixture = requestFixture();
    const request = (headSha: string) =>
      requestAutomatedReview({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha,
      });

    const first = await request(HEAD);
    assertEquals(first.requested, true);
    assertEquals(fixture.posted, [{
      owner: "veryfront",
      repo: "veryfront-code",
      issue_number: 1,
      body: `<!-- automated-review-request: ${HEAD} -->\n@codex review`,
    }]);

    // A participant pasting the marker text must not suppress the request:
    // only a workflow-authored marker comment counts, pinned by login and
    // account type the way the gate pins the Codex bot.
    fixture.state.comments.push(
      {
        user: { login: "maintainer", type: "User" },
        body: fixture.posted[0]?.body,
      },
      {
        user: { login: "github-actions[bot]", type: "User" },
        body: fixture.posted[0]?.body,
      },
      { body: fixture.posted[0]?.body },
    );
    const impersonated = await request(HEAD);
    assertEquals(impersonated.requested, true);
    assertEquals(fixture.posted.length, 2);

    // A rerun for the same head finds the workflow-authored marker and does
    // not post again.
    fixture.state.comments.push({
      user: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
      body: fixture.posted[0]?.body,
    });
    const second = await request(HEAD);
    assertEquals(second.requested, false);
    assertEquals(fixture.posted.length, 2);

    // A new head commit carries a new marker and gets its own request.
    fixture.state.currentHead = OTHER_HEAD;
    const third = await request(OTHER_HEAD);
    assertEquals(third.requested, true);
    assertEquals(
      fixture.posted[2]?.body,
      `<!-- automated-review-request: ${OTHER_HEAD} -->\n@codex review`,
    );
  });

  it("does not post from a stale queued synchronize event", async () => {
    const fixture = requestFixture({ currentHead: OTHER_HEAD });
    const result = await requestAutomatedReview({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
    });
    assertEquals(result.requested, false);
    assertEquals(result.reason, "stale-head");
    assertEquals(fixture.posted.length, 0);
  });

  it("does not request after exact-head proof arrives", async () => {
    const fixture = requestFixture({
      reviews: [review({ state: "APPROVED" })],
    });
    const result = await requestAutomatedReview({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      revalidateReviewEvidence: true,
    });
    assertEquals(result.requested, false);
    assertEquals(result.reason, "reviewed");
    assertEquals(fixture.posted, []);

    const changedHead = requestFixture({ headResponses: [HEAD, OTHER_HEAD] });
    const changedHeadResult = await requestAutomatedReview({
      github: changedHead.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      revalidateReviewEvidence: true,
    });
    assertEquals(changedHeadResult.requested, false);
    assertEquals(changedHeadResult.reason, "stale-head");
    assertEquals(changedHead.posted, []);

    const changedEpoch = requestFixture({
      eventResponses: [
        [{
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        }],
        [{
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        }],
        [
          {
            event: "base_ref_changed",
            id: 42,
            created_at: "2026-08-25T09:00:00Z",
          },
          {
            event: "reopened",
            id: 43,
            created_at: "2026-08-25T10:00:00Z",
          },
        ],
      ],
    });
    const changedEpochResult = await requestAutomatedReview({
      github: changedEpoch.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "base-42",
      validateRequestEpoch: true,
      revalidateReviewEvidence: true,
    });
    assertEquals(changedEpochResult.requested, false);
    assertEquals(changedEpochResult.reason, "stale-epoch");
    assertEquals(changedEpoch.posted, []);
  });

  it("honors a run-bound reset during the final proof refresh", async () => {
    const fixture = requestFixture({
      comments: [codexComment(HEAD.slice(0, 10), {
        id: 103,
        created_at: "2026-08-25T09:00:00Z",
        updated_at: "2026-08-25T09:00:00Z",
      })],
      events: [{
        event: "ready_for_review",
        id: 41,
        created_at: "2026-08-25T08:00:00Z",
      }],
      statuses: [automatedReviewResetStatus("2026-08-25T10:00:00Z", {
        id: 104,
        description: `PR#1 reset base:${
          reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
        } key:ready-run-9001-at-1787644800000-event-41`,
      })],
    });
    const result = await requestAutomatedReview({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "ready-run-9001-at-1787644800000-event-41",
      reviewEpochNotAfter: "2026-08-25T08:00:00Z",
      validateRequestEpoch: true,
      revalidateReviewEvidence: true,
    });

    assertEquals(result.requested, true);
    assertEquals(
      fixture.posted[0]?.body,
      `<!-- automated-review-request: ${HEAD} ready-run-9001-at-1787644800000-event-41 -->\n@codex review`,
    );
  });

  it("rejects a lifecycle request when the final pull snapshot advances", async () => {
    const fixture = requestFixture({
      events: [{
        event: "base_ref_changed",
        id: 42,
        created_at: "2026-08-25T08:00:00Z",
      }],
      updatedAtResponses: [
        "2026-08-25T08:00:00Z",
        "2026-08-25T09:00:00Z",
      ],
    });
    const result = await requestAutomatedReview({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "base-42",
      validateRequestEpoch: true,
      revalidateReviewEvidence: true,
    });

    assertEquals(result.requested, false);
    assertEquals(result.reason, "stale-epoch");
    assertEquals(fixture.posted, []);
  });

  it("does not post when the pull request is closed or draft", async () => {
    for (
      const fixture of [
        requestFixture({ currentState: "closed" }),
        requestFixture({ draft: true }),
      ]
    ) {
      const result = await requestAutomatedReview({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        requestKey: "reopen-42",
      });
      assertEquals(result.requested, false);
      assertEquals(result.reason, "ineligible-pull");
      assertEquals(fixture.posted, []);
    }
  });

  it("uses an idempotent base-edit request key to create a fresh epoch", async () => {
    const fixture = requestFixture();
    const request = () =>
      requestAutomatedReview({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        requestKey: "base-42",
      });
    const first = await request();
    assertEquals(first.requested, true);
    assertEquals(
      fixture.posted[0]?.body,
      `<!-- automated-review-request: ${HEAD} base-42 -->\n@codex review`,
    );
    fixture.state.comments.push({
      user: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
      body: fixture.posted[0]?.body,
    });
    assertEquals((await request()).requested, false);
  });

  it("coalesces reopen requests on the latest durable epoch", async () => {
    const fixture = requestFixture({
      events: [
        {
          event: "reopened",
          id: 41,
          created_at: "2026-08-25T08:00:00Z",
        },
        {
          event: "reopened",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        },
      ],
    });
    const request = () =>
      requestAutomatedReview({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha: HEAD,
        requestKey: "reopen",
      });

    assertEquals((await request()).requested, true);
    assertEquals(
      fixture.posted[0]?.body,
      `<!-- automated-review-request: ${HEAD} reopen-42 -->\n@codex review`,
    );
    fixture.state.comments.push({
      user: bot("github-actions[bot]", GITHUB_ACTIONS_ID),
      body: fixture.posted[0]?.body,
    });
    assertEquals((await request()).requested, false);
    assertEquals(fixture.posted.length, 1);

    const superseded = requestFixture({
      events: [
        {
          event: "reopened",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        },
        {
          event: "ready_for_review",
          id: 43,
          created_at: "2026-08-25T10:00:00Z",
        },
      ],
    });
    const supersededResult = await requestAutomatedReview({
      github: superseded.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "reopen",
    });
    assertEquals(supersededResult.requested, false);
    assertEquals(supersededResult.reason, "stale-epoch");
    assertEquals(superseded.posted, []);

    const supersededBase = requestFixture({
      events: [
        {
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        },
        {
          event: "reopened",
          id: 43,
          created_at: "2026-08-25T10:00:00Z",
        },
      ],
    });
    const supersededBaseResult = await requestAutomatedReview({
      github: supersededBase.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "base",
    });
    assertEquals(supersededBaseResult.requested, false);
    assertEquals(supersededBaseResult.reason, "stale-epoch");
    assertEquals(supersededBase.posted, []);

    const notVisible = requestFixture({
      events: [{
        event: "reopened",
        id: 41,
        created_at: "2026-08-25T08:00:00Z",
      }],
    });
    await assertRejects(
      () =>
        requestAutomatedReview({
          github: notVisible.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          requestKey: "reopen",
          reviewEpochNotBefore: "2026-08-25T09:00:00Z",
        }),
      Error,
      "current review epoch event is not visible",
    );
    assertEquals(notVisible.posted, []);

    const staleConcrete = requestFixture({
      events: [
        {
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        },
        {
          event: "reopened",
          id: 43,
          created_at: "2026-08-25T10:00:00Z",
        },
      ],
    });
    const staleConcreteResult = await requestAutomatedReview({
      github: staleConcrete.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "base-42",
      validateRequestEpoch: true,
    });
    assertEquals(staleConcreteResult.requested, false);
    assertEquals(staleConcreteResult.reason, "stale-epoch");
    assertEquals(staleConcrete.posted, []);

    const changedDuringRequest = requestFixture({
      eventResponses: [
        [{
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T09:00:00Z",
        }],
        [
          {
            event: "base_ref_changed",
            id: 42,
            created_at: "2026-08-25T09:00:00Z",
          },
          {
            event: "reopened",
            id: 43,
            created_at: "2026-08-25T10:00:00Z",
          },
        ],
      ],
    });
    const changedResult = await requestAutomatedReview({
      github: changedDuringRequest.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "base-42",
      validateRequestEpoch: true,
    });
    assertEquals(changedResult.requested, false);
    assertEquals(changedResult.reason, "stale-epoch");
    assertEquals(changedDuringRequest.posted, []);

    const tiedOtherKind = requestFixture({
      events: [{
        event: "ready_for_review",
        id: 44,
        created_at: "2026-08-25T11:00:00Z",
      }],
    });
    await assertRejects(
      () =>
        requestAutomatedReview({
          github: tiedOtherKind.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
          headSha: HEAD,
          requestKey: "base",
          reviewEpochNotBefore: "2026-08-25T11:00:00Z",
          reviewEpochRunKey: "9001",
        }),
      Error,
      "current review epoch event is not visible",
    );
    assertEquals(tiedOtherKind.posted, []);

    const staleRunBound = requestFixture({
      eventResponses: [
        [{
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T08:00:00Z",
        }],
        [
          {
            event: "base_ref_changed",
            id: 42,
            created_at: "2026-08-25T08:00:00Z",
          },
          {
            event: "reopened",
            id: 43,
            created_at: "2026-08-25T10:00:00Z",
          },
        ],
      ],
    });
    const staleRunResult = await requestAutomatedReview({
      github: staleRunBound.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "base-run-9001-at-1787644800000-event-42",
      validateRequestEpoch: true,
      reviewEpochNotAfter: "2026-08-25T08:00:00Z",
    });
    assertEquals(staleRunResult.requested, false);
    assertEquals(staleRunResult.reason, "stale-epoch");
    assertEquals(staleRunBound.posted, []);

    const tiedRunBound = requestFixture({
      events: [
        {
          event: "base_ref_changed",
          id: 42,
          created_at: "2026-08-25T08:00:00Z",
        },
        {
          event: "base_ref_changed",
          id: 43,
          created_at: "2026-08-25T08:00:00Z",
        },
      ],
    });
    const tiedRunResult = await requestAutomatedReview({
      github: tiedRunBound.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      requestKey: "base-run-9001-at-1787644800000-event-42",
      validateRequestEpoch: true,
      reviewEpochNotAfter: "2026-08-25T08:00:00Z",
    });
    assertEquals(tiedRunResult.requested, false);
    assertEquals(tiedRunResult.reason, "stale-epoch");
    assertEquals(tiedRunBound.posted, []);
  });

  it("refuses to request a review of a malformed head commit", async () => {
    const fixture = requestFixture();
    for (
      const malformed of [
        HEAD.slice(0, 39),
        `${HEAD} --><script>`,
        "@codex review",
      ]
    ) {
      await assertRejects(
        () =>
          requestAutomatedReview({
            github: fixture.github,
            owner: "veryfront",
            repo: "veryfront-code",
            pullNumber: 1,
            headSha: malformed,
          }),
        Error,
        "malformed head commit",
      );
    }
    assertEquals(fixture.posted.length, 0);
  });

  it("refuses malformed base-edit request keys", async () => {
    const fixture = requestFixture();
    for (const requestKey of ["", "base_42", "base-42 -->"]) {
      await assertRejects(
        () =>
          requestAutomatedReview({
            github: fixture.github,
            owner: "veryfront",
            repo: "veryfront-code",
            pullNumber: 1,
            headSha: HEAD,
            requestKey,
          }),
        Error,
        "malformed review request key",
      );
    }
    assertEquals(fixture.posted.length, 0);
  });
});

describe("review proof invalidation", () => {
  it("invalidates this run's source success after an unreplaced queue result", async () => {
    const fixture = githubFixture({
      commit: HEAD,
      headResponses: [HEAD],
      pages: {
        statuses: [[automatedReviewStatus({ id: 101 })]],
        refs: [[]],
      },
    });
    const result = await invalidateReviewProof({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
    });

    assertEquals(result.skipped, false);
    assertEquals(fixture.published[0]?.sha, HEAD);
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("does not overwrite a same-second success published after reconciliation began", async () => {
    const fixture = githubFixture({
      headResponses: [HEAD],
      pages: {
        statuses: [[automatedReviewStatus({
          id: 101,
          created_at: "2026-08-25T08:00:00Z",
        })]],
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
    });
    const result = await invalidateReviewProof({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      reconciliationStatusId: 100,
    });

    assertEquals(result.skipped, true);
    assertEquals(result.queueFailures, 0);
    assertEquals(
      fixture.published,
      [],
      "an older fallback must not replace a newer exact-head success",
    );
  });

  it("invalidates a same-second success that existed when reconciliation began", async () => {
    const fixture = githubFixture({
      commit: HEAD,
      headResponses: [HEAD],
      pages: {
        statuses: [[automatedReviewStatus({
          id: 100,
          created_at: "2026-08-25T08:00:00Z",
        })]],
        refs: [[]],
      },
    });
    const result = await invalidateReviewProof({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      reconciliationStatusId: 100,
    });

    assertEquals(result.skipped, false);
    assertEquals(fixture.published[0]?.state, "failure");
  });

  it("preserves a queue-retry marker during fallback invalidation", async () => {
    const retryStatus = automatedReviewStatus({
      id: 105,
      state: "failure",
      description: "PR#1 automated review rate limited; queue retry pending",
      target_url: "https://example.test/rate-limit",
    });
    const fixture = githubFixture({
      commit: HEAD,
      headResponses: [HEAD],
      pageResponses: {
        statuses: [
          [[retryStatus]],
          [[retryStatus]],
        ],
      },
      pages: { refs: [[]] },
    });
    const result = await invalidateReviewProof({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      reconciliationStatusId: 105,
    });

    assertEquals(result.skipped, false);
    assertEquals(result.queueFailures, 0);
    assertEquals(fixture.published, []);
  });

  it("closes source and queued gates a dropped reconciliation left behind", async () => {
    const fixture = githubFixture({
      commit: HEAD,
      headResponses: [HEAD],
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${BASE_HEAD}`,
          object: { sha: OTHER_HEAD },
        }]],
      },
    });
    const result = await invalidateReviewProof({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
    });
    assertEquals(
      result.headSha,
      HEAD,
      "invalidation must target the pull request head it just read",
    );
    assertEquals(result.queueFailures, 1);
    assertEquals(
      fixture.published,
      [
        {
          owner: "veryfront",
          repo: "veryfront-code",
          sha: HEAD,
          state: "failure",
          context: "Automated review",
          description: "PR#1 review status unavailable",
          target_url: "https://example.test/pr/1",
        },
        {
          owner: "veryfront",
          repo: "veryfront-code",
          sha: OTHER_HEAD,
          state: "failure",
          context: "Automated review",
          description: "Could not revalidate review for PR #1",
          target_url: "https://example.test/pr/1",
        },
      ],
      "a lost revocation must fail both source and active queued proof",
    );
  });

  it("does not let a stale invalidator close a newer pull request head", async () => {
    const fixture = githubFixture({ headResponses: [OTHER_HEAD] });
    const result = await invalidateReviewProof({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      expectedHeadSha: HEAD,
    });

    assertEquals(result.skipped, true);
    assertEquals(result.headSha, HEAD);
    assertEquals(
      fixture.published,
      [],
      "an old reconciliation must not write a failure onto the new head",
    );
  });

  it("keeps a merge group from reusing an invalidated source status", async () => {
    // listCommitStatusesForRef returns newest first, so the invalidation is
    // the current gate status and the earlier success is no longer reusable.
    const fixture = githubFixture({
      pages: {
        statuses: [[
          automatedReviewStatus({
            state: "failure",
            description: "PR#1 review status unavailable",
          }),
          automatedReviewStatus(),
        ]],
      },
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      baseHeadSha: BASE_HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(
      result.state,
      "failure",
      "an invalidated source gate must not be reusable by the merge queue",
    );
    assertEquals(
      fixture.published[0]?.state,
      "failure",
      "the merge group commit must carry the refusal",
    );
  });

  it("refuses to invalidate without a resolvable pull request head", async () => {
    for (const pullNumber of [0, -1, 1.5, Number.NaN]) {
      const fixture = githubFixture();
      await assertRejects(
        () =>
          invalidateReviewProof({
            github: fixture.github,
            owner: "veryfront",
            repo: "veryfront-code",
            pullNumber,
          }),
        Error,
        "Pull request number is invalid",
      );
      assertEquals(
        fixture.published.length,
        0,
        "an unidentified pull request must not have any status written for it",
      );
    }

    const malformed = githubFixture({ headResponses: ["not-a-sha"] });
    await assertRejects(
      () =>
        invalidateReviewProof({
          github: malformed.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
        }),
      Error,
      "Could not resolve the pull request head commit",
    );
    assertEquals(
      malformed.published.length,
      0,
      "a malformed head must not receive a status on an arbitrary ref",
    );
  });

  it("propagates the lookup failure instead of reporting a closed gate", async () => {
    const fixture = githubFixture({
      pullError: Object.assign(new Error("pull request unavailable"), {
        status: 500,
      }),
    });
    await assertRejects(
      () =>
        invalidateReviewProof({
          github: fixture.github,
          owner: "veryfront",
          repo: "veryfront-code",
          pullNumber: 1,
        }),
      Error,
      "pull request unavailable",
    );
    assertEquals(
      fixture.published.length,
      0,
      "an unreadable pull request must fail the job, not fake an invalidation",
    );
  });
});

describe("review wakeup identity", () => {
  const wakeupRun = (overrides: Record<string, unknown> = {}) => ({
    id: 42,
    path: ".github/workflows/automated-review-wakeup.yml@main",
    event: "pull_request_review",
    conclusion: "success",
    display_title: "automated-review-wakeup-pr-123-eligible",
    head_branch: "contributor-branch",
    head_sha: HEAD,
    head_repository: { id: 77 },
    ...overrides,
  });
  const pullRequest = (overrides: Record<string, unknown> = {}) => ({
    number: 123,
    state: "open",
    head: {
      ref: "contributor-branch",
      sha: HEAD,
      repo: { id: 77 },
    },
    base: { ref: "main", repo: { id: 88 } },
    ...overrides,
  });
  const repository = { id: 88, default_branch: "main" };

  it("parses only trusted eligible wakeup metadata", () => {
    assertEquals(parseReviewWakeupRun(wakeupRun()), {
      pullNumber: 123,
      headBranch: "contributor-branch",
      headSha: HEAD,
      headRepositoryId: 77,
    });
    for (const conclusion of ["failure", "cancelled"]) {
      assertEquals(parseReviewWakeupRun(wakeupRun({ conclusion })), {
        pullNumber: 123,
        headBranch: "contributor-branch",
        headSha: HEAD,
        headRepositoryId: 77,
      });
    }
    for (
      const candidate of [
        wakeupRun({ path: ".github/workflows/untrusted.yml@main" }),
        wakeupRun({ path: 42 }),
        wakeupRun({ event: "pull_request" }),
        wakeupRun({ id: 0 }),
        wakeupRun({ display_title: "automated-review-wakeup-pr-0-eligible" }),
        wakeupRun({ display_title: "automated-review-wakeup-pr-123" }),
        wakeupRun({ display_title: "automated-review-wakeup-pr-123-ignored" }),
        wakeupRun({
          display_title: "automated-review-wakeup-pr-123-eligible-extra",
        }),
        wakeupRun({ display_title: 123 }),
        wakeupRun({ head_repository: undefined }),
        wakeupRun({ head_branch: "" }),
        wakeupRun({ head_sha: OTHER_HEAD.slice(0, 39) }),
      ]
    ) {
      assertEquals(parseReviewWakeupRun(candidate), undefined);
    }
  });

  it("binds the title PR number to GitHub-owned head and base metadata", () => {
    const signal = parseReviewWakeupRun(wakeupRun());
    assert(signal);
    assert(matchesReviewWakeupPullRequest(signal, pullRequest(), repository));
    assert(
      matchesReviewWakeupPullRequest(
        signal,
        pullRequest({ base: { ref: "release", repo: { id: 88 } } }),
        repository,
      ),
    );
    for (
      const candidate of [
        pullRequest({ number: 2 }),
        pullRequest({ state: "closed" }),
        pullRequest({
          head: {
            ref: "other-branch",
            sha: HEAD,
            repo: { id: 77 },
          },
        }),
        pullRequest({
          head: {
            ref: "contributor-branch",
            sha: 123,
            repo: { id: 77 },
          },
        }),
        pullRequest({
          head: {
            ref: "contributor-branch",
            sha: HEAD,
            repo: { id: 78 },
          },
        }),
        pullRequest({ base: { ref: "", repo: { id: 88 } } }),
        pullRequest({ base: { ref: "main", repo: { id: 89 } } }),
      ]
    ) {
      assert(
        !matchesReviewWakeupPullRequest(signal, candidate, repository),
      );
    }
  });

  it("accepts a synthetic wakeup SHA for the current source branch", () => {
    const signal = parseReviewWakeupRun(
      wakeupRun({ head_sha: OTHER_HEAD }),
    );
    assert(signal);
    assert(matchesReviewWakeupPullRequest(signal, pullRequest(), repository));
  });
});

describe("automated review workflow", () => {
  it("uses the tested gate from the trusted default branch", async () => {
    const workflowText = await Deno.readTextFile(WORKFLOW_PATH);
    const workflow = record(
      parse(workflowText),
      "workflow",
    );
    assert(
      !workflowText.includes("actions/checkout@"),
      "a privileged workflow must not check out pull request repository contents",
    );
    const assertTrustedGateLoad = (script: string) => {
      for (
        const required of [
          "github.rest.repos.getContent",
          "scripts/ci/automated-review-gate.mjs",
          "context.payload.repository.default_branch",
          'encoding !== "base64"',
          "data:text/javascript;base64",
        ]
      ) {
        assert(
          script.includes(required),
          "gate code must load through the API from the base repository default branch",
        );
      }
    };
    assertEquals(record(workflow.permissions, "permissions"), {});

    assertEquals(workflow.concurrency, undefined);

    const triggers = record(workflow.on, "triggers");
    assertEquals(
      record(triggers.pull_request_target, "pull request trigger").types,
      [
        "opened",
        "synchronize",
        "reopened",
        "ready_for_review",
        "converted_to_draft",
        "edited",
      ],
    );
    assertEquals(
      record(triggers.issue_comment, "issue comment trigger").types,
      ["created", "edited", "deleted"],
    );
    assertEquals(
      record(triggers.workflow_run, "review wakeup trigger"),
      {
        workflows: ["Automated review wakeup"],
        types: ["completed"],
      },
    );
    assertEquals("pull_request_review" in triggers, false);
    assertEquals(
      record(triggers.merge_group, "merge group trigger").types,
      ["checks_requested"],
    );
    assertEquals(
      triggers.schedule,
      [{ cron: "*/10 * * * *" }],
      "the timeout watchdog must revisit silent pending reviews",
    );
    assertEquals("status" in triggers, false);
    const jobs = record(workflow.jobs, "jobs");
    const timeoutTargetsJob = record(
      jobs.timeout_targets,
      "timeout target discovery job",
    );
    assertEquals(timeoutTargetsJob.if, "github.event_name == 'schedule'");
    assertEquals(
      record(timeoutTargetsJob.permissions, "timeout discovery permissions"),
      {
        contents: "read",
        "pull-requests": "read",
        statuses: "read",
      },
      "timeout discovery must stay read-only",
    );
    const timeoutTargetSteps = timeoutTargetsJob.steps;
    assert(Array.isArray(timeoutTargetSteps));
    const timeoutTargetScript = String(
      record(
        record(timeoutTargetSteps[0], "timeout target discovery").with,
        "timeout target discovery inputs",
      ).script,
    );
    assertTrustedGateLoad(timeoutTargetScript);
    assert(timeoutTargetScript.includes("findTimedOutAutomatedReviews"));
    assert(timeoutTargetScript.includes("AUTOMATED_REVIEW_TIMEOUT_MS"));

    const timeoutJob = record(jobs.timeout, "timeout publisher job");
    assertEquals(timeoutJob.needs, "timeout_targets");
    assertEquals(timeoutJob.if, "needs.timeout_targets.outputs.targets != '[]'");
    assertEquals(
      record(
        record(timeoutJob.strategy, "timeout publisher strategy").matrix,
        "timeout publisher matrix",
      ).target,
      "${{ fromJSON(needs.timeout_targets.outputs.targets) }}",
    );
    assertEquals(
      record(timeoutJob.permissions, "timeout publisher permissions"),
      {
        contents: "read",
        "pull-requests": "write",
        statuses: "write",
      },
    );
    assertEquals(
      record(timeoutJob.concurrency, "timeout publisher concurrency"),
      {
        group: "automated-review-pr-${{ matrix.target.pullNumber }}",
        queue: "max",
      },
      "timeout publication must serialize with normal per-pull publication",
    );
    const timeoutSteps = timeoutJob.steps;
    assert(Array.isArray(timeoutSteps));
    const timeoutScript = String(
      record(
        record(timeoutSteps[0], "timeout publisher").with,
        "timeout publisher inputs",
      ).script,
    );
    assertTrustedGateLoad(timeoutScript);
    assert(timeoutScript.includes("expireTimedOutAutomatedReview"));
    assert(timeoutScript.includes("AUTOMATED_REVIEW_TIMEOUT_MS"));
    const targetJob = record(jobs.target, "target job");
    const targetIf = String(targetJob.if);
    for (
      const condition of [
        "github.event_name != 'schedule'",
        "github.event_name == 'merge_group'",
        "github.event.issue.pull_request",
        "github.event.comment.user.login == 'chatgpt-codex-connector[bot]'",
        "github.event.comment.user.id == 199175422",
        "github.event.comment.user.type == 'Bot'",
        "github.event.workflow_run.event == 'pull_request_review'",
        "endsWith(github.event.workflow_run.display_title, '-eligible')",
      ]
    ) {
      assert(
        targetIf.includes(condition),
        "target resolution must skip events that no publisher job can use",
      );
    }
    assert(
      !targetIf.includes("github.event.workflow_run.conclusion"),
      "review wakeup eligibility must come from the classified wakeup run-name",
    );
    assert(
      !targetIf.includes("github.event.workflow_run.conclusion == 'success'"),
      "failed or cancelled review wakeups must reach trusted invalidation",
    );
    assert(
      !targetIf.includes("github.event.workflow_run.actor"),
      "downstream reconciliation must trust the classified wakeup result, not the dismissal actor",
    );
    assertEquals(record(targetJob.permissions, "target permissions"), {
      contents: "read",
      "pull-requests": "read",
      statuses: "read",
    });
    assertEquals(
      record(targetJob.outputs, "target outputs").key,
      "${{ steps.resolve.outputs.key }}",
    );
    assertEquals(
      record(targetJob.outputs, "target outputs").head_sha,
      "${{ steps.resolve.outputs.head-sha }}",
    );
    assertEquals(
      record(targetJob.outputs, "target outputs").pull_number,
      "${{ steps.resolve.outputs.pull-number }}",
    );
    assertEquals(
      record(targetJob.outputs, "target outputs").status_id,
      "${{ steps.resolve.outputs.status-id }}",
    );
    assertEquals(
      record(targetJob.outputs, "target outputs").merge_group_status_id,
      "${{ steps.resolve.outputs.merge-group-status-id }}",
    );
    const targetSteps = targetJob.steps;
    assert(Array.isArray(targetSteps));
    const targetScript = String(
      record(
        record(targetSteps[0], "target resolver").with,
        "target resolver inputs",
      )
        .script,
    );
    assert(
      !targetScript.includes("automated-review-gate.mjs") &&
        !targetScript.includes("getContent") &&
        !targetScript.includes("import("),
      "target resolution must survive a missing or malformed gate module",
    );
    for (
      const required of [
        "context.payload.pull_request?.number",
        "context.payload.issue?.pull_request",
        'context.eventName === "workflow_run"',
        "Number.isSafeInteger",
        'core.setOutput("key"',
        'core.setOutput("head-sha"',
        'core.setOutput("pull-number"',
        'core.setOutput("status-id"',
        '"merge-group-status-id"',
        "github.rest.git.getRef",
        "fallbackResponse = await github.rest.pulls.get",
        "context.payload.pull_request?.head?.sha",
        "Could not resolve a valid review target commit",
        "context.payload.merge_group?.base_sha",
        "queueEntry.baseHeadSha",
      ]
    ) assert(targetScript.includes(required));
    assert(
      targetScript.includes('core.setOutput("key", `pr-${pullNumber}`)'),
      "all publishers for one pull request must share a lock across force-pushes",
    );
    const earlyMergeGroupLock =
      'core.setOutput("key", `pr-${queueEntry.pullNumber}`)';
    assert(
      targetScript.includes(earlyMergeGroupLock) &&
        targetScript.indexOf(earlyMergeGroupLock) <
          targetScript.indexOf("Merge queue base does not match"),
      "a parsed merge group must publish its per-pull lock before later resolver failures",
    );
    assert(
      targetScript.indexOf('"merge-group-status-id"') <
        targetScript.indexOf("Merge queue base does not match"),
      "the emergency publisher boundary must be captured before later target work",
    );
    assert(
      !targetScript.includes("if (!headSha)"),
      "the resolver must not wrap its unconditional head lookup in a dead guard",
    );
    assert(
      !targetScript.includes("let headSha = queueEntry?.sourceHeadSha"),
      "the queue ref suffix is the base commit, not the source pull request head",
    );
    assert(
      targetScript.replaceAll(/\s+/g, " ").includes(
        'context.eventName === "workflow_run" && workflowRun?.conclusion !== "success"',
      ),
      "merge-group target resolution must not require a workflow-run conclusion",
    );
    assert(
      !targetScript.includes("createCommitStatus"),
      "read-only target resolution must not receive status authority",
    );
    assert(
      !targetScript.includes("pull_request?.head.sha"),
      "queued pull request events must resolve the current head before choosing a lock",
    );
    assert(
      !targetScript.includes("workflow_run?.head_sha"),
      "a review wakeup merge SHA must not be mistaken for the pull request head",
    );
    assert(
      !targetScript.includes("workflow_run?.pull_requests"),
      "fork wakeups must not depend on workflow_run.pull_requests, which GitHub can leave empty",
    );
    assert(
      !targetScript.includes("workflowRun?.name"),
      "a dynamic run-name must not be mistaken for the stable workflow identity",
    );

    const mergeGroupFailureJob = record(
      jobs.merge_group_target_failure,
      "merge group target failure job",
    );
    assertEquals(
      mergeGroupFailureJob.needs,
      ["target", "merge_group"],
      "the module-independent fallback must observe resolver and publisher failures",
    );
    const mergeGroupFailureIf = String(mergeGroupFailureJob.if);
    assert(mergeGroupFailureIf.includes("always()"));
    assert(mergeGroupFailureIf.includes("github.event_name == 'merge_group'"));
    assert(mergeGroupFailureIf.includes("needs.target.result != 'success'"));
    assert(
      mergeGroupFailureIf.includes("needs.merge_group.result != 'success'"),
      "a failed merge-group publisher must still close the synthetic commit gate",
    );
    assertEquals(
      record(
        mergeGroupFailureJob.permissions,
        "merge group target failure permissions",
      ),
      { contents: "read", statuses: "write" },
    );
    assertEquals(record(mergeGroupFailureJob.env, "merge group failure env"), {
      TARGET_RESULT: "${{ needs.target.result }}",
      TARGET_STATUS_ID: "${{ needs.target.outputs.merge_group_status_id }}",
      PUBLISHER_STATUS_ID: "${{ needs.merge_group.outputs.status_id }}",
    });
    assertEquals(
      record(
        mergeGroupFailureJob.concurrency,
        "merge group target failure concurrency",
      ),
      {
        group:
          "automated-review-${{ needs.target.outputs.key || format('merge-group-{0}', github.event.merge_group.head_ref) }}",
        queue: "max",
      },
      "the emergency publisher must serialize with the normal per-pull publisher",
    );
    const mergeGroupFailureSteps = mergeGroupFailureJob.steps;
    assert(Array.isArray(mergeGroupFailureSteps));
    const mergeGroupFailureScript = String(
      record(
        record(mergeGroupFailureSteps[0], "merge group target failure").with,
        "merge group target failure inputs",
      ).script,
    );
    for (
      const required of [
        "context.payload.merge_group?.head_sha",
        "context.payload.merge_group?.head_ref",
        "github.rest.repos.listCommitStatusesForRef",
        "process.env.TARGET_RESULT",
        "process.env.TARGET_STATUS_ID",
        "process.env.PUBLISHER_STATUS_ID",
        "selectMergeGroupFailureStatusBoundary",
        "reconciliationStatusId",
        "latestStatus",
        "shouldPreserveLaterMergeGroupSuccess",
        "latestStatus.id !== reconciliationStatusId",
        "automated-review-gate.mjs",
        "latestStatus?.creator?.login",
        "latestStatus?.creator?.id",
        '"github-actions[bot]"',
        "41898282",
        "`Reused exact-head review for PR #${pullNumber}`",
        "github.rest.repos.createCommitStatus",
        'context: "Automated review"',
        'state: "failure"',
      ]
    ) {
      assert(
        mergeGroupFailureScript.includes(required),
        "a merge-group resolver failure must close the gate on the synthetic commit",
      );
    }
    assert(
      mergeGroupFailureScript.indexOf(
        "shouldPreserveLaterMergeGroupSuccess",
      ) < mergeGroupFailureScript.indexOf("createCommitStatus"),
      "an older emergency publisher must preserve a success written after its status boundary",
    );

    const job = record(jobs.review, "review job");
    assertEquals(record(job.permissions, "review permissions"), {
      contents: "read",
      issues: "write",
      "pull-requests": "write",
      statuses: "write",
    });
    const publisherConcurrency = {
      group: "automated-review-${{ needs.target.outputs.key }}",
      queue: "max",
    };
    assertEquals(job.needs, "target");
    assertEquals(record(job.outputs, "review outputs"), {
      force_invalidate: "${{ steps.publish.outputs.force-invalidate }}",
      source_status_id: "${{ steps.publish.outputs.source-status-id }}",
    });
    assertEquals(record(job.concurrency, "review concurrency"), {
      ...publisherConcurrency,
    });
    assert(
      !String(job.if).includes("CodeRabbit"),
      "CodeRabbit must not be able to enter Codex review reconciliation",
    );
    assertEquals(job.if, "github.event_name != 'merge_group'");
    const steps = job.steps;
    assert(Array.isArray(steps));
    const gate = record(steps[0], "gate");
    const script = String(record(gate.with, "gate inputs").script);
    assertTrustedGateLoad(script);
    assertEquals(
      record(gate.env, "gate environment").TARGET_SHA,
      "${{ needs.target.outputs.head_sha }}",
    );
    assertEquals(
      record(gate.env, "gate environment").PULL_NUMBER,
      "${{ needs.target.outputs.pull_number }}",
    );
    assert(script.includes("publishAutomatedReviewStatus"));
    assert(script.includes("publishReviewResolutionFailure"));
    assert(script.includes("completeReviewFailurePropagation"));
    assert(script.includes("publishReviewPropagationRetryStatus"));
    assert(
      script.includes("reviewRequestKey: result.reviewRequestKey"),
      "normal-workflow retry markers must retain their originating review epoch",
    );
    assert(script.includes("queuePropagationPending: true"));
    assert(
      script.includes("reviewEpochNotBefore") &&
        script.includes("context.payload.pull_request?.updated_at") &&
        script.includes("reviewEpochRunKey: String(context.runId)"),
      "lifecycle publishers must wait for the triggering durable event",
    );
    assert(script.includes("sourceStatusId: result.statusId"));
    assert(script.includes("reconcileActiveMergeGroupReviewStatuses"));
    assert(!script.includes("github.rest.pulls.get"));
    assert(script.includes("process.env.TARGET_SHA"));
    assert(script.includes("process.env.PULL_NUMBER"));
    assert(script.includes("Number.isSafeInteger"));
    assert(script.includes("result.baseRef"));
    assert(
      script.includes('entry?.state === "failure"') &&
        !script.includes('entry?.published !== true') &&
        script.includes("active merge queue review failed"),
      "every merge queue failure must keep the source retryable",
    );
    assert(
      script.includes('core.setOutput("force-invalidate", "true")'),
      "an unreplaced queue failure must tell fallback invalidation to ignore this run's source success",
    );
    assert(
      script.includes('core.setOutput("source-status-id"') &&
        script.includes("retryStatus.statusId"),
      "fallback invalidation must receive the source status written by this failed run",
    );
    assert(
      script.includes(
        'result.state === "success"',
      ) &&
        script.includes(
          "Automated review success did not return a source status identity.",
        ),
      "a source success without an identity must not be treated as usable review proof",
    );
    assert(
      script.includes("forceInvalidateCurrentSource") &&
        script.includes(
          "Cannot force invalidation without the source status identity.",
        ),
      "forced invalidation must require the exact source status boundary",
    );
    assert(!script.includes("listPullRequestsAssociatedWithCommit"));
    assert(!script.includes("allowPullRequestReviews"));
    assert(
      script.includes("reviewFailureCommentId") &&
        script.includes("context.payload.comment?.id"),
      "the pinned triggering comment id must cover a limit reply that beats pending publication",
    );
    assert(
      !script.includes("context.payload.comment?.body"),
      "comment content must reconcile from current API evidence, not payload data",
    );
    assert(script.includes("Review gate is unavailable on the default branch"));
    assertEquals(
      gate.id,
      "publish",
      "the request step reads the published state from this step's output",
    );
    assertEquals(
      record(gate.with, "gate inputs")["result-encoding"],
      "string",
      "the published state must land in the step output as a plain string",
    );

    const request = record(steps[1], "request step");
    const requestCondition = String(request.if);
    for (
      const guard of [
        "github.event_name == 'pull_request_target'",
        "github.event.pull_request.draft == false",
        "github.event.action == 'synchronize'",
        "github.event.action == 'reopened'",
        "github.event.action == 'ready_for_review'",
        "github.event.action == 'edited'",
        "github.event.changes.base",
        "steps.publish.outputs.result == 'pending'",
      ]
    ) {
      assert(
        requestCondition.includes(guard),
        "a review request is posted only for a trusted non-draft push that left the status pending",
      );
    }
    assert(
      !requestCondition.includes("github.event.action == 'opened'"),
      "open events are already handled by the connector",
    );
    assert(
      requestCondition.includes(
        "steps.publish.outputs.explicit-ready-request == 'true'",
      ),
      "ready events must request explicitly only when an ambiguous reset needs replacement proof",
    );
    const requestScript = String(
      record(request.with, "request inputs").script,
    );
    assertTrustedGateLoad(requestScript);
    assert(
      requestScript.includes("requestAutomatedReview"),
      "the workflow must post review requests through the tested gate helper",
    );
    assert(requestScript.includes("requestKey"));
    assert(
      requestScript.includes("reviewEpochNotBefore") &&
        requestScript.includes("context.payload.pull_request?.updated_at") &&
        requestScript.includes("reviewEpochRunKey: String(context.runId)"),
      "lifecycle requests must wait for the triggering durable event",
    );
    assert(
      requestScript.includes("revalidateReviewEvidence: true"),
      "request posting must recheck exact-head proof at the final boundary",
    );
    assert(
      requestScript.includes('context.payload.action === "edited"') &&
        requestScript.includes('? "base"'),
      "base-edit requests must derive their key from the durable epoch",
    );
    assert(!requestScript.includes("`base-${context.runId}`"));
    assert(
      requestScript.includes('context.payload.action === "reopened"') &&
        requestScript.includes('? "reopen"'),
      "reopened requests must derive their key from the durable epoch",
    );
    assert(!requestScript.includes("`reopen-${context.runId}`"));
    assert(
      requestScript.includes('context.payload.action === "ready_for_review"') &&
        requestScript.includes('? "ready"'),
      "ready resets must explicitly request replacement proof",
    );
    assert(
      requestScript.includes('result.reason === "ineligible-pull"'),
      "a delayed request must report that the pull request is no longer eligible",
    );
    assert(
      !("RUN_ATTEMPT" in record(request.env, "request environment")),
      "a rerun must not create a second reset epoch",
    );
    assert(script.includes("reviewResetKey"));
    assert(
      script.includes('context.payload.action === "reopened"') &&
        script.includes('? "reopen"'),
      "reopened publishers must derive their key from the durable epoch",
    );
    assert(
      script.includes('context.payload.action === "ready_for_review"') &&
        script.includes('? "ready"'),
      "ready publishers must establish a visible lifecycle epoch",
    );
    assert(
      script.includes('core.setOutput("explicit-ready-request", "true")'),
      "the publisher must expose only a run-bound ready reset to the request step",
    );
    assert(!script.includes("`reopen-${context.runId}`"));
    assert(
      script.includes('context.payload.action === "edited"') &&
        script.includes('? "base"'),
      "base-edit publishers must derive their key from the durable epoch",
    );
    assert(!script.includes("`base-${context.runId}`"));

    const invalidateJob = record(jobs.invalidate, "invalidate job");
    assertEquals(
      invalidateJob.needs,
      ["target", "review"],
      "invalidation must cover a failed resolver and a failed publisher alike",
    );
    const invalidateIf = String(invalidateJob.if);
    for (
      const guard of [
        "failure()",
        "github.event_name == 'issue_comment'",
        "github.event_name == 'workflow_run'",
        "github.event_name == 'pull_request_target'",
        "github.event.action == 'synchronize'",
        "github.event.action == 'edited'",
        "github.event.action == 'reopened'",
        "github.event.action == 'ready_for_review'",
        "github.event.changes.base",
      ]
    ) {
      assert(
        invalidateIf.includes(guard),
        "a dropped revocation event must close the gate it could not reconcile",
      );
    }
    assertEquals(
      record(invalidateJob.permissions, "invalidate permissions"),
      {
        contents: "read",
        "pull-requests": "read",
        statuses: "write",
      },
      "invalidation reads only trusted gate code plus PR, ref, and status evidence",
    );
    assertEquals(
      record(invalidateJob.concurrency, "invalidate concurrency"),
      publisherConcurrency,
      "fallback invalidation must serialize with source and queue publication",
    );
    const invalidateSteps = invalidateJob.steps;
    assert(
      Array.isArray(invalidateSteps),
      "the invalidate job must run steps of its own",
    );
    const invalidateScript = String(
      record(
        record(invalidateSteps[0], "invalidate gate").with,
        "invalidate inputs",
      ).script,
    );
    assertTrustedGateLoad(invalidateScript);
    assertEquals(
      record(invalidateJob.env, "invalidate environment"),
      {
        TARGET_SHA: "${{ needs.target.outputs.head_sha }}",
        PULL_NUMBER: "${{ needs.target.outputs.pull_number }}",
        RECONCILIATION_STATUS_ID: "${{ needs.target.outputs.status_id }}",
        SOURCE_STATUS_ID: "${{ needs.review.outputs.source_status_id }}",
        FORCE_INVALIDATE: "${{ needs.review.outputs.force_invalidate }}",
      },
    );
    for (
      const required of [
        "invalidateReviewProof",
        "reconciliationStatusId",
        "process.env.FORCE_INVALIDATE",
        "process.env.SOURCE_STATUS_ID",
        "forceInvalidate",
        "publishIndependentFailure",
        "listMatchingRefs",
        "createCommitStatus",
        "parseMergeQueuePullNumber",
        "github.graphql",
        "mergeQueueEntry",
        "baseCommit",
        "headCommit",
        "github.rest.git.getRef",
        "resolveQueueRefTarget",
        "error?.status === 404",
        "Merge queue ref response has a malformed commit",
        "Pull request head response has a malformed commit",
        "finalPull",
        'ref: "heads/gh-readonly-queue/"',
        "process.env.TARGET_SHA",
        "process.env.PULL_NUMBER",
        "Number.isSafeInteger",
        "core.setFailed",
      ]
    ) {
      assert(
        invalidateScript.includes(required),
        "the invalidator must resolve its pull request the way the resolver does",
      );
    }
    assert(
      !invalidateScript.includes("pr-${pullNumber}-${headSha}"),
      "the independent fallback must not treat the queue-ref base suffix as a source head",
    );
    assert(
      !invalidateScript.includes('forceInvalidate || statusIdText === ""'),
      "forced invalidation must not bypass later-success detection",
    );

    const mergeGroupJob = record(jobs.merge_group, "merge group job");
    assertEquals(mergeGroupJob.if, "github.event_name == 'merge_group'");
    assertEquals(mergeGroupJob.needs, "target");
    assertEquals(record(mergeGroupJob.outputs, "merge group outputs"), {
      status_id: "${{ steps.reuse.outputs.merge-group-status-id }}",
    });
    assertEquals(
      record(mergeGroupJob.permissions, "merge group permissions"),
      {
        contents: "read",
        "pull-requests": "read",
        statuses: "write",
      },
    );
    assertEquals(
      record(mergeGroupJob.concurrency, "merge group concurrency").group,
      "automated-review-${{ needs.target.outputs.key }}",
    );
    const mergeGroupSteps = mergeGroupJob.steps;
    assert(Array.isArray(mergeGroupSteps));
    const mergeGroupScript = String(
      record(
        record(mergeGroupSteps[0], "merge group gate").with,
        "merge group inputs",
      ).script,
    );
    assertTrustedGateLoad(mergeGroupScript);
    assertEquals(
      record(
        record(mergeGroupSteps[0], "merge group gate").env,
        "merge group environment",
      ).SOURCE_HEAD_SHA,
      "${{ needs.target.outputs.head_sha }}",
    );
    assert(mergeGroupScript.includes("parseMergeQueuePullNumber"));
    assert(mergeGroupScript.includes("publishMergeGroupReviewStatus"));
    assert(mergeGroupScript.includes("process.env.SOURCE_HEAD_SHA"));
    assert(mergeGroupScript.includes("process.env.PULL_NUMBER"));
    assert(mergeGroupScript.includes('"merge-group-status-id"'));
    assert(mergeGroupScript.includes("listCommitStatusesForRef"));
    assert(mergeGroupScript.includes("sourceHeadSha"));
    assert(mergeGroupScript.includes("context.payload.merge_group.head_ref"));
    assert(mergeGroupScript.includes("context.payload.merge_group.head_sha"));
    assert(mergeGroupScript.includes("context.payload.merge_group.base_sha"));
    assert(mergeGroupScript.includes("queueEntry.baseHeadSha"));
    assert(
      mergeGroupScript.indexOf("listCommitStatusesForRef") <
        mergeGroupScript.indexOf("getContent"),
      "the publisher must capture its status boundary immediately after acquiring the lock",
    );
    assert(
      !mergeGroupScript.includes("queueEntry.sourceHeadSha"),
      "the merge-group job must serialize the queue base from queueEntry.baseHeadSha only",
    );
    for (
      const required of [
        "github.graphql",
        "mergeQueueEntry",
        "baseCommit",
        "headCommit",
        "github.rest.git.getRef",
      ]
    ) {
      assert(
        mergeGroupScript.includes(required),
        "the merge-group job must bind the event to the live queue entry",
      );
    }
    assert(
      !mergeGroupScript.includes("requestAutomatedReview"),
      "merge groups must reuse source proof without rerunning Codex",
    );
  });

  it("uses an unprivileged review-event wakeup for fork-safe reconciliation", async () => {
    const workflow = record(
      parse(await Deno.readTextFile(WAKEUP_WORKFLOW_PATH)),
      "wakeup workflow",
    );
    assertEquals(workflow.name, "Automated review wakeup");
    assertEquals(
      workflow["run-name"],
      "automated-review-wakeup-pr-${{ github.event.pull_request.number }}-${{ (github.event.review.user.type == 'User' || (github.event.review.user.login == 'chatgpt-codex-connector[bot]' && github.event.review.user.id == 199175422 && github.event.review.user.type == 'Bot')) && 'eligible' || 'ignored' }}",
    );
    assertEquals(record(workflow.permissions, "wakeup permissions"), {});
    assertEquals(
      record(
        record(workflow.on, "wakeup triggers").pull_request_review,
        "review trigger",
      ).types,
      ["submitted", "dismissed"],
    );
    const jobs = record(workflow.jobs, "wakeup jobs");
    const job = record(jobs.review_event, "review event job");
    assertEquals(record(job.permissions, "review event permissions"), {});
    const jobIf = String(job.if);
    for (
      const condition of [
        "github.event.review.user.type == 'User'",
        "github.event.review.user.login == 'chatgpt-codex-connector[bot]'",
        "github.event.review.user.id == 199175422",
        "github.event.review.user.type == 'Bot'",
      ]
    ) {
      assert(
        jobIf.includes(condition),
        "the wakeup must reject review actors that cannot affect the gate",
      );
    }
    assertEquals("uses" in job, false);
    const steps = job.steps;
    assert(Array.isArray(steps));
    assertEquals(record(steps[0], "wakeup step").run, "true");
  });
});
