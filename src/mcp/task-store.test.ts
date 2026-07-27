import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TaskStore } from "./task-store.ts";

describe("mcp/task-store", () => {
  it("creates a task with working status", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    assertExists(task.taskId);
    assertEquals(task.status, "working");
    assertExists(task.createdAt);
    assertExists(task.lastUpdatedAt);
    assertEquals(task.ttl, 60000);
  });

  it("gets a task by ID", () => {
    const store = new TaskStore();
    const created = store.create(60000);
    const retrieved = store.get(created.taskId);
    assertExists(retrieved);
    assertEquals(retrieved!.taskId, created.taskId);
  });

  it("does not expose mutable task state to callers", () => {
    const store = new TaskStore();
    const created = store.create(60000);
    created.status = "completed";
    created.statusMessage = "caller mutation";

    assertEquals(store.get(created.taskId)?.status, "working");
    assertEquals(store.get(created.taskId)?.statusMessage, undefined);

    const listed = store.list();
    listed[0]!.status = "failed";
    assertEquals(store.get(created.taskId)?.status, "working");
  });

  it("isolates task metadata, results, and cancellation by scope", () => {
    const store = new TaskStore();
    const taskA = store.create(60000, "session-a");
    const taskB = store.create(60000, "session-b");
    store.complete(taskA.taskId, { owner: "a" }, "session-a");

    assertEquals(store.get(taskA.taskId, "session-b"), undefined);
    assertEquals(store.getResult(taskA.taskId, "session-b"), undefined);
    assertEquals(store.cancel(taskB.taskId, "session-a"), false);
    assertEquals(store.list("session-a").map((task) => task.taskId), [taskA.taskId]);
    assertEquals(store.list("session-b").map((task) => task.taskId), [taskB.taskId]);
  });

  it("paginates task listings with scope-bound opaque cursors", () => {
    const store = new TaskStore();
    for (let index = 0; index < 55; index++) {
      store.create(60000, "session-a");
    }
    store.create(60000, "session-b");

    const first = store.listPage("session-a");
    assertEquals(first.tasks.length, 50);
    assertExists(first.nextCursor);

    const second = store.listPage("session-a", first.nextCursor);
    assertEquals(second.tasks.length, 5);
    assertEquals(second.nextCursor, undefined);
    assertEquals(
      new Set([...first.tasks, ...second.tasks].map((task) => task.taskId))
        .size,
      55,
    );

    assertThrows(
      () => store.listPage("session-b", first.nextCursor),
      TypeError,
      "Task cursor",
    );
  });

  it("prevents one scoped client from consuming the global task store", () => {
    const store = new TaskStore();
    for (let index = 0; index < 100; index++) {
      store.create(60000, "session-a");
    }

    assertThrows(
      () => store.create(60000, "session-a"),
      Error,
      "Task scope capacity reached",
    );
    assertExists(store.create(60000, "session-b"));
  });

  it("rejects invalid task lifetimes", () => {
    const store = new TaskStore();
    for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      assertThrows(
        () => store.create(ttl),
        TypeError,
        "Task TTL must be a positive safe integer",
      );
    }
  });

  it("returns undefined for unknown task ID", () => {
    const store = new TaskStore();
    assertEquals(store.get("nonexistent"), undefined);
  });

  it("transitions task to completed", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    store.complete(task.taskId, {
      content: [{ type: "text", text: "done" }],
      isError: false,
    });
    const updated = store.get(task.taskId);
    assertEquals(updated!.status, "completed");
  });

  it("transitions task to failed", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    store.fail(task.taskId, "Something broke");
    const updated = store.get(task.taskId);
    assertEquals(updated!.status, "failed");
    assertEquals(updated!.statusMessage, "Something broke");
  });

  it("cancels a task", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    const cancelled = store.cancel(task.taskId);
    assertEquals(cancelled, true);
    assertEquals(store.get(task.taskId)!.status, "cancelled");
  });

  it("rejects cancel on already-completed task", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    store.complete(task.taskId, { content: [], isError: false });
    const cancelled = store.cancel(task.taskId);
    assertEquals(cancelled, false);
  });

  it("lists all tasks", () => {
    const store = new TaskStore();
    store.create(60000);
    store.create(60000);
    const tasks = store.list();
    assertEquals(tasks.length, 2);
  });

  it("retrieves result for completed task", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    const resultData = {
      content: [{ type: "text", text: "result" }],
      isError: false,
    };
    store.complete(task.taskId, resultData);
    const result = store.getResult(task.taskId);
    assertEquals(result, resultData);
  });

  it("snapshots task results at both storage and retrieval boundaries", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    const resultData = { nested: { value: "original" } };
    store.complete(task.taskId, resultData);

    resultData.nested.value = "mutated after completion";
    const first = store.getResult(task.taskId) as {
      nested: { value: string };
    };
    assertEquals(first.nested.value, "original");

    first.nested.value = "mutated after retrieval";
    assertEquals(store.getResult(task.taskId), {
      nested: { value: "original" },
    });
  });

  it("waits for a non-terminal task result", async () => {
    const store = new TaskStore();
    const task = store.create(60000);
    const waiting = store.waitForResult(task.taskId);

    const settledEarly = await Promise.race([
      waiting.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
    ]);
    assertEquals(settledEarly, false);

    store.complete(task.taskId, { done: true });
    assertEquals(await waiting, { done: true });
  });

  it("releases a cancelled result waiter without changing task state", async () => {
    const store = new TaskStore();
    const task = store.create(60000);
    const controller = new AbortController();
    const waiting = store.waitForResult(task.taskId, undefined, controller.signal);

    controller.abort(new DOMException("Request cancelled", "AbortError"));
    await assertRejects(
      () => waiting,
      DOMException,
      "Request cancelled",
    );
    assertEquals(store.get(task.taskId)?.status, "working");

    store.complete(task.taskId, { done: true });
    assertEquals(await store.waitForResult(task.taskId), { done: true });
  });

  it("returns undefined result for non-terminal task", () => {
    const store = new TaskStore();
    const task = store.create(60000);
    assertEquals(store.getResult(task.taskId), undefined);
  });

  it("evicts terminal tasks after their post-terminal TTL", () => {
    using time = new FakeTime();
    const store = new TaskStore();
    const task = store.create(1);
    store.complete(task.taskId, { ok: true });

    time.tick(2);

    assertEquals(store.get(task.taskId), undefined);
  });

  it("keeps an active task visible past its TTL", () => {
    using time = new FakeTime();
    const store = new TaskStore();
    const task = store.create(1);

    time.tick(2);

    assertExists(store.get(task.taskId));
  });

  it("retains an overdue task result for one TTL after completion", () => {
    using time = new FakeTime();
    const store = new TaskStore();
    const task = store.create(60_000);

    time.tick(90_000);
    assertExists(store.get(task.taskId));

    store.complete(task.taskId, { ok: true });
    assertEquals(store.getResult(task.taskId), { ok: true });

    time.tick(60_000);
    assertExists(store.get(task.taskId));
    assertEquals(store.getResult(task.taskId), { ok: true });

    time.tick(1);
    assertEquals(store.get(task.taskId), undefined);
    assertEquals(store.getResult(task.taskId), undefined);
  });

  it("returns undefined for expired terminal task via get", () => {
    using time = new FakeTime();
    const store = new TaskStore();
    const expired = store.create(1);
    store.complete(expired.taskId, { ok: true });
    const alive = store.create(60000);

    time.tick(2);

    assertEquals(store.get(expired.taskId), undefined);
    assertExists(store.get(alive.taskId));
  });

  it("clears all tasks and results", () => {
    const store = new TaskStore();
    store.create(60000);
    store.clear();
    assertEquals(store.list().length, 0);
  });

  it("rejects new live tasks when the store reaches capacity", () => {
    const store = new TaskStore();
    for (let i = 0; i < 1000; i++) {
      store.create(60_000);
    }

    assertThrows(
      () => store.create(60_000),
      Error,
      "Task store capacity reached",
    );
    assertEquals(store.list().length, 1000);
  });

  it("does not reclaim active tasks at capacity just because their TTL elapsed", () => {
    const store = new TaskStore();
    for (let i = 0; i < 1000; i++) {
      store.create(1);
    }
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    assertThrows(
      () => store.create(60_000),
      Error,
      "Task store capacity reached",
    );
    assertEquals(store.list().length, 1000);
  });

  it("evicts a terminal task at capacity before accepting new work", () => {
    const store = new TaskStore();
    const oldest = store.create(60_000);
    store.complete(oldest.taskId, { ok: true });
    for (let i = 1; i < 1000; i++) {
      store.create(60_000);
    }

    store.create(60_000);

    assertEquals(store.get(oldest.taskId), undefined);
    assertEquals(store.list().length, 1000);
  });

  it("reclaims terminal work across scopes at global capacity", () => {
    const store = new TaskStore();
    const reclaimable = store.create(60_000, "session-0");
    store.complete(reclaimable.taskId, { ok: true }, "session-0");
    for (let index = 1; index < 100; index++) {
      store.create(60_000, "session-0");
    }
    for (let scope = 1; scope < 10; scope++) {
      for (let index = 0; index < 100; index++) {
        store.create(60_000, `session-${scope}`);
      }
    }

    assertExists(store.create(60_000, "session-10"));
    assertEquals(store.get(reclaimable.taskId, "session-0"), undefined);
    assertEquals(
      Array.from({ length: 11 }, (_, scope) => store.list(`session-${scope}`).length).reduce(
        (total, count) => total + count,
        0,
      ),
      1000,
    );
  });
});
