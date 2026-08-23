import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "#std/yaml/parse";
import {
  findAutomatedReview as findAutomatedReviewDecision,
  publishAutomatedReviewStatus,
  requestAutomatedReview,
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

function codeRabbitReviewRange(
  baseSha = STALE_SHA,
  headSha = HEAD_SHA,
): string {
  return "Reviewing files that changed from the base of the PR and between " +
    `${baseSha} and ${headSha}.`;
}

function codeRabbitSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    user: { login: "coderabbitai[bot]" },
    body: [
      "<!-- recent_review_start -->",
      "No actionable comments were generated in the recent review.",
      codeRabbitReviewRange(),
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

async function findAutomatedReview(
  options: {
    reviews: Array<Record<string, unknown>>;
    comments: Array<Record<string, unknown>>;
    resolveCommit?: (ref: string) => Promise<string | undefined>;
  },
  headSha: string,
) {
  const decision = await findAutomatedReviewDecision(options, headSha);
  return decision.kind === "success" ? decision.review : undefined;
}

describe("automated review gate", () => {
  it("keeps success, failure, and waiting decisions distinct", async () => {
    assertEquals(
      (await findAutomatedReviewDecision(
        { reviews: [review()], comments: [] },
        HEAD_SHA,
      )).kind,
      "success",
    );
    assertEquals(
      (await findAutomatedReviewDecision(
        { reviews: [review({ state: "CHANGES_REQUESTED" })], comments: [] },
        HEAD_SHA,
      )).kind,
      "failure",
    );
    assertEquals(
      (await findAutomatedReviewDecision(
        { reviews: [], comments: [] },
        HEAD_SHA,
      )).kind,
      "waiting",
    );
  });

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

  it("requires CodeRabbit's exact current base-change review sentence", async () => {
    const currentSummary = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(),
        "<!-- recent_review_end -->",
      ].join("\n"),
    });

    assertEquals(
      (await findAutomatedReview(
        { reviews: [], comments: [currentSummary] },
        HEAD_SHA,
      ))?.source,
      "summary",
    );
    assertEquals(
      await findAutomatedReview(
        { reviews: [], comments: [currentSummary] },
        STALE_SHA,
      ),
      undefined,
    );

    for (
      const invalidRange of [
        `Reviewing files between ${STALE_SHA} and ${HEAD_SHA}.`,
        codeRabbitReviewRange() + " but this is not the final review.",
        codeRabbitReviewRange().replace("Reviewing", "reviewing"),
        codeRabbitReviewRange().replace("files that", "files  that"),
        codeRabbitReviewRange().replace(HEAD_SHA, HEAD_SHA.toUpperCase()),
      ]
    ) {
      const invalidSummary = codeRabbitSummary({
        body: [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          invalidRange,
          "<!-- recent_review_end -->",
        ].join("\n"),
      });
      assertEquals(
        await findAutomatedReview(
          { reviews: [], comments: [invalidSummary] },
          HEAD_SHA,
        ),
        undefined,
      );
    }
  });

  it("requires one unambiguous range in the selected recent review", async () => {
    for (
      const ranges of [
        [codeRabbitReviewRange(), codeRabbitReviewRange(HEAD_SHA, STALE_SHA)],
        [codeRabbitReviewRange(HEAD_SHA, STALE_SHA), codeRabbitReviewRange()],
        [codeRabbitReviewRange(), codeRabbitReviewRange()],
        [
          codeRabbitReviewRange(),
          codeRabbitReviewRange() + " but this is not the final review.",
        ],
        [
          codeRabbitReviewRange(),
          codeRabbitReviewRange().replace("Reviewing", "reviewing"),
        ],
      ]
    ) {
      const ambiguousSummary = codeRabbitSummary({
        body: [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          ...ranges,
          "<!-- recent_review_end -->",
        ].join("\n"),
      });

      assertEquals(
        await findAutomatedReview(
          { reviews: [], comments: [ambiguousSummary] },
          HEAD_SHA,
        ),
        undefined,
      );
    }

    const scopedSummary = codeRabbitSummary({
      body: [
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(),
        "<!-- recent_review_end -->",
        codeRabbitReviewRange() + " but this is not the final review.",
      ].join("\n"),
    });
    assertEquals(
      (await findAutomatedReview(
        { reviews: [], comments: [scopedSummary] },
        HEAD_SHA,
      ))?.source,
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
              codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
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
        codeRabbitReviewRange(),
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

  it("lets a malformed current-head range override an older valid review", async () => {
    const olderSuccess = codeRabbitSummary({
      created_at: "2026-08-22T12:01:00Z",
      updated_at: "2026-08-22T12:01:00Z",
    });

    for (
      const malformedCurrentRange of [
        `Reviewing files between ${STALE_SHA} and ${HEAD_SHA}.`,
        `Reviewing files that changed from the base of the PR and between ${
          STALE_SHA.slice(0, 12)
        } and ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between " +
        `not-a-sha and ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between " +
        `not a sha and ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between " +
        `not-a-sha\nand ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between\n" +
        `${STALE_SHA}\nand ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between\n" +
        `${STALE_SHA}\nand\n${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between\n" +
        `${STALE_SHA}\nmalformed continuation\nanother continuation\nand\n` +
        `${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between " +
        `and ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between " +
        `\nand ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between " +
        `${"not and ".repeat(1_000)}base and ${HEAD_SHA}.`,
        codeRabbitReviewRange() + " but this is not the final review.",
        codeRabbitReviewRange() + ` Later requested ${STALE_SHA}.`,
        codeRabbitReviewRange().replace("Reviewing", "reviewing"),
        codeRabbitReviewRange().replace("files that", "files  that"),
        codeRabbitReviewRange().replace(HEAD_SHA, HEAD_SHA.toUpperCase()),
      ]
    ) {
      const newerMalformedCurrentRange = codeRabbitSummary({
        body: [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          malformedCurrentRange,
          "<!-- recent_review_end -->",
        ].join("\n"),
        created_at: "2026-08-22T12:02:00Z",
        updated_at: "2026-08-22T12:02:00Z",
      });

      assertEquals(
        await findAutomatedReview(
          {
            reviews: [],
            comments: [olderSuccess, newerMalformedCurrentRange],
          },
          HEAD_SHA,
        ),
        undefined,
      );
    }

    const newerMalformedStaleRange = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        [
          codeRabbitReviewRange(HEAD_SHA, STALE_SHA) +
          ` but this is not the final review. Later requested ${STALE_SHA}.`,
          "Reviewing files that changed from the base of the PR and between " +
          `not-a-sha and ${STALE_SHA}.`,
          "Reviewing files that changed from the base of the PR and between " +
          `not a sha and ${STALE_SHA}.`,
          "Reviewing files that changed from the base of the PR and between " +
          `not-a-sha\nand ${STALE_SHA}.`,
          "Reviewing files that changed from the base of the PR and between\n" +
          `${HEAD_SHA}\nand ${STALE_SHA}.`,
          "Reviewing files that changed from the base of the PR and between\n" +
          `${HEAD_SHA}\nand\n${STALE_SHA}.`,
          "Reviewing files that changed from the base of the PR and between\n" +
          `${HEAD_SHA}\nmalformed continuation\nanother continuation\nand\n` +
          `${STALE_SHA}.`,
          "Reviewing files that changed from the base of the PR and between " +
          `and ${STALE_SHA}.`,
        ].join("\n"),
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:03:00Z",
      updated_at: "2026-08-22T12:03:00Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerMalformedStaleRange],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    for (
      const unterminatedCurrentRange of [
        codeRabbitReviewRange(),
        `Reviewing files between ${STALE_SHA} and ${HEAD_SHA}.`,
      ]
    ) {
      const newerUnterminatedCurrentRange = codeRabbitSummary({
        body: [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          unterminatedCurrentRange,
        ].join("\n"),
        created_at: "2026-08-22T12:03:30Z",
        updated_at: "2026-08-22T12:03:30Z",
      });

      assertEquals(
        await findAutomatedReview(
          {
            reviews: [],
            comments: [olderSuccess, newerUnterminatedCurrentRange],
          },
          HEAD_SHA,
        ),
        undefined,
      );
    }

    for (
      const newerMalformedBody of [
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `- [ ] ${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `## ${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `${"- [ ] ".repeat(1_000)}${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `${"###### ".repeat(1_000)}${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `- ${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `    ${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `> ${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `1. ${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `> 1. ${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          `${"> ".repeat(2_000)}${codeRabbitReviewRange()}`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          "Reviewing changed files from the base of the PR and between " +
          `${STALE_SHA} and ${HEAD_SHA}.`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          "Reviewing files that changed from the base of the PR and between " +
          `${STALE_SHA} and`,
          `${HEAD_SHA}.`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          "Reviewing files that changed from the base of the PR and between " +
          `${STALE_SHA} and ${STALE_SHA}. Later requested ${HEAD_SHA}.`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          "Reviewing changed files from the base of the PR and between " +
          `${STALE_SHA} and ${STALE_SHA}. Later requested ${HEAD_SHA}.`,
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          codeRabbitReviewRange(),
          "<!-- recent_review_end -->",
          "<!-- recent_review_start -->",
        ].join("\n"),
      ]
    ) {
      const newerMalformedCurrentRange = codeRabbitSummary({
        body: newerMalformedBody,
        created_at: "2026-08-22T12:03:40Z",
        updated_at: "2026-08-22T12:03:40Z",
      });

      assertEquals(
        await findAutomatedReview(
          {
            reviews: [],
            comments: [olderSuccess, newerMalformedCurrentRange],
          },
          HEAD_SHA,
        ),
        undefined,
      );
    }

    const newerExactCurrentWithMalformedBaseDuplicates = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(),
        "Reviewing files that changed from the base of the PR and between " +
        `and ${HEAD_SHA}.`,
        "Reviewing files that changed from the base of the PR and between " +
        `not a sha and ${HEAD_SHA}.`,
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:03:41Z",
      updated_at: "2026-08-22T12:03:41Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [
            olderSuccess,
            newerExactCurrentWithMalformedBaseDuplicates,
          ],
        },
        HEAD_SHA,
      ),
      undefined,
    );

    const newerFencedCurrentRangeExample = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        "```",
        codeRabbitReviewRange(),
        "```",
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:03:42Z",
      updated_at: "2026-08-22T12:03:42Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [newerFencedCurrentRangeExample],
        },
        HEAD_SHA,
      ),
      undefined,
    );
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerFencedCurrentRangeExample],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerManyFencedCurrentRangeExamples = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        ...Array.from({ length: 250 }, () =>
          [
            "```",
            codeRabbitReviewRange(),
            "```",
          ].join("\n")),
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:03:43Z",
      updated_at: "2026-08-22T12:03:43Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerManyFencedCurrentRangeExamples],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerMismatchedFenceDelimiterCurrentRangeExample = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        "```",
        "~~~",
        codeRabbitReviewRange(),
        "```",
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:03:44Z",
      updated_at: "2026-08-22T12:03:44Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [
            olderSuccess,
            newerMismatchedFenceDelimiterCurrentRangeExample,
          ],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerNonClosingFenceLineCurrentRangeExample = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        "```",
        "```not-a-close",
        codeRabbitReviewRange(),
        "```",
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:03:44Z",
      updated_at: "2026-08-22T12:03:44Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [newerNonClosingFenceLineCurrentRangeExample],
        },
        HEAD_SHA,
      ),
      undefined,
    );
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [
            olderSuccess,
            newerNonClosingFenceLineCurrentRangeExample,
          ],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerUnterminatedStaleRange = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
      ].join("\n"),
      created_at: "2026-08-22T12:03:45Z",
      updated_at: "2026-08-22T12:03:45Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerUnterminatedStaleRange],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerCompleteCurrentThenUnterminatedStale = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(),
        "<!-- recent_review_end -->",
        "<!-- recent_review_start -->",
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
      ].join("\n"),
      created_at: "2026-08-22T12:03:50Z",
      updated_at: "2026-08-22T12:03:50Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerCompleteCurrentThenUnterminatedStale],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    for (
      const newerNestedMarkerBody of [
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          codeRabbitReviewRange(),
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
          "<!-- recent_review_end -->",
        ].join("\n"),
        [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          codeRabbitReviewRange(),
          "<!-- recent_review_end -->",
        ].join("\n"),
      ]
    ) {
      const newerNestedMarkers = codeRabbitSummary({
        body: newerNestedMarkerBody,
        created_at: "2026-08-22T12:03:55Z",
        updated_at: "2026-08-22T12:03:55Z",
      });
      assertEquals(
        await findAutomatedReview(
          {
            reviews: [],
            comments: [olderSuccess, newerNestedMarkers],
          },
          HEAD_SHA,
        ),
        undefined,
      );
    }

    const newerInvalidCurrentThenEmptyTail = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(),
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
        "<!-- recent_review_end -->",
        "<!-- recent_review_start -->",
      ].join("\n"),
      created_at: "2026-08-22T12:03:57Z",
      updated_at: "2026-08-22T12:03:57Z",
    });
    assertEquals(
      await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerInvalidCurrentThenEmptyTail],
        },
        HEAD_SHA,
      ),
      undefined,
    );

    const newerOutOfScopeCurrentRange = codeRabbitSummary({
      body: [
        `Reviewing files between ${STALE_SHA} and ${HEAD_SHA}.`,
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:04:00Z",
      updated_at: "2026-08-22T12:04:00Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerOutOfScopeCurrentRange],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerUnrelatedCurrentText = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        `Diagnostic commit: ${HEAD_SHA}.`,
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:04:15Z",
      updated_at: "2026-08-22T12:04:15Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerUnrelatedCurrentText],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerStaleRangeThenDiagnostic = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
        `Diagnostic commit: ${HEAD_SHA}.`,
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:04:30Z",
      updated_at: "2026-08-22T12:04:30Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerStaleRangeThenDiagnostic],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerUnrelatedBetweenText = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        `Reviewing files between jobs for ${STALE_SHA}; diagnostic ${HEAD_SHA}.`,
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:04:45Z",
      updated_at: "2026-08-22T12:04:45Z",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerUnrelatedBetweenText],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );

    const newerWhitespaceOnlyRangeStart = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        "Reviewing files that changed from the base of the PR and between" +
        " ".repeat(2_000),
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:04:50Z",
      updated_at: "2026-08-22T12:04:50Z",
    });
    const whitespaceOnlyStartedAt = performance.now();
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerWhitespaceOnlyRangeStart],
        },
        HEAD_SHA,
      ))?.source,
      "summary",
    );
    assert(
      performance.now() - whitespaceOnlyStartedAt < 1_000,
      "whitespace-only malformed range parsing must stay linear",
    );

    const newerExactCurrentWithDiagnostic = codeRabbitSummary({
      body: [
        "<!-- recent_review_start -->",
        "No actionable comments were generated in the recent review.",
        codeRabbitReviewRange(),
        `Diagnostic commit: ${HEAD_SHA}.`,
        "<!-- recent_review_end -->",
      ].join("\n"),
      created_at: "2026-08-22T12:05:00Z",
      updated_at: "2026-08-22T12:05:00Z",
      html_url:
        "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-5",
    });
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [],
          comments: [olderSuccess, newerExactCurrentWithDiagnostic],
        },
        HEAD_SHA,
      ))?.url,
      "https://github.com/veryfront/veryfront-code/pull/1#issuecomment-5",
    );
  });

  it("rejects any current-head skip or request marker in a summary", async () => {
    for (
      const markers of [
        [
          `Review skipped for current commit ${STALE_SHA}.`,
          `Review skipped for current commit ${HEAD_SHA}.`,
        ],
        [
          `Review skipped for current commit ${HEAD_SHA}.`,
          `Review skipped for current commit ${STALE_SHA}.`,
        ],
        [
          `Requested commit: ${STALE_SHA}.`,
          `Requested commit: ${HEAD_SHA}.`,
        ],
        [
          `Requested commit: ${HEAD_SHA}.`,
          `Requested commit: ${STALE_SHA}.`,
        ],
      ]
    ) {
      const summary = codeRabbitSummary({
        body: [
          "<!-- recent_review_start -->",
          "No actionable comments were generated in the recent review.",
          codeRabbitReviewRange(),
          "<!-- recent_review_end -->",
          ...markers,
        ].join("\n"),
      });

      assertEquals(
        await findAutomatedReview(
          { reviews: [], comments: [summary] },
          HEAD_SHA,
        ),
        undefined,
      );
    }
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
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
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
        codeRabbitReviewRange(HEAD_SHA, STALE_SHA),
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

  it("accepts matching tied successes and rejects conflicting outcomes", async () => {
    const timestamp = "2026-08-22T12:00:00Z";
    assertEquals(
      (await findAutomatedReview(
        {
          reviews: [review({ submitted_at: timestamp })],
          comments: [codeRabbitSummary({
            created_at: timestamp,
            updated_at: timestamp,
          })],
        },
        HEAD_SHA,
      ))?.reviewer,
      "coderabbitai[bot]",
    );

    assertEquals(
      await findAutomatedReview(
        {
          reviews: [review({
            state: "CHANGES_REQUESTED",
            submitted_at: timestamp,
          })],
          comments: [codeRabbitSummary({
            created_at: timestamp,
            updated_at: timestamp,
          })],
        },
        HEAD_SHA,
      ),
      undefined,
    );

    for (
      const conflictingSummary of [
        codeRabbitSummary({
          body: [
            "<!-- recent_review_start -->",
            "No actionable comments were generated in the recent review.",
            codeRabbitReviewRange(),
            "<!-- recent_review_end -->",
            `Review skipped for current commit ${HEAD_SHA}.`,
          ].join("\n"),
          created_at: timestamp,
          updated_at: timestamp,
        }),
        codeRabbitSummary({
          body: [
            "<!-- recent_review_start -->",
            codeRabbitReviewRange(),
            "<!-- recent_review_end -->",
          ].join("\n"),
          created_at: timestamp,
          updated_at: timestamp,
        }),
      ]
    ) {
      assertEquals(
        await findAutomatedReview(
          {
            reviews: [review({ submitted_at: timestamp })],
            comments: [conflictingSummary],
          },
          HEAD_SHA,
        ),
        undefined,
      );
    }
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
    assertEquals(missing.state, "pending");
    assertEquals(missing.review, undefined);
    assertEquals(missing.failure, undefined);
    assertEquals(statuses[1]?.sha, STALE_SHA);
    assertEquals(statuses[1]?.state, "pending");
    assertEquals(
      statuses[1]?.description,
      `Waiting for an automated review of ${STALE_SHA.slice(0, 12)}`,
    );
  });

  it("publishes failure for completed negative exact-head outcomes", async () => {
    const negativeEvidence = [
      { reviews: [review({ state: "CHANGES_REQUESTED" })], comments: [] },
      {
        reviews: [],
        comments: [codexNoFindingComment({
          body: [
            "Codex Review: Found an actionable issue.",
            `**Reviewed commit:** \`${HEAD_SHA.slice(0, 10)}\``,
          ].join("\n\n"),
        })],
      },
      {
        reviews: [],
        comments: [codeRabbitSummary({
          body: [
            "<!-- recent_review_start -->",
            "Actionable comments were generated in the recent review.",
            `Reviewing files between ${STALE_SHA} and ${HEAD_SHA}.`,
            "<!-- recent_review_end -->",
          ].join("\n"),
        })],
      },
    ];

    for (const evidence of negativeEvidence) {
      const statuses: Array<Record<string, unknown>> = [];
      const listReviews = () => Promise.resolve();
      const listComments = () => Promise.resolve();
      const github = {
        paginate: (endpoint: unknown) =>
          Promise.resolve(
            endpoint === listReviews ? evidence.reviews : evidence.comments,
          ),
        rest: {
          issues: { listComments },
          pulls: { listReviews },
          repos: {
            createCommitStatus: (status: Record<string, unknown>) => {
              statuses.push(status);
              return Promise.resolve();
            },
            getCommit: () => Promise.resolve({ data: { sha: HEAD_SHA } }),
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
      assertEquals(statuses[0]?.state, "failure");
    }
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

  it("fails closed when Codex commit resolution is rejected", async () => {
    for (const status of [403, 429, 500]) {
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
            createCommitStatus: (commitStatus: Record<string, unknown>) => {
              statuses.push(commitStatus);
              return Promise.resolve();
            },
            getCommit: () =>
              Promise.reject(Object.assign(new Error(`HTTP ${status}`), {
                status,
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
      assertEquals(statuses[0]?.state, "failure");
      assert(
        result.failure instanceof Error &&
          result.failure.message.includes(String(status)),
      );
    }
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

  it("requests an automated review at most once per head commit", async () => {
    const posted: Array<Record<string, unknown>> = [];
    const existing: Array<Record<string, unknown>> = [];
    const listComments = () => Promise.resolve();
    const github = {
      paginate: () => Promise.resolve(existing),
      rest: {
        issues: {
          listComments,
          createComment: (comment: Record<string, unknown>) => {
            posted.push(comment);
            return Promise.resolve();
          },
        },
        pulls: {
          get: () => Promise.resolve({ data: { head: { sha: HEAD_SHA } } }),
        },
      },
    };
    const request = (headSha: string) =>
      requestAutomatedReview({
        github,
        owner: "veryfront",
        repo: "veryfront-code",
        pullNumber: 1,
        headSha,
      });

    const first = await request(HEAD_SHA);
    assertEquals(first.requested, true);
    assertEquals(posted, [{
      owner: "veryfront",
      repo: "veryfront-code",
      issue_number: 1,
      body: `<!-- automated-review-request: ${HEAD_SHA} -->\n@codex review`,
    }]);

    // A participant pasting the marker text must not suppress the request:
    // only a workflow-authored marker comment counts, pinned by login and
    // account type the way the gate pins the Codex bot.
    existing.push(
      { user: { login: "maintainer", type: "User" }, body: posted[0]?.body },
      {
        user: { login: "github-actions[bot]", type: "User" },
        body: posted[0]?.body,
      },
      { body: posted[0]?.body },
    );
    const impersonated = await request(HEAD_SHA);
    assertEquals(impersonated.requested, true);
    assertEquals(posted.length, 2);

    // A rerun for the same head finds the workflow-authored marker and does
    // not post again.
    existing.push({
      user: { login: "github-actions[bot]", type: "Bot" },
      body: posted[0]?.body,
    });
    const second = await request(HEAD_SHA);
    assertEquals(second.requested, false);
    assertEquals(posted.length, 2);

    // A new head commit carries a new marker and gets its own request.
    github.rest.pulls.get = () =>
      Promise.resolve({ data: { head: { sha: STALE_SHA } } });
    const third = await request(STALE_SHA);
    assertEquals(third.requested, true);
    assertEquals(
      posted[2]?.body,
      `<!-- automated-review-request: ${STALE_SHA} -->\n@codex review`,
    );
  });

  it("does not post from a stale queued synchronize event", async () => {
    let posted = false;
    const github = {
      paginate: () => Promise.resolve([]),
      rest: {
        issues: {
          listComments: () => Promise.resolve(),
          createComment: () => {
            posted = true;
            return Promise.resolve();
          },
        },
        pulls: {
          get: () => Promise.resolve({ data: { head: { sha: STALE_SHA } } }),
        },
      },
    };

    const result = await requestAutomatedReview({
      github,
      owner: "veryfront",
      repo: "veryfront-code",
      pullNumber: 1,
      headSha: HEAD_SHA,
    });

    assertEquals(result.requested, false);
    assertEquals(result.reason, "stale-head");
    assertEquals(posted, false);
  });

  it("refuses to request a review of a malformed head commit", async () => {
    const github = {
      paginate: () => Promise.resolve([]),
      rest: {
        issues: {
          listComments: () => Promise.resolve(),
          createComment: () => {
            throw new Error("must not post for a malformed commit");
          },
        },
        pulls: { get: () => Promise.resolve() },
      },
    };
    for (
      const malformed of [
        HEAD_SHA.slice(0, 39),
        `${HEAD_SHA} --><script>`,
        "@codex review",
      ]
    ) {
      await assertRejects(
        () =>
          requestAutomatedReview({
            github,
            owner: "veryfront",
            repo: "veryfront-code",
            pullNumber: 1,
            headSha: malformed,
          }),
        Error,
        "malformed head commit",
      );
    }
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
      "pull-requests": "write",
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
    assertEquals(
      gate.id,
      "publish",
      "the request step reads the published state from this step's output",
    );
    assertEquals(
      record(gate.with, "automated review gate inputs")["result-encoding"],
      "string",
      "the published state must land in the step output as a plain string",
    );

    const request = record(steps[2], "automated review request step");
    assertEquals(
      request.uses,
      "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
    );
    const requestCondition = String(request.if);
    for (
      const guard of [
        "github.event_name == 'pull_request_target'",
        "github.event.pull_request.draft == false",
        "github.event.action == 'synchronize'",
        "steps.publish.outputs.result == 'pending'",
      ]
    ) {
      assertStringIncludes(
        requestCondition,
        guard,
        "a review request is posted only for a trusted non-draft push that left the status pending",
      );
    }
    assert(
      !requestCondition.includes("ready_for_review") &&
        !requestCondition.includes("opened"),
      "open and ready-for-review events are already handled by the connector",
    );
    const requestScript = String(
      record(request.with, "automated review request inputs").script,
    );
    assert(
      requestScript.includes("requestAutomatedReview"),
      "the workflow must post review requests through the tested gate helper",
    );
  });
});
