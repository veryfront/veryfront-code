import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
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
describe("Task durable child capability", () => {
  it("persists invocation before dispatching and returns the real child output", async () => {
    const calls: { url: string; body: unknown; headers: Headers }[] = [];
    const runner = createTaskChildRunner({
      runId: "run_parent",
      projectId,
      apiUrl: "https://api.example",
      eventToken,
      authToken: "private-auth",
      signal: new AbortController().signal,
      fetch: ((url: string, init: RequestInit) => {
        calls.push({
          url,
          body: init.body ? JSON.parse(String(init.body)) : null,
          headers: new Headers(init.headers),
        });
        return Promise.resolve(
          calls.length === 1
            ? json({})
            : calls.length === 2
            ? json({ run_id: "child" }, 202)
            : json({
              parent_run_id: parentId,
              project_id: projectId,
              status: "completed",
              output: { result: 42 },
            }),
        );
      }) as typeof fetch,
    });
    assertEquals(
      await runner({
        target: { type: "task", id: "child-task" },
        input: { input: 1 },
        idempotencyKey: "child-invocation",
      }),
      { result: 42 },
    );
    const start = calls[0];
    const admission = calls[1];
    assertExists(start);
    assertExists(admission);
    const invocationKey = admission.headers.get("Idempotency-Key");
    assertEquals(invocationKey?.startsWith("task-child:"), true);
    assertEquals(start.body, { events: [{ type: "STEP_STARTED", stepId: invocationKey }] });
    assertEquals(admission.body, {
      project_id: projectId,
      parent_run_id: parentId,
      target: { type: "task", id: "child-task" },
      input: { input: 1 },
    });
    assertEquals(admission.headers.get("X-Veryfront-Run-Event-Token"), eventToken);
  });
  it("keeps authenticated child reads on their fixed path and uses the captured response reader", async () => {
    const originalEncoder = globalThis.encodeURIComponent;
    const descriptor = Object.getOwnPropertyDescriptor(Response.prototype, "json")!;
    const originalJson = Response.prototype.json;
    const paths: string[] = [];
    let intercepted = 0;
    const runner = createTaskChildRunner({
      runId: "run_parent",
      projectId,
      apiUrl: "https://api.example",
      eventToken,
      authToken: "private-auth",
      signal: new AbortController().signal,
      fetch: ((url: string) => {
        paths.push(new URL(url).pathname);
        return Promise.resolve(
          paths.length === 1
            ? json({})
            : paths.length === 2
            ? json({ run_id: "child" }, 202)
            : json({
              parent_run_id: parentId,
              project_id: projectId,
              status: "completed",
              output: 42,
            }),
        );
      }) as typeof fetch,
    });
    globalThis.encodeURIComponent = () => "../projects";
    Object.defineProperty(Response.prototype, "json", {
      ...descriptor,
      value: function (this: Response) {
        intercepted++;
        return Reflect.apply(originalJson, this, []);
      },
    });
    try {
      assertEquals(
        await runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" }),
        42,
      );
      assertEquals(paths[2], "/runs/child");
      assertEquals(intercepted, 0);
    } finally {
      globalThis.encodeURIComponent = originalEncoder;
      Object.defineProperty(Response.prototype, "json", descriptor);
    }
  });

  it("does not expose ingress tokens to tenant string split hooks", async () => {
    const previous = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
    let observed = 0;
    let calls = 0;
    const runner = createTaskChildRunner({
      runId: "run_parent",
      projectId,
      apiUrl: "https://api.example",
      eventToken,
      authToken: "private-auth",
      signal: new AbortController().signal,
      fetch: (() =>
        Promise.resolve(
          ++calls === 1 ? json({}) : calls === 2 ? json({ run_id: "child" }, 202) : json({
            parent_run_id: parentId,
            project_id: projectId,
            status: "completed",
            output: 42,
          }),
        )) as typeof fetch,
    });
    Object.defineProperty(String.prototype, Symbol.split, {
      configurable: true,
      value(input: string) {
        if (input === eventToken) observed++;
        return [
          "test",
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
          ),
          "signature",
        ];
      },
    });
    try {
      assertEquals(
        await runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" }),
        42,
      );
      assertEquals(observed, 0);
    } finally {
      if (previous) Object.defineProperty(String.prototype, Symbol.split, previous);
      else Reflect.deleteProperty(String.prototype, Symbol.split);
    }
  });

  it("does not propagate private terminal child diagnostics into the parent error", async () => {
    let calls = 0;
    const runner = createTaskChildRunner({
      runId: "run_parent",
      projectId,
      apiUrl: "https://api.example",
      eventToken,
      authToken: "private-auth",
      signal: new AbortController().signal,
      fetch: (() =>
        Promise.resolve(
          ++calls === 1 ? json({}) : calls === 2 ? json({ run_id: "child" }, 202) : json({
            parent_run_id: parentId,
            project_id: projectId,
            status: "failed",
            error: { message: "Bearer synthetic-secret at /Users/example/private/file.ts" },
          }),
        )) as typeof fetch,
    });
    const error = await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
    );
    assertEquals(error.message.includes("Task child failed"), true);
    assertEquals(error.message.includes("synthetic-secret"), false);
    assertEquals(error.message.includes("/Users/example/private/file.ts"), false);
  });

  it("binds start replay to the attempt while retaining one child invocation key", async () => {
    const starts: string[] = [];
    const children: string[] = [];
    const encodedClaims = eventToken.split(".")[1];
    assertExists(encodedClaims);
    const claims = JSON.parse(atob(encodedClaims));
    for (const [attemptId, issuedAt] of [["attempt", 1], ["attempt", 2], ["next-attempt", 3]]) {
      const token = `test.${
        btoa(JSON.stringify({
          ...claims,
          iat: issuedAt,
          projectExecutionAttempt: { ...claims.projectExecutionAttempt, attemptId },
        }))
      }.signature`;
      const runner = createTaskChildRunner({
        runId: "run_parent",
        projectId,
        apiUrl: "https://api.example",
        eventToken: token,
        authToken: "private-auth",
        signal: new AbortController().signal,
        fetch: ((url: string, init: RequestInit) => {
          const key = new Headers(init.headers).get("Idempotency-Key")!;
          if (url.endsWith("/events")) {
            starts.push(key);
            return Promise.resolve(json({}));
          }
          if (url.endsWith("/runs")) {
            children.push(key);
            return Promise.resolve(json({ run_id: "child" }, 202));
          }
          return Promise.resolve(
            json({
              parent_run_id: parentId,
              project_id: projectId,
              status: "completed",
              output: 42,
            }),
          );
        }) as typeof fetch,
      });
      assertEquals(
        await runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" }),
        42,
      );
    }
    assertEquals(starts[0], starts[1]);
    assertEquals(starts[0] === starts[2], false);
    assertEquals(children, [children[0], children[0], children[0]]);
  });
  it("refuses execution without current parent routing authority", async () => {
    let calls = 0;
    const runner = createTaskChildRunner({
      runId: "run_parent",
      projectId,
      apiUrl: "https://api.example",
      authToken: "private-auth",
      signal: new AbortController().signal,
      fetch: (() => {
        calls++;
        return Promise.resolve(json({}));
      }) as typeof fetch,
    });
    await assertRejects(() =>
      runner({ target: { type: "task", id: "child-task" }, idempotencyKey: "child" })
    );
    assertEquals(calls, 0);
  });
});
