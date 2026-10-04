import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { parseCliArgs } from "../../../../cli/shared/args.ts";
import { parseRunsInvocation, runProjectRuns } from "../../../../cli/commands/project/runs.ts";
import { createRunsSdk, type RunsSdk } from "#veryfront/runs/target/client.ts";
import {
  createFixtureTransport,
  RUNS_OPERATION_FIXTURES,
} from "#veryfront/runs/target/client.test-helpers.ts";

const args = () => parseCliArgs(["project", "runs", "list", "--ndjson"]);

describe("runs NDJSON pagination", () => {
  it("delivers each item before requesting the next page and awaits output", async () => {
    const page = RUNS_OPERATION_FIXTURES.listRuns.response.body;
    const fixture = createFixtureTransport([
      Response.json({ ...page, page_info: { next: "second" } }),
      Response.json({ ...page, page_info: { next: null } }),
    ]);
    let count = 0;
    await runProjectRuns(args(), createRunsSdk({ transport: fixture.transport }), async (item) => {
      assertEquals(item, page.data[count % page.data.length]);
      assertEquals(fixture.requests.length, count < page.data.length ? 1 : 2);
      await Promise.resolve();
      count++;
    });
    assertEquals(count, page.data.length * 2);
    assert(parseRunsInvocation(args()).stream);
  });

  it("closes the iterator on an output failure without consuming another item", async () => {
    let consumed = 0;
    let closed = false;
    const sdk = {
      async *paginate() {
        try {
          while (true) yield ++consumed;
        } finally {
          closed = true;
        }
      },
    } as unknown as RunsSdk;
    await assertRejects(
      () => runProjectRuns(args(), sdk, () => Promise.reject(new Error("output failed"))),
      Error,
      "output failed",
    );
    assertEquals(consumed, 1);
    assert(closed);
  });

  it("propagates iterator failure after partial output", async () => {
    const sdk = {
      async *paginate() {
        yield { id: "first" };
        throw new Error("page failed");
      },
    } as unknown as RunsSdk;
    const output: unknown[] = [];
    await assertRejects(
      () =>
        runProjectRuns(args(), sdk, (item) => {
          output.push(item);
          return Promise.resolve();
        }),
      Error,
      "page failed",
    );
    assertEquals(output, [{ id: "first" }]);
  });

  it("cancels after partial output, closes the iterator and forwards the signal", async () => {
    const controller = new AbortController();
    let closed = false;
    let consumed = 0;
    const sdk = {
      async *paginate(_operation: unknown, _input: unknown, options: { signal: AbortSignal }) {
        assertEquals(options.signal, controller.signal);
        try {
          while (true) yield ++consumed;
        } finally {
          closed = true;
        }
      },
    } as unknown as RunsSdk;
    await assertRejects(() =>
      runProjectRuns(args(), sdk, () => {
        controller.abort();
        return Promise.resolve();
      }, { signal: controller.signal }), DOMException);
    assertEquals(consumed, 1);
    assert(closed);
  });

  it("rejects non-list commands, flag values and output files", () => {
    for (
      const argv of [
        ["project", "runs", "analytics", "--ndjson"],
        ["project", "runs", "list", "--ndjson=bad"],
        ["project", "runs", "list", "--ndjson", "--output", "results.json"],
      ]
    ) {
      let rejected = false;
      try {
        parseRunsInvocation(parseCliArgs(argv));
      } catch {
        rejected = true;
      }
      assert(rejected, argv.join(" "));
    }
  });
});
