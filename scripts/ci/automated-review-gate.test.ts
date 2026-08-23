import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  findAutomatedReview,
  publishAutomatedReviewStatus,
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

  it("accepts exact-head submitted reviews from either pinned bot", async () => {
    for (
      const [login, id, state] of [
        ["coderabbitai[bot]", CODERABBIT_ID, "COMMENTED"],
        ["chatgpt-codex-connector[bot]", CODEX_ID, "APPROVED"],
      ] as const
    ) {
      assertEquals(
        (await findAutomatedReview({
          reviews: [review({ user: bot(login, id), state })],
          comments: [],
          statuses: [],
        }, HEAD))?.source,
        "pull-request-review",
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
});

function githubFixture(options: {
  pages?: Record<string, unknown[][]>;
  headResponses?: string[];
  commit?: string | undefined;
  failAfterFirstPage?: string;
} = {}) {
  const endpoints = {
    reviews: () => undefined,
    comments: () => undefined,
    statuses: () => undefined,
  };
  const published: Record<string, unknown>[] = [];
  let pullRead = 0;
  const github = {
    paginate: {
      async *iterator(endpoint: unknown) {
        const name = Object.entries(endpoints).find(([, value]) =>
          value === endpoint
        )?.[0];
        if (!name) throw new Error("unknown endpoint");
        const pages = options.pages?.[name] ?? [[]];
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
          const heads = options.headResponses ?? [HEAD];
          const head = heads[Math.min(pullRead++, heads.length - 1)];
          return Promise.resolve({ data: { head: { sha: head } } });
        },
      },
      issues: { listComments: endpoints.comments },
      repos: {
        listCommitStatusesForRef: endpoints.statuses,
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
      pages: { statuses: [[status()]] },
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

describe("automated review workflow", () => {
  it("uses the tested gate from the trusted default branch", async () => {
    const workflow = record(
      parse(await Deno.readTextFile(WORKFLOW_PATH)),
      "workflow",
    );
    const permissions = record(workflow.permissions, "permissions");
    assertEquals(permissions.contents, "read");
    assertEquals(permissions.issues, "read");
    assertEquals(permissions["pull-requests"], "read");
    assertEquals(permissions.statuses, "write");

    assertEquals(
      record(workflow.concurrency, "concurrency"),
      {
        group: "automated-review-${{ github.repository }}",
        queue: "max",
      },
      "every trigger must join one repository-wide FIFO group without cancellation",
    );

    const triggers = record(workflow.on, "triggers");
    assert(
      "status" in triggers,
      "CodeRabbit status changes must rerun the gate",
    );
    const job = record(record(workflow.jobs, "jobs").review, "review job");
    assert(
      String(job.if).includes("github.event.context == 'CodeRabbit'"),
      "status events must be limited to CodeRabbit to prevent recursion",
    );
    const steps = job.steps;
    assert(Array.isArray(steps));
    const checkout = record(steps[0], "checkout");
    assertEquals(
      record(checkout.with, "checkout inputs").ref,
      "${{ github.event.repository.default_branch }}",
    );
    const script = String(
      record(record(steps[1], "gate").with, "gate inputs").script,
    );
    assert(script.includes("publishAutomatedReviewStatus"));
    assert(script.includes("github.rest.pulls.get"));
    assert(script.includes("Review gate is unavailable on the default branch"));
  });
});
