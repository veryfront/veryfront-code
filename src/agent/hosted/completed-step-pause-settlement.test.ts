import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCompletedStepPauseConfirmer } from "./completed-step-pause.ts";

const credentials = {
  apiUrl: "https://api.example.test",
  runId: "run_1",
  authToken: "run-bound-test-token",
  terminalToken: "generation-test-token",
};

describe("completed-step pause settlement", () => {
  it("replays the owning settlement after a lost reply without sending another checkpoint", async () => {
    const requests: RequestInit[] = [];
    const confirm = createCompletedStepPauseConfirmer(credentials, {
      transport: (_url, init) => {
        requests.push(init!);
        return requests.length === 1
          ? Promise.reject(new TypeError("Lost settlement reply"))
          : Promise.resolve(Response.json({ stop: true }));
      },
      sleep: () => Promise.resolve(),
    });
    assertEquals(await confirm(new AbortController().signal), true);
    assertEquals(requests.length, 2);
    assertEquals(requests[0]!.body, '{"settled":true}');
    assertEquals(requests[1]!.body, requests[0]!.body);
    assertEquals(requests[0]!.headers, {
      Authorization: "Bearer run-bound-test-token",
      "X-Veryfront-Run-Terminal-Token": "generation-test-token",
      "Content-Type": "application/json",
    });
  });

  it("leaves an unconfirmable credential to fenced recovery without failing the settled execution", async () => {
    let calls = 0;
    const confirm = createCompletedStepPauseConfirmer(credentials, {
      transport: () => {
        calls++;
        return Promise.resolve(new Response(null, { status: 403 }));
      },
      sleep: () => Promise.resolve(),
    });
    assertEquals(await confirm(new AbortController().signal), false);
    assertEquals(calls, 1);
  });

  it("does not confirm after cancellation", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const confirm = createCompletedStepPauseConfirmer(credentials, {
      transport: () => {
        calls++;
        return Promise.resolve(Response.json({ stop: true }));
      },
      sleep: () => Promise.resolve(),
    });
    assertEquals(await confirm(controller.signal), false);
    assertEquals(calls, 0);
  });

  it("does not treat a checkpoint request as confirmation", async () => {
    let calls = 0;
    const controller = new AbortController();
    const confirm = createCompletedStepPauseConfirmer(credentials, {
      transport: () => {
        calls++;
        return Promise.resolve(Response.json({ stop: false, checkpoint_required: true }));
      },
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
    });
    assertEquals(await confirm(controller.signal), false);
    assertEquals(calls, 1);
  });
});
