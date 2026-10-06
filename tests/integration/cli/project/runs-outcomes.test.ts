import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { parseCliArgs } from "../../../../cli/shared/args.ts";
import { parseRunsInvocation, runProjectRuns } from "../../../../cli/commands/project/runs.ts";
import { createRunsSdk } from "#veryfront/runs/target/client.ts";
import {
  createFixtureTransport,
  RUNS_OPERATION_FIXTURES,
} from "#veryfront/runs/target/client.test-helpers.ts";

const runId = "11111111-1111-4111-8111-111111111111";

describe("runs explicit outcome commands", () => {
  for (
    const [action, body] of [
      ["succeed", { output: null }],
      ["fail", {
        error: { code: "TASK_FAILED", message: "Task failed", details: { nullable: null } },
      }],
    ] as const
  ) {
    const argv = ["project", "runs", action, "--run-id", runId];
    it(`${action} requires a retry key and request body`, () => {
      assertThrows(() => parseRunsInvocation(parseCliArgs(argv)), Error, "--idempotency-key");
      assertThrows(
        () => parseRunsInvocation(parseCliArgs([...argv, "--idempotency-key", "outcome-key"])),
        Error,
        "--body",
      );
    });
    it(`${action} sends its JSON body and emits the canonical run`, async () => {
      const result =
        RUNS_OPERATION_FIXTURES[action === "succeed" ? "succeedRun" : "failRun"].response.body;
      assertEquals(result.status, action === "succeed" ? "completed" : "failed");
      const { transport, requests } = createFixtureTransport([Response.json(result)]);
      const sdk = createRunsSdk({ transport });
      const emitted: unknown[] = [];
      await runProjectRuns(
        parseCliArgs([...argv, "--idempotency-key", "outcome-key", "--body", JSON.stringify(body)]),
        sdk,
        (value) => {
          emitted.push(value);
          return Promise.resolve();
        },
      );
      assertEquals(requests.length, 1);
      const [request] = requests;
      assert(request);
      assertEquals(request.method, "POST");
      assertEquals(new URL(request.url).pathname, `/runs/${runId}/${action}`);
      assertEquals(request.headers.get("Idempotency-Key"), "outcome-key");
      assertEquals(await request.json(), body);
      assertEquals(emitted, [result]);
    });
  }
});
