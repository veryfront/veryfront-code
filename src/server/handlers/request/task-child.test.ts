import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createTaskChildRunner } from "./task-child.ts";

const parentId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const eventToken = `test.${
  btoa(
    JSON.stringify({
      tokenUse: "run_event_writer",
      runId: "run_parent",
      projectId,
      projectExecutionAttempt: {
        canonicalRunId: parentId,
        attemptId: "attempt",
        workerId: "worker",
      },
    }),
  )
}.signature`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function serializedBody(init: unknown): unknown {
  if (!init || typeof init !== "object" || !("body" in init)) return null;
  const { body } = init;
  return typeof body === "string" ? JSON.parse(body) : null;
}

function childRunner(fetch: typeof globalThis.fetch, sleep?: (ms: number) => Promise<void>) {
  return createTaskChildRunner({
    runId: "run_parent",
    projectId,
    apiUrl: "https://api.example.test",
    eventToken,
    authToken: "private-auth",
    signal: new AbortController().signal,
    fetch,
    sleep,
  });
}

describe("Task child runner", () => {
  it("durably starts, admits, polls, and returns only the owned child output", async () => {
    const calls: { url: string; body: unknown; headers: Headers }[] = [];
    const sleeps: number[] = [];
    const runner = childRunner(
      ((url, init) => {
        const request = new Request(url, init);
        calls.push({
          url: request.url,
          body: serializedBody(init),
          headers: request.headers,
        });
        if (request.url.endsWith(`/runs/${parentId}/events`)) return Promise.resolve(json({}));
        if (request.url.endsWith("/runs")) {
          return Promise.resolve(json({ run_id: "child/run" }, 202));
        }
        if (calls.filter((call) => call.url.endsWith("/runs/child%2Frun")).length === 1) {
          return Promise.resolve(
            json({ parent_run_id: parentId, project_id: projectId, status: "running" }),
          );
        }
        return Promise.resolve(
          json({
            parent_run_id: parentId,
            project_id: projectId,
            status: "completed",
            output: { value: 42 },
          }),
        );
      }) as typeof fetch,
      (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    );

    assertEquals(
      await runner({
        target: { type: "task", id: "child-task" },
        input: { prompt: "run" },
        idempotencyKey: "child-invocation",
      }),
      { value: 42 },
    );

    const start = calls[0];
    const admission = calls[1];
    assertExists(start);
    assertExists(admission);
    const invocationKey = admission.headers.get("Idempotency-Key");
    assertEquals(start.url, `https://api.example.test/runs/${parentId}/events`);
    assertEquals(start.headers.get("Authorization"), `Bearer ${eventToken}`);
    assertEquals(start.body, { events: [{ type: "STEP_STARTED", stepId: invocationKey }] });
    assertEquals(admission.url, "https://api.example.test/runs");
    assertEquals(admission.headers.get("Authorization"), "Bearer private-auth");
    assertEquals(admission.headers.get("X-Veryfront-Run-Event-Token"), eventToken);
    assertEquals(admission.body, {
      project_id: projectId,
      parent_run_id: parentId,
      target: { type: "task", id: "child-task" },
      input: { prompt: "run" },
    });
    assertEquals(calls[2]?.url, "https://api.example.test/runs/child%2Frun");
    assertEquals(calls[3]?.url, "https://api.example.test/runs/child%2Frun");
    assertEquals(sleeps, [250]);
  });

  it("rejects malformed child admission receipts before polling", async () => {
    const urls: string[] = [];
    const runner = childRunner(
      ((url) => {
        urls.push(String(url));
        if (String(url).endsWith(`/runs/${parentId}/events`)) return Promise.resolve(json({}));
        return Promise.resolve(json({ accepted: true }, 202));
      }) as typeof fetch,
    );

    const error = await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
    );

    assert(error instanceof Error);
    assertEquals(error.message.includes("Task child admission omitted its identity"), true);
    assertEquals(urls.length, 2);
  });

  it("rejects child results that do not belong to the current parent and project", async () => {
    let calls = 0;
    const runner = childRunner(
      (() =>
        Promise.resolve(
          ++calls === 1 ? json({}) : calls === 2 ? json({ id: "child" }, 202) : json({
            parent_run_id: "other-parent",
            project_id: projectId,
            status: "completed",
            output: "wrong",
          }),
        )) as typeof fetch,
    );

    const error = await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
    );

    assert(error instanceof Error);
    assertEquals(
      error.message.includes("Task child result does not match its parent and project"),
      true,
    );
  });

  it("rejects unstable child idempotency before any durable write", async () => {
    let calls = 0;
    const runner = childRunner(
      (() => {
        calls++;
        return Promise.resolve(json({}));
      }) as typeof fetch,
    );

    const error = await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "has spaces" })
    );

    assert(error instanceof Error);
    assertEquals(error.message.includes("Task child requires a stable Idempotency-Key"), true);
    assertEquals(calls, 0);
  });

  it("surfaces a failed durable start before admission", async () => {
    const runner = childRunner(
      (() => Promise.resolve(json({ error: "nope" }, 503))) as typeof fetch,
    );

    const error = await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
    );

    assert(error instanceof Error);
    assertEquals(error.message.includes("Task child start failed (503)"), true);
  });

  it("surfaces failed admission without polling", async () => {
    let calls = 0;
    const runner = childRunner(
      (() =>
        Promise.resolve(++calls === 1 ? json({}) : json({ error: "denied" }, 409))) as typeof fetch,
    );

    const error = await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
    );

    assert(error instanceof Error);
    assertEquals(error.message.includes("Task child admission failed (409)"), true);
    assertEquals(calls, 2);
  });

  it("surfaces failed child status reads", async () => {
    let calls = 0;
    const runner = childRunner(
      (() =>
        Promise.resolve(
          ++calls === 1
            ? json({})
            : calls === 2
            ? json({ id: "child" }, 202)
            : json({ error: "gone" }, 410),
        )) as typeof fetch,
    );

    const error = await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
    );

    assert(error instanceof Error);
    assertEquals(error.message.includes("Task child read failed (410)"), true);
  });

  for (const status of ["failed", "cancelled"] as const) {
    it(`reports terminal child ${status} without returning its output`, async () => {
      let calls = 0;
      const runner = childRunner(
        (() =>
          Promise.resolve(
            ++calls === 1
              ? json({})
              : calls === 2
              ? json({ id: "child" }, 202)
              : json({ parent_run_id: parentId, project_id: projectId, status, output: "wrong" }),
          )) as typeof fetch,
      );

      const error = await assertRejects(() =>
        runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
      );

      assert(error instanceof Error);
      assertEquals(error.message.includes(`Task child ${status}`), true);
      assertEquals(error.message.includes("wrong"), false);
    });
  }
});
