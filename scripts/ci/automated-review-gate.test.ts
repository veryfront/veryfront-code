import {
  assert,
  assertEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  findAutomatedReview,
  matchesReviewWakeupPullRequest,
  parseMergeQueuePullNumber,
  parseReviewWakeupRun,
  publishAutomatedReviewStatus,
  publishMergeGroupReviewStatus,
  reconcileActiveMergeGroupReviewStatuses,
  requestAutomatedReview,
  reviewBaseBinding,
} from "./automated-review-gate.mjs";

const HEAD = "a4804e5b9a0c9c45da7c4866d9eb317c878b029c";
const OTHER_HEAD = "d258d506fede01c84b61bc40488059447d755a5a";
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
    description: `Reviewed base ${
      reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
    } by chatgpt-codex-connector[bot]`,
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
    description: `Review reset for base ${
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
  return {
    user: bot("chatgpt-codex-connector[bot]", CODEX_ID),
    body: [
      "Codex Review: Didn't find any major issues. Already looking forward to the next diff.",
      `**Reviewed commit:** \`${ref}\``,
    ].join("\n\n"),
    html_url: "https://example.test/comment",
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
  failAfterFirstPage?: string;
  pullError?: Error;
  permission?: string;
  pullAuthor?: string;
} = {}) {
  const endpoints = {
    reviews: () => undefined,
    comments: () => undefined,
    statuses: () => undefined,
    refs: () => undefined,
    timeline: () => undefined,
  };
  const published: Record<string, unknown>[] = [];
  const pageReads = new Map<string, number>();
  let pullRead = 0;
  const github = {
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
              draft: false,
              user: { login: options.pullAuthor ?? "pull-author" },
            }),
          });
        },
      },
      issues: {
        listComments: endpoints.comments,
        listEventsForTimeline: endpoints.timeline,
      },
      git: { listMatchingRefs: endpoints.refs },
      repos: {
        listCommitStatusesForRef: endpoints.statuses,
        getCommit: () => Promise.resolve({ data: { sha: options.commit } }),
        getCollaboratorPermissionLevel: () =>
          Promise.resolve({
            data: {
              permission: options.permission ?? "read",
              user: { login: "trusted-maintainer" },
            },
          }),
        createCommitStatus: (value: Record<string, unknown>) => {
          published.push(value);
          return Promise.resolve({ data: value });
        },
      },
    },
  };
  return { github, published };
}

describe("automated review publication", () => {
  it("fully paginates every evidence source before publishing success", async () => {
    const fixture = githubFixture({
      pages: {
        reviews: [[], []],
        comments: [[], [codexComment()]],
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
    assertEquals(fixture.published[0]?.sha, HEAD);
    assertEquals(
      fixture.published[0]?.description,
      `Reviewed base ${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      } by chatgpt-codex-connector[bot]`,
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
      `Waiting for an automated review of ${HEAD.slice(0, 12)}`,
    );
  });

  it("fails closed on partial pagination and the 500-item cap", async () => {
    const partialPages = ["reviews", "comments", "statuses", "timeline"].map(
      (source) =>
        githubFixture({
          pages: { [source]: [[], []] },
          failAfterFirstPage: source,
        }),
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
    const fixture = githubFixture();
    const result = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
      isDraft: true,
    });
    assertEquals(result.state, "pending");
    assertEquals(fixture.published[0]?.state, "pending");
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
      forcePending: true,
    });
    assertEquals(result.state, "pending");
    assertEquals(result.review, undefined);
    assertEquals(fixture.published[0]?.state, "pending");
    assertEquals(
      fixture.published[0]?.description,
      `Review reset for base ${
        reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
      }`,
    );
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

describe("merge queue review propagation", () => {
  it("extracts only a fully qualified merge-queue pull request ref", () => {
    assertEquals(
      parseMergeQueuePullNumber(
        `refs/heads/gh-readonly-queue/main/pr-4135-${OTHER_HEAD}`,
      ),
      { pullNumber: 4135, sourceHeadSha: OTHER_HEAD },
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

  it("reuses the current exact-head Codex gate on the synthetic queue SHA", async () => {
    const fixture = githubFixture({
      pages: { statuses: [[automatedReviewStatus()]] },
      headResponses: [HEAD, HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
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
          description: `Reviewed base ${
            reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
          } by coderabbitai[bot]`,
        })],
      },
      {
        statuses: [automatedReviewStatus({
          description: `Reviewed base ${
            reviewBaseBinding(BASE_REPOSITORY_ID, OTHER_BASE_REF)
          } by chatgpt-codex-connector[bot]`,
        })],
      },
    ];
    for (const candidate of cases) {
      const fixture = githubFixture({
        pages: { statuses: [[...candidate.statuses]] },
        headResponses: [HEAD, HEAD],
      });
      const result = await publishMergeGroupReviewStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        sourceHeadSha: HEAD,
        mergeGroupSha: OTHER_HEAD,
      });
      assertEquals(result.state, "failure");
      assertEquals(fixture.published[0]?.sha, OTHER_HEAD);
      assertEquals(fixture.published[0]?.state, "failure");
    }

    const drift = githubFixture({
      pages: { statuses: [[automatedReviewStatus()]] },
      headResponses: [HEAD, OTHER_HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: drift.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(result.state, "failure");

    const sourceDrift = githubFixture({
      pages: { statuses: [[automatedReviewStatus()]] },
      headResponses: [OTHER_HEAD],
    });
    const sourceDriftResult = await publishMergeGroupReviewStatus({
      github: sourceDrift.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
      mergeGroupSha: OTHER_HEAD,
    });
    assertEquals(sourceDriftResult.state, "failure");
  });

  it("revokes a copied queue status when source review proof is revoked", async () => {
    const fixture = githubFixture({
      pages: {
        refs: [[{
          ref: `refs/heads/gh-readonly-queue/${BASE_REF}/pr-1-${HEAD}`,
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

  it("rechecks source proof immediately before publishing queue success", async () => {
    const fixture = githubFixture({
      pageResponses: {
        statuses: [
          [[automatedReviewStatus()]],
          [[automatedReviewStatus({ state: "pending" })]],
        ],
      },
      headResponses: [HEAD, HEAD],
    });
    const result = await publishMergeGroupReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      sourceHeadSha: HEAD,
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

  it("revalidates a human reviewer's trust before queue reuse", async () => {
    const description = `Reviewed base ${
      reviewBaseBinding(BASE_REPOSITORY_ID, BASE_REF)
    } by trusted-maintainer`;
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
        mergeGroupSha: OTHER_HEAD,
      });
      assertEquals(result.state, candidate.state);
      assertEquals(fixture.published[0]?.state, candidate.state);
    }
  });
});

function requestFixture(options: {
  comments?: Record<string, unknown>[];
  currentHead?: string;
} = {}) {
  const posted: Record<string, unknown>[] = [];
  const state = {
    comments: options.comments ?? [],
    currentHead: options.currentHead ?? HEAD,
  };
  const listComments = () => undefined;
  const github = {
    paginate: {
      async *iterator(endpoint: unknown) {
        if (endpoint !== listComments) throw new Error("unknown endpoint");
        yield { data: state.comments };
      },
    },
    rest: {
      issues: {
        listComments,
        createComment: (comment: Record<string, unknown>) => {
          posted.push(comment);
          return Promise.resolve();
        },
      },
      pulls: {
        get: () =>
          Promise.resolve({ data: { head: { sha: state.currentHead } } }),
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

describe("review wakeup identity", () => {
  const wakeupRun = (overrides: Record<string, unknown> = {}) => ({
    id: 42,
    path: ".github/workflows/automated-review-wakeup.yml@main",
    event: "pull_request_review",
    conclusion: "success",
    display_title: "automated-review-wakeup-pr-123",
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

  it("parses only a trusted completed wakeup run", () => {
    assertEquals(parseReviewWakeupRun(wakeupRun()), {
      pullNumber: 123,
      headBranch: "contributor-branch",
      headSha: HEAD,
      headRepositoryId: 77,
    });
    for (
      const candidate of [
        wakeupRun({ path: ".github/workflows/untrusted.yml@main" }),
        wakeupRun({ path: 42 }),
        wakeupRun({ event: "pull_request" }),
        wakeupRun({ conclusion: "failure" }),
        wakeupRun({ id: 0 }),
        wakeupRun({ display_title: "automated-review-wakeup-pr-0" }),
        wakeupRun({ display_title: "automated-review-wakeup-pr-123-extra" }),
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
            sha: OTHER_HEAD,
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
});

describe("automated review workflow", () => {
  it("uses the tested gate from the trusted default branch", async () => {
    const workflow = record(
      parse(await Deno.readTextFile(WORKFLOW_PATH)),
      "workflow",
    );
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
    assertEquals("status" in triggers, false);
    const jobs = record(workflow.jobs, "jobs");
    const targetJob = record(jobs.target, "target job");
    const targetIf = String(targetJob.if);
    for (
      const condition of [
        "github.event_name == 'merge_group'",
        "github.event.issue.pull_request",
        "github.event.workflow_run.event == 'pull_request_review'",
        "github.event.workflow_run.conclusion == 'success'",
      ]
    ) {
      assert(
        targetIf.includes(condition),
        "target resolution must skip events that no publisher job can use",
      );
    }
    assertEquals(record(targetJob.permissions, "target permissions"), {
      contents: "read",
      "pull-requests": "read",
    });
    assertEquals(
      record(targetJob.outputs, "target outputs").key,
      "${{ steps.resolve.outputs.result }}",
    );
    assertEquals(
      record(targetJob.outputs, "target outputs").pull_number,
      "${{ steps.resolve.outputs.pull-number }}",
    );
    const targetSteps = targetJob.steps;
    assert(Array.isArray(targetSteps));
    const targetCheckout = record(targetSteps[0], "target checkout");
    assertEquals(
      record(targetCheckout.with, "target checkout inputs").ref,
      "${{ github.event.repository.default_branch }}",
    );
    const targetScript = String(
      record(
        record(targetSteps[1], "target resolver").with,
        "target resolver inputs",
      )
        .script,
    );
    for (
      const required of [
        "context.payload.sha",
        "context.payload.pull_request?.number",
        "context.payload.issue?.pull_request",
        "parseReviewWakeupRun",
        "parseMergeQueuePullNumber",
        "matchesReviewWakeupPullRequest",
        'context.eventName === "workflow_run"',
        "Number.isSafeInteger",
        'core.setOutput("pull-number"',
        "github.rest.pulls.get",
        "Could not resolve a valid review target commit",
      ]
    ) assert(targetScript.includes(required));
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

    const job = record(jobs.review, "review job");
    assertEquals(record(job.permissions, "review permissions"), {
      contents: "read",
      issues: "write",
      "pull-requests": "read",
      statuses: "write",
    });
    const publisherConcurrency = {
      group: "automated-review-${{ needs.target.outputs.key }}",
      queue: "max",
    };
    assertEquals(job.needs, "target");
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
    const checkout = record(steps[0], "checkout");
    assertEquals(
      record(checkout.with, "checkout inputs").ref,
      "${{ github.event.repository.default_branch }}",
    );
    const gate = record(steps[1], "gate");
    const script = String(record(gate.with, "gate inputs").script);
    assertEquals(
      record(gate.env, "gate environment").TARGET_SHA,
      "${{ needs.target.outputs.key }}",
    );
    assertEquals(
      record(gate.env, "gate environment").PULL_NUMBER,
      "${{ needs.target.outputs.pull_number }}",
    );
    assert(script.includes("publishAutomatedReviewStatus"));
    assert(script.includes("reconcileActiveMergeGroupReviewStatuses"));
    assert(script.includes("github.rest.pulls.get"));
    assert(script.includes("process.env.TARGET_SHA"));
    assert(script.includes("process.env.PULL_NUMBER"));
    assert(script.includes("Number.isSafeInteger"));
    assert(script.includes("pullRequest.head.sha !== headSha"));
    assert(
      !script.includes("const headSha = pullRequest.head.sha"),
      "the publisher must use the same immutable SHA as its concurrency key",
    );
    assert(!script.includes("listPullRequestsAssociatedWithCommit"));
    assert(!script.includes("allowPullRequestReviews"));
    assert(
      !script.includes("context.payload.comment"),
      "deleted comments must reconcile from current API evidence, not comment payload data",
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

    const request = record(steps[2], "request step");
    const requestCondition = String(request.if);
    for (
      const guard of [
        "github.event_name == 'pull_request_target'",
        "github.event.pull_request.draft == false",
        "github.event.action == 'synchronize'",
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
      !requestCondition.includes("ready_for_review") &&
        !requestCondition.includes("opened"),
      "open and ready-for-review events are already handled by the connector",
    );
    const requestScript = String(
      record(request.with, "request inputs").script,
    );
    assert(
      requestScript.includes("requestAutomatedReview"),
      "the workflow must post review requests through the tested gate helper",
    );
    assert(requestScript.includes("requestKey"));
    assert(requestScript.includes("context.runId"));
    assert(script.includes("forcePending"));

    const mergeGroupJob = record(jobs.merge_group, "merge group job");
    assertEquals(mergeGroupJob.if, "github.event_name == 'merge_group'");
    assertEquals(mergeGroupJob.needs, "target");
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
        record(mergeGroupSteps[1], "merge group gate").with,
        "merge group inputs",
      ).script,
    );
    assert(mergeGroupScript.includes("parseMergeQueuePullNumber"));
    assert(mergeGroupScript.includes("publishMergeGroupReviewStatus"));
    assert(mergeGroupScript.includes("process.env.SOURCE_HEAD_SHA"));
    assert(mergeGroupScript.includes("process.env.PULL_NUMBER"));
    assert(mergeGroupScript.includes("sourceHeadSha"));
    assert(mergeGroupScript.includes("context.payload.merge_group.head_ref"));
    assert(mergeGroupScript.includes("context.payload.merge_group.head_sha"));
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
      "automated-review-wakeup-pr-${{ github.event.pull_request.number }}",
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
    assertEquals("uses" in job, false);
    const steps = job.steps;
    assert(Array.isArray(steps));
    assertEquals(record(steps[0], "wakeup step").run, "true");
  });
});
