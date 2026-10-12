import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatQueueTreeNotice, measureQueueTree } from "./queue-tree-dry-run.ts";

const TREE = "a".repeat(40);
const HEAD = "b".repeat(40);
function fixture(
  overrides: {
    tree?: string;
    run?: Record<string, unknown>;
    artifacts?: unknown[];
    status?: number;
  } = {},
) {
  const paths: string[] = [];
  const options = {
    repository: "veryfront/veryfront-code",
    headRef: `gh-readonly-queue/main/pr-123-${HEAD}`,
    tree: TREE,
    token: "test-token",
    fetch: (url: URL, init?: RequestInit) => {
      paths.push(url.pathname + url.search);
      assertEquals(url.origin, "https://api.github.com");
      assertEquals(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-token",
      );
      const body = url.pathname.endsWith("/pulls/123")
        ? { head: { sha: HEAD } }
        : url.pathname.endsWith("/artifacts")
        ? {
          artifacts: overrides.artifacts ??
            [{ name: `tested-tree-${overrides.tree ?? TREE}`, expired: false }],
        }
        : url.pathname.endsWith("/actions/workflows/cicd.yml/runs")
        ? {
          workflow_runs: [{
            id: 456,
            event: "pull_request",
            head_sha: HEAD,
            status: "completed",
            conclusion: "success",
            run_attempt: 1,
            pull_requests: [{ number: 123 }],
            ...overrides.run,
          }],
        }
        : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: overrides.status ?? 200 }),
      );
    },
  };
  return { options, paths };
}

describe("queue tree dry run", () => {
  it("logs the successful same-workflow PR run when its tested tree matches", async () => {
    const { options, paths } = fixture();
    assertEquals(
      await measureQueueTree(options),
      `would reuse run 456 (tree ${TREE}); dry run, full pipeline retained`,
    );
    assertEquals(paths, [
      "/repos/veryfront/veryfront-code/pulls/123",
      `/repos/veryfront/veryfront-code/actions/workflows/cicd.yml/runs?event=pull_request&head_sha=${HEAD}&per_page=1`,
      "/repos/veryfront/veryfront-code/actions/runs/456/artifacts?per_page=100",
    ]);
  });
  it("misses when the tested tree differs", async () => {
    assertStringIncludes(
      await measureQueueTree(fixture({ tree: "c".repeat(40) }).options),
      "tree differs",
    );
  });
  for (
    const run of [
      { status: "in_progress", conclusion: null },
      // The newest run on the head failed: an older green run cannot vouch for it.
      { conclusion: "failure" },
      // Green only after a re-run hides a failed first attempt.
      { run_attempt: 2 },
      { event: "merge_group" },
      { head_sha: "c".repeat(40) },
      { pull_requests: [] },
    ]
  ) {
    it(`does not use an ineligible latest PR run: ${JSON.stringify(run)}`, async () => {
      const { options, paths } = fixture({ run });
      assertStringIncludes(
        await measureQueueTree(options),
        "latest PR run is not eligible",
      );
      assertEquals(paths.length, 2);
    });
  }
  for (
    const artifacts of [[], [{ name: `tested-tree-${TREE}`, expired: true }], [{
      name: `tested-tree-${TREE}`,
      expired: false,
    }, { name: `tested-tree-${"c".repeat(40)}`, expired: false }], [{
      name: "tested-tree-invalid",
      expired: false,
    }]]
  ) {
    it(`misses absent or ambiguous tree evidence: ${JSON.stringify(artifacts)}`, async () => {
      assertStringIncludes(
        await measureQueueTree(fixture({ artifacts }).options),
        "missing or ambiguous tested tree",
      );
    });
  }
  it("fails to a measurement miss on API errors", async () => {
    assertStringIncludes(
      await measureQueueTree(fixture({ status: 403 }).options),
      "GitHub lookup unavailable (HTTP 403)",
    );
  });
  it("rejects malformed repository, queue ref and tree before any request", async () => {
    for (
      const change of [{ repository: "../other" }, { headRef: "main" }, {
        tree: "bad",
      }]
    ) {
      const { options, paths } = fixture();
      assertStringIncludes(
        await measureQueueTree({ ...options, ...change }),
        "unsupported queue identity",
      );
      assertEquals(paths, []);
    }
  });
  it("does not use an empty run list", async () => {
    const { options } = fixture();
    options.fetch = () =>
      Promise.resolve(
        Response.json({ head: { sha: HEAD }, workflow_runs: [] }),
      );
    assertStringIncludes(
      await measureQueueTree(options),
      "latest PR run is not eligible",
    );
  });
  it("does not echo an unvalidated tree into the miss line", async () => {
    const { options } = fixture();
    const message = await measureQueueTree({ ...options, tree: "bad\n::error::forged" });
    assertEquals(message, "would not reuse: unsupported queue identity; full pipeline retained");
  });
  it("escapes the notice so a message cannot start another workflow command", () => {
    assertEquals(
      formatQueueTreeNotice("50% done\r\n::error::forged"),
      "::notice title=Queue tree dry run::50%25 done%0D%0A::error::forged",
    );
  });
});
