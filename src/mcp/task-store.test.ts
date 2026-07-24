import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
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
});
