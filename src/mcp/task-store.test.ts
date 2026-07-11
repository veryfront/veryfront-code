import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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

  it("evicts expired terminal tasks on get", () => {
    const store = new TaskStore();
    // Terminal tasks expire; TTL is measured from completion.
    const task = store.create(1);
    store.complete(task.taskId, { ok: true });
    // Small delay to ensure expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    assertEquals(store.get(task.taskId), undefined);
  });

  it("does not expire a still-running task past its TTL", () => {
    const store = new TaskStore();
    // A 'working' task must not be deleted mid-flight even after its TTL,
    // otherwise its in-progress tool execution is dropped.
    const running = store.create(1);
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    assertExists(store.get(running.taskId));
  });

  it("returns undefined for expired terminal task via get", () => {
    const store = new TaskStore();
    const expired = store.create(1);
    store.complete(expired.taskId, { ok: true });
    const alive = store.create(60000);
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    assertEquals(store.get(expired.taskId), undefined);
    assertExists(store.get(alive.taskId));
  });

  it("clears all tasks and results", () => {
    const store = new TaskStore();
    store.create(60000);
    store.clear();
    assertEquals(store.list().length, 0);
  });
});
