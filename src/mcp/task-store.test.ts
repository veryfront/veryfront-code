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

  it("expires terminal tasks when their creation-based TTL elapses", () => {
    using time = new FakeTime();
    const store = new TaskStore();
    const task = store.create(1);
    store.complete(task.taskId, { ok: true });

    time.tick(2);

    assertEquals(store.get(task.taskId), undefined);
  });

  it("expires active tasks when their creation-based TTL elapses", () => {
    using time = new FakeTime();
    const store = new TaskStore();
    const task = store.create(1);

    time.tick(2);

    assertEquals(store.get(task.taskId), undefined);
  });

  it("does not extend the TTL when a task completes", () => {
    using time = new FakeTime();
    const store = new TaskStore();
    const task = store.create(100);

    time.tick(90);
    store.complete(task.taskId, { ok: true });
    assertEquals(store.getResult(task.taskId), { ok: true });

    time.tick(10);
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
    const store = new TaskStore({ maxTasks: 2 });
    store.create(60_000);
    store.create(60_000);

    assertThrows(
      () => store.create(60_000),
      Error,
      "Task store capacity reached",
    );
    assertEquals(store.list().length, 2);
  });

  it("reclaims expired active tasks at capacity", () => {
    using time = new FakeTime();
    const store = new TaskStore({ maxTasks: 2 });
    store.create(1);
    store.create(1);
    time.tick(1);

    store.create(60_000);

    assertEquals(store.list().length, 1);
  });

  it("does not evict an unexpired terminal result at capacity", () => {
    const store = new TaskStore({ maxTasks: 2 });
    const oldest = store.create(60_000);
    store.complete(oldest.taskId, { ok: true });
    store.create(60_000);

    assertThrows(
      () => store.create(60_000),
      Error,
      "Task store capacity reached",
    );

    assertEquals(store.getResult(oldest.taskId), { ok: true });
    assertEquals(store.list().length, 2);
  });

  it("rejects invalid TTL and capacity values", () => {
    const store = new TaskStore();
    for (const ttl of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(() => store.create(ttl), TypeError, "task TTL");
    }
    for (const maxTasks of [0, -1, 1.5, Number.NaN]) {
      assertThrows(
        () => new TaskStore({ maxTasks }),
        TypeError,
        "maximum task count",
      );
    }
    for (const maxWaiters of [0, -1, 1.5, Number.NaN]) {
      assertThrows(
        () => new TaskStore({ maxWaiters }),
        TypeError,
        "maximum task waiter count",
      );
    }
  });

  it("returns snapshots rather than mutable store state", () => {
    const store = new TaskStore();
    const created = store.create(60_000);
    created.status = "failed";
    assertEquals(store.get(created.taskId)!.status, "working");

    const result = { content: { type: "text", text: "original" } };
    store.complete(created.taskId, result);
    result.content.text = "mutated input";
    const first = store.getResult(created.taskId) as typeof result;
    assertEquals(first.content.text, "original");
    first.content.text = "mutated output";
    assertEquals(
      (store.getResult(created.taskId) as typeof result).content.text,
      "original",
    );
  });

  it("waits for an active task result", async () => {
    const store = new TaskStore();
    const task = store.create(60_000);
    let settled = false;
    const pending = store.waitForResult(task.taskId).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    assertEquals(settled, false);
    store.complete(task.taskId, { ok: true });
    assertEquals(await pending, { ok: true });
  });

  it("bounds and reclaims concurrent result waiters", async () => {
    const store = new TaskStore({ maxWaiters: 1 });
    const firstTask = store.create(60_000);
    const firstWait = store.waitForResult(firstTask.taskId);

    assertThrows(
      () => store.waitForResult(firstTask.taskId),
      Error,
      "waiter capacity reached",
    );

    store.complete(firstTask.taskId, { ok: true });
    assertEquals(await firstWait, { ok: true });

    const secondTask = store.create(60_000);
    const secondWait = store.waitForResult(secondTask.taskId);
    store.complete(secondTask.taskId, { ok: "again" });
    assertEquals(await secondWait, { ok: "again" });
  });

  it("stores terminal failure and cancellation results", () => {
    const store = new TaskStore();
    const failed = store.create(60_000);
    const cancelled = store.create(60_000);
    store.fail(failed.taskId, "Failed", { isError: true, reason: "failed" });
    store.cancel(cancelled.taskId, { isError: true, reason: "cancelled" });

    assertEquals(store.getResult(failed.taskId), {
      isError: true,
      reason: "failed",
    });
    assertEquals(store.getResult(cancelled.taskId), {
      isError: true,
      reason: "cancelled",
    });
  });

  it("notifies cleanup when a task expires or is deleted", () => {
    using time = new FakeTime();
    const deleted: Array<[string, string]> = [];
    const store = new TaskStore({
      onDelete: (id, reason) => deleted.push([id, reason]),
    });
    const expired = store.create(1);
    const removed = store.create(60_000);
    time.tick(1);
    store.list();
    store.delete(removed.taskId);

    assertEquals(deleted, [
      [expired.taskId, "expired"],
      [removed.taskId, "deleted"],
    ]);
  });
});
