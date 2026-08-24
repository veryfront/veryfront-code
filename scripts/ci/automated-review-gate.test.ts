import {
  assert,
  assertEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  findAutomatedReview,
  publishAutomatedReviewStatus,
  publishCodeRabbitCompletionStatus,
  requestAutomatedReview,
} from "./automated-review-gate.mjs";

const HEAD = "a4804e5b9a0c9c45da7c4866d9eb317c878b029c";
const OTHER_HEAD = "d258d506fede01c84b61bc40488059447d755a5a";
const CODERABBIT_ID = 136622811;
const CODEX_ID = 199175422;
const WORKFLOW_PATH = new URL(
  "../../.github/workflows/automated-review-gate.yml",
  import.meta.url,
);

const bot = (login: string, id: number) => ({ login, id, type: "Bot" });

function review(overrides: Record<string, unknown> = {}) {
  return {
    user: bot("coderabbitai[bot]", CODERABBIT_ID),
    state: "COMMENTED",
    commit_id: HEAD,
    html_url: "https://example.test/review",
    ...overrides,
  };
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    context: "CodeRabbit",
    state: "success",
    description: "Review completed",
    creator: bot("coderabbitai[bot]", CODERABBIT_ID),
    target_url: "https://example.test/status",
    ...overrides,
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

function associatedPull(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    state: "open",
    html_url: "https://example.test/pr/1",
    head: { sha: HEAD },
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
  it("replays the compact live verdicts from PRs 4012, 4024, 4025, and 4028", async () => {
    const fixtures = [
      {
        pr: 4012,
        head: HEAD,
        reviews: [],
        comments: [codexComment()],
        statuses: [status({ description: "Review rate limited" })],
        expected: "codex-comment",
      },
      {
        pr: 4024,
        head: "2bede33efd10ad0d5c40eaa1603c0cb65da7ce69",
        reviews: [],
        comments: [],
        statuses: [status()],
        expected: "coderabbit-status",
      },
      {
        pr: 4025,
        head: "666c7af8e7b9245b9449d8a5378ddcc422a6c9f9",
        reviews: [],
        comments: [codexComment("24bb89dc4f")],
        statuses: [status({ description: "Review rate limited" })],
        expected: undefined,
      },
      {
        pr: 4028,
        head: OTHER_HEAD,
        reviews: [],
        comments: [],
        statuses: [status({ description: "Review rate limited" })],
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

  it("accepts only exact-head submitted Codex reviews", async () => {
    for (const state of ["COMMENTED", "APPROVED"]) {
      assertEquals(
        (await findAutomatedReview({
          reviews: [review({
            user: bot("chatgpt-codex-connector[bot]", CODEX_ID),
            state,
          })],
          comments: [],
          statuses: [],
        }, HEAD))?.source,
        "pull-request-review",
      );
    }
  });

  it("rejects CodeRabbit reply reviews unless completion status exists", async () => {
    for (
      const body of [
        "",
        "Resolved the earlier thread.",
        "Please address this actionable issue.",
      ]
    ) {
      assertEquals(
        await findAutomatedReview({
          reviews: [review({ body })],
          comments: [],
          statuses: [],
        }, HEAD),
        undefined,
      );
      assertEquals(
        (await findAutomatedReview({
          reviews: [review({ body })],
          comments: [],
          statuses: [status()],
        }, HEAD))?.source,
        "coderabbit-status",
      );
    }
  });

  it("rejects wrong review identity, head, and non-submitted states", async () => {
    const rejected = [
      review({ user: bot("maintainer", CODERABBIT_ID) }),
      review({ user: bot("coderabbitai[bot]", CODERABBIT_ID + 1) }),
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
          statuses: [],
        }, HEAD),
        undefined,
      );
    }
  });

  it("requires the exact CodeRabbit status tuple and pinned creator", async () => {
    assertEquals(
      (await findAutomatedReview({
        reviews: [],
        comments: [],
        statuses: [status()],
      }, HEAD))?.source,
      "coderabbit-status",
    );
    for (
      const candidate of [
        status({ context: "Automated review" }),
        status({ state: "pending" }),
        status({ description: "Review rate limited" }),
        status({ description: undefined }),
        status({ creator: bot("github-actions[bot]", CODERABBIT_ID) }),
        status({ creator: bot("coderabbitai[bot]", CODERABBIT_ID + 1) }),
      ]
    ) {
      assertEquals(
        await findAutomatedReview({
          reviews: [],
          comments: [],
          statuses: [candidate],
        }, HEAD),
        undefined,
      );
    }
  });

  it("keeps exact-head CodeRabbit completion as monotonic occurrence proof", async () => {
    const retries = [
      status({ description: "Review rate limited" }),
      status({ state: "pending", description: "Review in progress" }),
      status({ state: "failure", description: "Review failed" }),
    ];
    for (const retry of retries) {
      for (const statuses of [[retry, status()], [status(), retry]]) {
        assertEquals(
          (await findAutomatedReview(
            { reviews: [], comments: [], statuses },
            HEAD,
          ))?.source,
          "coderabbit-status",
        );
      }
    }
    for (const statuses of [[], ...retries.map((retry) => [retry])]) {
      assertEquals(
        await findAutomatedReview({
          reviews: [],
          comments: [],
          statuses,
        }, HEAD),
        undefined,
      );
    }
  });

  it("ignores review objects for forks but accepts status and comment proof", async () => {
    const forkOptions = { allowPullRequestReviews: false };
    assertEquals(
      await findAutomatedReview(
        { reviews: [review()], comments: [], statuses: [] },
        HEAD,
        undefined,
        forkOptions,
      ),
      undefined,
    );
    assertEquals(
      (await findAutomatedReview(
        { reviews: [review()], comments: [], statuses: [status()] },
        HEAD,
        undefined,
        forkOptions,
      ))?.source,
      "coderabbit-status",
    );
    assertEquals(
      (await findAutomatedReview(
        { reviews: [review()], comments: [codexComment()], statuses: [] },
        HEAD,
        () => Promise.resolve(HEAD),
        forkOptions,
      ))?.source,
      "codex-comment",
    );
  });

  it("accepts only the pinned Codex canonical no-findings comment", async () => {
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [codexComment()],
          statuses: [],
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
          { reviews: [], comments: [candidate], statuses: [] },
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
          { reviews: [], comments: [codexComment()], statuses: [] },
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
      statuses: [],
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
});

function githubFixture(options: {
  pages?: Record<string, unknown[][]>;
  pagesByCall?: Record<string, unknown[][][]>;
  headResponses?: string[];
  commit?: string | undefined;
  failAfterFirstPage?: string;
  failOnCall?: Record<string, number>;
  pullError?: Error;
} = {}) {
  const endpoints = {
    reviews: () => undefined,
    comments: () => undefined,
    statuses: () => undefined,
    associatedPulls: () => undefined,
  };
  const published: Record<string, unknown>[] = [];
  const endpointCalls: Record<string, number> = {};
  let pullRead = 0;
  const github = {
    paginate: {
      async *iterator(endpoint: unknown) {
        const name = Object.entries(endpoints).find(([, value]) =>
          value === endpoint
        )?.[0];
        if (!name) throw new Error("unknown endpoint");
        const call = endpointCalls[name] ?? 0;
        endpointCalls[name] = call + 1;
        const pages = options.pagesByCall?.[name]?.[call] ??
          options.pages?.[name] ?? [[]];
        for (let index = 0; index < pages.length; index++) {
          if (
            (options.failAfterFirstPage === name ||
              options.failOnCall?.[name] === call) && index === 1
          ) {
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
          const heads = options.headResponses ?? [HEAD];
          const head = heads[Math.min(pullRead++, heads.length - 1)];
          return Promise.resolve({
            data: associatedPull({ head: { sha: head }, draft: false }),
          });
        },
      },
      issues: { listComments: endpoints.comments },
      repos: {
        listCommitStatusesForRef: endpoints.statuses,
        listPullRequestsAssociatedWithCommit: endpoints.associatedPulls,
        getCommit: () => Promise.resolve({ data: { sha: options.commit } }),
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
        comments: [[], []],
        statuses: [[], [status()]],
        associatedPulls: [[associatedPull()]],
      },
      headResponses: [HEAD],
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
  });

  it("keeps completion proof when a later retry appears during pagination", async () => {
    const fixture = githubFixture({
      pages: {
        statuses: [[status({ description: "Review rate limited" })], [
          status(),
        ]],
        associatedPulls: [[associatedPull()]],
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
    assertEquals(result.state, "success");
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
    const partialPages = ["reviews", "comments", "statuses"].map((source) =>
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
        statuses: [[status()]],
        associatedPulls: [[associatedPull()]],
      },
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
        statuses: [[status()]],
        associatedPulls: [[associatedPull()]],
      },
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

  it("binds CodeRabbit status proof to the unique open PR for the head", async () => {
    for (
      const associatedPulls of [
        [associatedPull({ number: 2 })],
        [associatedPull(), associatedPull({ number: 2 })],
      ]
    ) {
      const fixture = githubFixture({
        pages: {
          statuses: [[status()]],
          associatedPulls: [associatedPulls],
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
      assertEquals(result.review, undefined);
      assertEquals(fixture.published[0]?.state, "failure");
      assertEquals(
        fixture.published[0]?.target_url,
        "https://example.test/pr/1",
      );
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
});

// The status webhook payload has no creator field, so the workflow hands the
// gate only this claim tuple and the gate authenticates the creator over REST.
const payloadClaim = () => ({
  context: "CodeRabbit",
  state: "success",
  description: "Review completed",
});

describe("CodeRabbit completion status wakeup", () => {
  it("publishes success for one open PR whose head still matches", async () => {
    const fixture = githubFixture({
      pages: { associatedPulls: [[associatedPull()]] },
    });
    const result = await publishCodeRabbitCompletionStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      headSha: HEAD,
      status: status(),
    });
    assertEquals(result.state, "success");
    assertEquals(fixture.published[0]?.state, "success");
    assertEquals(fixture.published[0]?.sha, HEAD);
  });

  it("authenticates a creator-less payload claim against REST statuses", async () => {
    const fixture = githubFixture({
      pages: {
        statuses: [[status()]],
        associatedPulls: [[associatedPull()]],
      },
    });
    const result = await publishCodeRabbitCompletionStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      headSha: HEAD,
      status: payloadClaim(),
    });
    assertEquals(result.state, "success");
    assertEquals(fixture.published[0]?.state, "success");
    assertEquals(fixture.published[0]?.sha, HEAD);
  });

  it("ignores a payload claim without a pinned REST completion", async () => {
    for (
      const statuses of [
        [],
        [status({ creator: bot("github-actions[bot]", CODERABBIT_ID) })],
        [status({ creator: bot("coderabbitai[bot]", CODERABBIT_ID + 1) })],
        [status({ description: "Review rate limited" })],
      ]
    ) {
      const fixture = githubFixture({ pages: { statuses: [statuses] } });
      const result = await publishCodeRabbitCompletionStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        headSha: HEAD,
        status: payloadClaim(),
      });
      assertEquals(result.state, "ignored");
      assertEquals(fixture.published.length, 0);
    }
  });

  it("fails closed when claim verification cannot fully paginate", async () => {
    const fixture = githubFixture({
      pages: { statuses: [[], []] },
      failAfterFirstPage: "statuses",
    });
    const result = await publishCodeRabbitCompletionStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      headSha: HEAD,
      status: payloadClaim(),
    });
    assertEquals(result.state, "failure");
    assertEquals(fixture.published.length, 0);
  });

  it("resolves an earlier waiting publication into success", async () => {
    const fixture = githubFixture({
      pages: { associatedPulls: [[associatedPull()]] },
    });
    const beforeCompletion = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    const completion = await publishCodeRabbitCompletionStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      headSha: HEAD,
      status: status(),
    });
    assertEquals(beforeCompletion.state, "pending");
    assertEquals(completion.state, "success");
    assertEquals(fixture.published.map((value) => value.state), [
      "pending",
      "success",
    ]);
  });

  it("repairs a delayed pending publication after status success", async () => {
    const fixture = githubFixture({
      pages: { associatedPulls: [[associatedPull()]] },
      pagesByCall: { statuses: [[[]], [[status()]]] },
    });
    const completion = await publishCodeRabbitCompletionStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      headSha: HEAD,
      status: status(),
    });
    const delayedGeneral = await publishAutomatedReviewStatus({
      github: fixture.github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD,
      pullUrl: "https://example.test/pr/1",
    });
    assertEquals(completion.state, "success");
    assertEquals(delayedGeneral.state, "success");
    assertEquals(fixture.published.map((value) => value.state), [
      "success",
      "pending",
      "success",
    ]);
  });

  it("repairs completion that appears between pending publication and repair", async () => {
    const fixture = githubFixture({
      pages: { associatedPulls: [[associatedPull()]] },
      pagesByCall: { statuses: [[[]], [[status()]]] },
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
    assertEquals(fixture.published.map((value) => value.state), [
      "pending",
      "success",
    ]);
  });

  it("leaves pending when repair has no proof, fails, or binds another PR", async () => {
    for (
      const fixture of [
        githubFixture(),
        githubFixture({
          pagesByCall: { statuses: [[[]], [[], []]] },
          failOnCall: { statuses: 1 },
        }),
        githubFixture({
          pages: { associatedPulls: [[associatedPull({ number: 2 })]] },
          pagesByCall: { statuses: [[[]], [[status()]]] },
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
      assertEquals(result.state, "pending");
      assertEquals(fixture.published.map((value) => value.state), ["pending"]);
    }
  });

  it("ignores non-completion and wrong-creator status events", async () => {
    for (
      const candidate of [
        status({ description: "Review rate limited" }),
        status({ creator: bot("coderabbitai[bot]", CODERABBIT_ID + 1) }),
      ]
    ) {
      const fixture = githubFixture();
      const result = await publishCodeRabbitCompletionStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        headSha: HEAD,
        status: candidate,
      });
      assertEquals(result.state, "ignored");
      assertEquals(fixture.published.length, 0);
    }
  });

  it("fails closed for zero, multiple, or drifting associated PRs", async () => {
    for (
      const fixture of [
        githubFixture({ pages: { associatedPulls: [[]] } }),
        githubFixture({
          pages: {
            associatedPulls: [[
              associatedPull(),
              associatedPull({ number: 2 }),
            ]],
          },
        }),
        githubFixture({
          pages: { associatedPulls: [[associatedPull()]] },
          headResponses: [OTHER_HEAD],
        }),
        githubFixture({
          pages: { associatedPulls: [[], []] },
          failAfterFirstPage: "associatedPulls",
        }),
      ]
    ) {
      const result = await publishCodeRabbitCompletionStatus({
        github: fixture.github,
        owner: "veryfront",
        repo: "veryfront-code",
        headSha: HEAD,
        status: status(),
      });
      assertEquals(result.state, "failure");
      assertEquals(fixture.published.length, 0);
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
      user: { login: "github-actions[bot]", type: "Bot" },
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
});

describe("automated review workflow", () => {
  it("uses the tested gate from the trusted default branch", async () => {
    const workflow = record(
      parse(await Deno.readTextFile(WORKFLOW_PATH)),
      "workflow",
    );
    const permissions = record(workflow.permissions, "permissions");
    assertEquals(permissions.contents, "read");
    assertEquals(permissions.issues, "read");
    assertEquals(permissions["pull-requests"], "write");
    assertEquals(permissions.statuses, "write");

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
      ],
    );
    assertEquals(
      record(triggers.issue_comment, "issue comment trigger").types,
      ["created", "edited", "deleted"],
    );
    assert("status" in triggers, "completion status must have a wakeup path");
    const jobs = record(workflow.jobs, "jobs");
    const targetJob = record(jobs.target, "target job");
    assertEquals(
      record(targetJob.outputs, "target outputs").key,
      "${{ steps.resolve.outputs.result }}",
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
    for (
      const required of [
        "context.payload.sha",
        "context.payload.pull_request?.number",
        "context.payload.issue?.pull_request",
        "github.rest.pulls.get",
        "Could not resolve a valid review target commit",
      ]
    ) assert(targetScript.includes(required));
    assert(
      !targetScript.includes("pull_request?.head.sha"),
      "queued pull request events must resolve the current head before choosing a lock",
    );

    const job = record(jobs.review, "review job");
    const publisherConcurrency = {
      group: "automated-review-${{ needs.target.outputs.key }}",
      queue: "max",
    };
    assertEquals(job.needs, "target");
    assertEquals(record(job.concurrency, "review concurrency"), {
      ...publisherConcurrency,
    });
    assert(
      String(job.if).includes("github.event_name != 'status'"),
      "raw status events must never enter general PR reconciliation",
    );
    assert(
      String(job.if).includes("github.event.issue.pull_request"),
      "deleted issue comments must still be guarded by the issue PR marker",
    );
    assert(
      String(job.if).includes(
        "github.event.pull_request.head.repo.full_name == github.repository",
      ),
      "fork pull request review events must remain skipped",
    );
    const steps = job.steps;
    assert(Array.isArray(steps));
    const checkout = record(steps[0], "checkout");
    assertEquals(
      record(checkout.with, "checkout inputs").ref,
      "${{ github.event.repository.default_branch }}",
    );
    const gate = record(steps[1], "gate");
    const script = String(record(gate.with, "gate inputs").script);
    assert(script.includes("publishAutomatedReviewStatus"));
    assert(script.includes("github.rest.pulls.get"));
    assert(!script.includes("listPullRequestsAssociatedWithCommit"));
    assert(
      script.includes("allowPullRequestReviews") &&
        script.includes("pullRequest.head.repo?.full_name"),
      "the trusted reconciler must ignore review objects for fork pull requests",
    );
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

    const statusJob = record(jobs.status_review, "status review job");
    assertEquals(statusJob.needs, "target");
    const statusIf = String(statusJob.if);
    for (
      const condition of [
        "github.event.context == 'CodeRabbit'",
        "github.event.state == 'success'",
        "github.event.description == 'Review completed'",
        "github.event.sender.login == 'coderabbitai[bot]'",
        "github.event.sender.id == 136622811",
        "github.event.sender.type == 'Bot'",
      ]
    ) assert(statusIf.includes(condition));
    assert(
      !statusIf.includes("github.event.creator"),
      "the status payload has no creator field, so that condition never matches",
    );
    assertEquals(record(statusJob.concurrency, "status concurrency"), {
      ...publisherConcurrency,
    });
    const statusSteps = statusJob.steps;
    assert(Array.isArray(statusSteps));
    const statusScript = String(
      record(record(statusSteps[1], "status gate").with, "status gate inputs")
        .script,
    );
    assert(statusScript.includes("publishCodeRabbitCompletionStatus"));
    assert(
      !statusScript.includes("publishAutomatedReviewStatus"),
      "completion wakeups must not enter mutable PR reconciliation",
    );
    assert(
      !statusScript.includes("context.payload.creator"),
      "the status payload has no creator; the gate authenticates over REST",
    );
  });
});
