import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  Checkpoint,
  CheckpointResumeEnvelope,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  appendRetainedCheckpoint,
  cloneCheckpointForPersistence,
  cloneOwnedCheckpointForPersistence,
  deleteOldestCheckpointOccurrences,
} from "./checkpoint-retention.ts";
import { MemoryBackend } from "./memory.ts";
import { VeryfrontError } from "#veryfront/errors";

const jsonRawSupport = JSON as typeof JSON & {
  isRawJSON?: (value: unknown) => boolean;
  rawJSON?: (source: string) => unknown;
};

function checkpoint(id: string, nodeId = id, timestamp = new Date(0)): Checkpoint {
  return { id, nodeId, timestamp, context: { input: {} }, nodeStates: {} };
}

function run(id: string, workerId?: string): WorkflowRun {
  return {
    id,
    workflowId: "checkpoint-retention",
    status: workerId ? "running" : "pending",
    ...(workerId ? { workerId } : {}),
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
  };
}

function identify(checkpoints: readonly Checkpoint[]): Array<{ id: string; nodeId: string }> {
  return checkpoints.map(({ id, nodeId }) => ({ id, nodeId }));
}

function deepValue(depth: number): unknown {
  let deep: unknown = { leaf: "stored" };
  for (let index = 0; index < depth; index++) deep = { nested: deep };
  return deep;
}

function deepCheckpointContext(depth: number): WorkflowContext {
  return { input: {}, deep: deepValue(depth) };
}

function deepNodeStates(nodeId: string, depth: number): Checkpoint["nodeStates"] {
  return {
    [nodeId]: {
      nodeId,
      status: "completed",
      attempt: 1,
      output: deepValue(depth),
    },
  };
}

function deepResumeEnvelope(nodeId: string, depth: number): CheckpointResumeEnvelope {
  return {
    schemaVersion: 2,
    ownerNodeId: nodeId,
    context: deepCheckpointContext(depth),
    nodeStates: deepNodeStates(nodeId, depth),
    workflowProjection: { context: {} },
    graphAdmission: {
      stepsEvaluationContext: deepCheckpointContext(depth),
      stepsEvaluationProjection: { context: {} },
      graphIdentity: [],
      workflowVersion: null,
    },
  };
}

function getField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Reflect.get(value, key);
}

function deepLeaf(value: unknown, depth: number): unknown {
  let cursor = value;
  for (let index = 0; index < depth; index++) cursor = getField(cursor, "nested");
  return getField(cursor, "leaf");
}

describe("workflow checkpoint retention", () => {
  it("snapshots persistence input without normalizing policy-visible values", () => {
    let getterCalls = 0;
    const shared = { value: "original" };
    Object.preventExtensions(shared);
    const lockedArray = [1];
    Object.defineProperty(lockedArray, "length", { writable: false });
    const context: WorkflowContext = {
      input: { shared },
      again: shared,
      date: new Date(0),
      lockedArray,
    };
    context.self = context;
    Object.defineProperty(context, "accessor", {
      get() {
        getterCalls++;
        return shared;
      },
      enumerable: true,
      configurable: true,
    });
    if (jsonRawSupport.rawJSON) context.raw = jsonRawSupport.rawJSON("-0");

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("snapshot"),
      context,
    });
    shared.value = "mutated";

    const input = snapshot.context.input as { shared: { value: string } };
    assertEquals(snapshot.context === context, false);
    assertEquals(input.shared.value, "original");
    assertEquals(snapshot.context.again === input.shared, true);
    assertEquals(snapshot.context.self === snapshot.context, true);
    assertEquals(snapshot.context.date instanceof Date, true);
    assertEquals((snapshot.context.date as Date).getTime(), 0);
    assertEquals(Object.isExtensible(input.shared), false);
    assertEquals(
      Object.getOwnPropertyDescriptor(snapshot.context.lockedArray, "length")?.writable,
      false,
    );
    assertEquals(snapshot.context.accessor === input.shared, true);
    assertEquals(getterCalls, 1);
    if (jsonRawSupport.isRawJSON) {
      assertEquals(jsonRawSupport.isRawJSON(snapshot.context.raw), true);
    }
  });

  it("traverses nested child values before later parent siblings", () => {
    let getterCalls = 0;
    const nested = {};
    const context: WorkflowContext = {
      input: { nested },
      later: "before",
    };
    Object.defineProperty(nested, "trigger", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls++;
        context.later = "after";
        return "triggered";
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("getter-order"),
      context,
    });

    assertEquals(snapshot.context.input, { nested: { trigger: "triggered" } });
    assertEquals(snapshot.context.later, "after");
    assertEquals(getterCalls, 1);
  });

  it("snapshots array indices in native JSON order", () => {
    const reads: string[] = [];
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "0", {
      configurable: true,
      get() {
        reads.push("inherited-0");
        return { value: "inherited" };
      },
    });
    Object.defineProperty(prototype, "2", {
      configurable: true,
      get() {
        reads.push("inherited-2");
        return { value: "later" };
      },
    });
    const values: unknown[] = [];
    values.length = 3;
    Object.defineProperty(values, "1", {
      configurable: true,
      enumerable: false,
      get() {
        reads.push("own-1");
        return { value: "own" };
      },
    });
    Object.setPrototypeOf(values, prototype);

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("array-index-order"),
      context: { input: { values } },
    });

    assertEquals(reads, ["inherited-0", "own-1", "inherited-2"]);
    assertEquals(
      JSON.stringify(snapshot.context.input),
      '{"values":[{"value":"inherited"},{"value":"own"},{"value":"later"}]}',
    );
  });

  it("snapshots owned plain values, dates, and raw JSON", () => {
    const nested = { value: "original" };
    const context: WorkflowContext = {
      input: { nested },
      date: new Date(1),
    };
    if (jsonRawSupport.rawJSON) context.raw = jsonRawSupport.rawJSON("-0");

    const snapshot = cloneOwnedCheckpointForPersistence({
      ...checkpoint("owned-positive"),
      timestamp: new Date(2),
      context,
    });
    nested.value = "mutated";
    (context.date as Date).setTime(3);

    assertEquals(snapshot.context.input, { nested: { value: "original" } });
    assertEquals(snapshot.timestamp instanceof Date, true);
    assertEquals(snapshot.timestamp.getTime(), 2);
    assertEquals(snapshot.context.date instanceof Date, true);
    assertEquals((snapshot.context.date as Date).getTime(), 1);
    if (jsonRawSupport.isRawJSON) {
      assertEquals(jsonRawSupport.isRawJSON(snapshot.context.raw), true);
    }
  });

  it("keeps strict validation transparent for owned prototype snapshots", async () => {
    const snapshot = cloneOwnedCheckpointForPersistence({
      ...checkpoint("owned-strict-prototype-snapshot"),
      context: { input: { value: { name: "stored" }, values: [1, 2] } },
    });
    const backend = new MemoryBackend({ strictContext: true });

    await backend.saveCheckpoint("owned-strict-prototype-snapshot", snapshot);

    assertEquals(
      (await backend.getLatestCheckpoint("owned-strict-prototype-snapshot"))?.context,
      { input: { value: { name: "stored" }, values: [1, 2] } },
    );
  });

  it("preserves an owned non-callable toJSON data property", () => {
    const snapshot = cloneOwnedCheckpointForPersistence({
      ...checkpoint("owned-to-json-data"),
      context: { input: { value: { toJSON: "data", name: "ok" } } },
    });

    assertEquals(
      JSON.stringify(snapshot.context),
      '{"input":{"value":{"toJSON":"data","name":"ok"}}}',
    );
  });

  it("detaches owned values with proxy prototypes without traversing the prototype", () => {
    let prototypeTraps = 0;
    const prototype = new Proxy({}, {
      get() {
        prototypeTraps++;
        throw new Error("proxy prototype get must not run");
      },
      getOwnPropertyDescriptor() {
        prototypeTraps++;
        throw new Error("proxy prototype descriptor must not run");
      },
      getPrototypeOf() {
        prototypeTraps++;
        throw new Error("proxy prototype traversal must not run");
      },
      ownKeys() {
        prototypeTraps++;
        throw new Error("proxy prototype keys must not run");
      },
    });
    const value = Object.create(prototype);
    Object.defineProperty(value, "safe", {
      configurable: true,
      enumerable: true,
      value: "data",
      writable: true,
    });

    const snapshot = cloneOwnedCheckpointForPersistence({
      ...checkpoint("owned-proxy-prototype"),
      context: { input: { value } },
    });

    assertThrows(
      () => JSON.stringify(snapshot.context.input),
      VeryfrontError,
      "Proxy prototype",
    );
    assertEquals(prototypeTraps, 0);
  });

  it("does not inspect properties that a native toJSON hook bypasses", () => {
    let getterCalls = 0;
    const date = new Date(0);
    Object.defineProperty(date, "ignored", {
      enumerable: true,
      get() {
        getterCalls++;
        throw new Error("Date properties must not be read");
      },
    });
    const url = new URL("https://example.com/path");
    Object.defineProperty(url, "ignored", {
      enumerable: true,
      get() {
        getterCalls++;
        throw new Error("URL properties must not be read");
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("native-to-json"),
      context: { input: { date, url } },
    });

    assertEquals(snapshot.context.input, {
      date: new Date(0),
      url: new URL("https://example.com/path"),
    });
    assertEquals(getterCalls, 0);
  });

  it("captures a native prototype toJSON hook before an asynchronous save", () => {
    const prototype = Object.create(Date.prototype) as Date;
    prototype.toJSON = Date.prototype.toJSON;
    const date = new Date(0);
    Object.setPrototypeOf(date, prototype);
    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("native-prototype-to-json"),
      context: { input: { date } },
    });
    prototype.toJSON = () => "mutated-hook";

    assertEquals(
      JSON.stringify(snapshot.context.input),
      '{"date":"1970-01-01T00:00:00.000Z"}',
    );
  });

  it("captures an ordinary inherited toJSON hook before an asynchronous save", () => {
    const prototype = {
      toJSON() {
        return "original-hook";
      },
    };
    const value = Object.create(prototype);
    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("ordinary-prototype-to-json"),
      context: { input: { value } },
    });
    prototype.toJSON = () => "mutated-hook";

    assertEquals(JSON.stringify(snapshot.context.input), '{"value":"original-hook"}');
  });

  it("resolves an inherited toJSON accessor against the source", () => {
    const prototype = {};
    Object.defineProperty(prototype, "toJSON", {
      get(this: { name: string }) {
        const name = this.name;
        return () => name;
      },
    });
    const value = Object.assign(Object.create(prototype), { name: "original" });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("inherited-to-json-accessor"),
      context: { input: { value } },
    });

    assertEquals(JSON.stringify(snapshot.context.input), '{"value":"original"}');
  });

  it("stabilizes a non-callable own toJSON accessor", () => {
    let returnHook = false;
    let sourceReads = 0;
    const value = { name: "original" };
    Object.defineProperty(value, "toJSON", {
      configurable: true,
      enumerable: true,
      get() {
        sourceReads++;
        if (returnHook) return () => "mutated-hook";
        return sourceReads === 1 ? undefined : "second-read";
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("non-callable-own-to-json"),
      context: { input: { value } },
    });
    returnHook = true;

    assertEquals(
      JSON.stringify(snapshot.context.input),
      '{"value":{"name":"original","toJSON":"second-read"}}',
    );
    assertEquals(sourceReads, 2);
  });

  it("stabilizes a non-callable inherited toJSON accessor", () => {
    let returnHook = false;
    const prototype = {};
    Object.defineProperty(prototype, "toJSON", {
      get() {
        return returnHook ? () => "mutated-hook" : undefined;
      },
    });
    const value = Object.assign(Object.create(prototype), { name: "original" });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("non-callable-inherited-to-json"),
      context: { input: { value } },
    });
    returnHook = true;

    assertEquals(JSON.stringify(snapshot.context.input), '{"value":{"name":"original"}}');
  });

  it("snapshots a native object's custom toJSON result", () => {
    const date = new Date(0) as Date & { tag: string };
    Object.defineProperty(date, "tag", {
      configurable: true,
      enumerable: true,
      value: "original",
      writable: true,
    });
    Object.defineProperty(date, "toJSON", {
      configurable: true,
      value(this: Date & { tag: string }) {
        return this.tag;
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("custom-native-to-json"),
      context: { input: { date } },
    });
    date.tag = "mutated";

    assertEquals(JSON.stringify(snapshot.context.input), '{"date":"original"}');
  });

  it("preserves property keys for a shared custom toJSON value", () => {
    const date = new Date(0);
    Object.defineProperty(date, "toJSON", {
      configurable: true,
      value(key: string) {
        return key;
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("shared-custom-to-json"),
      context: { input: { first: date, second: date } },
    });

    assertEquals(
      JSON.stringify(snapshot.context.input),
      '{"first":"first","second":"second"}',
    );
  });

  it("preserves own data when toJSON returns its receiver", () => {
    const value = {
      name: "original",
      toJSON() {
        return this;
      },
    };

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("self-to-json"),
      context: { input: { value } },
    });
    value.name = "mutated";

    assertEquals(JSON.stringify(snapshot.context.input), '{"value":{"name":"original"}}');
  });

  it("snapshots callable toJSON hooks before asynchronous persistence", () => {
    const callable = function () {} as (() => void) & { toJSON?: () => unknown };
    callable.toJSON = () => "original";

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("callable-to-json"),
      context: { input: { callable } },
    });
    callable.toJSON = () => "mutated";

    assertEquals(JSON.stringify(snapshot.context.input), '{"callable":"original"}');
  });

  it("keeps callable values omitted when a hook is added after the snapshot", () => {
    const callable = function () {} as (() => void) & { toJSON?: () => unknown };

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("callable-without-to-json"),
      context: { input: { callable } },
    });
    callable.toJSON = () => "mutated";

    assertEquals(JSON.stringify(snapshot.context.input), "{}");
  });

  it("reads a callable value's non-callable toJSON accessor once", () => {
    let reads = 0;
    const callable = function () {};
    Object.defineProperty(callable, "toJSON", {
      configurable: true,
      enumerable: true,
      get() {
        reads++;
        return "not-callable";
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("callable-non-hook"),
      context: { input: { callable } },
    });

    assertEquals(reads, 1);
    assertEquals(JSON.stringify(snapshot.context.input), "{}");
  });

  it("terminates a self-returning toJSON value with an enumerable self reference", () => {
    const value: Record<string, unknown> & { toJSON(): unknown } = {
      name: "original",
      toJSON() {
        return this;
      },
    };
    value.self = value;

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("self-to-json-cycle"),
      context: { input: { value } },
    });

    assertThrows(
      () => JSON.stringify(snapshot.context.input),
      TypeError,
    );
  });

  it("reapplies a direct self-returning hook before nested cycle detection", () => {
    let firstCall = true;
    const value: Record<string, unknown> & { toJSON(): unknown } = {
      toJSON() {
        if (firstCall) {
          firstCall = false;
          return this;
        }
        return "again";
      },
    };
    value.self = value;

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("direct-self-then-primitive"),
      context: { input: { value } },
    });

    assertEquals(JSON.stringify(snapshot.context.input), '{"value":{"self":"again"}}');
  });

  it("reapplies toJSON to a nested source reference in a hook replacement", () => {
    let firstCall = true;
    const value = {
      toJSON(): unknown {
        if (firstCall) {
          firstCall = false;
          return { self: value };
        }
        return "again";
      },
    };

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("nested-source-hook"),
      context: { input: { value } },
    });

    assertEquals(JSON.stringify(snapshot.context.input), '{"value":{"self":"again"}}');
  });

  it("bounds recursive nested source replacements from toJSON", () => {
    const value = {
      toJSON(): unknown {
        return { self: value };
      },
    };

    assertThrows(
      () =>
        cloneCheckpointForPersistence({
          ...checkpoint("recursive-nested-source-hook"),
          context: { input: { value } },
        }),
      VeryfrontError,
      "checkpoint toJSON replacements exceed the stack-safe nesting limit",
    );
  });

  it("does not reapply toJSON on a hook replacement", () => {
    let replacementCalls = 0;
    const replacement = {
      name: "original",
      toJSON() {
        replacementCalls++;
        return "wrong";
      },
    };
    const source = {
      toJSON() {
        return replacement;
      },
    };

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("replacement-to-json"),
      context: { input: { source } },
    });
    replacement.name = "mutated";

    assertEquals(
      JSON.stringify(snapshot.context.input),
      '{"source":{"name":"original"}}',
    );
    assertEquals(replacementCalls, 0);
  });

  it("keeps default-mode proxy data persistable while preserving its strict diagnostic", async () => {
    const source = { value: 7 };
    const proxied = new Proxy(source, {
      get(target, key, receiver) {
        if (key === "value") return Reflect.get(target, key, receiver) * 2;
        return Reflect.get(target, key, receiver);
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("proxy"),
      context: { input: { proxied } },
    });
    source.value = 9;

    const snapshotProxy = (snapshot.context.input as { proxied: object }).proxied;
    assertEquals(snapshot.context.input, { proxied: { value: 14 } });
    assertEquals(snapshotProxy === proxied, false);
    await assertRejects(
      () => new MemoryBackend({ strictContext: true }).saveCheckpoint("proxy", snapshot),
      Error,
      "strictContext",
    );
  });

  it("snapshots a proxy's dynamic toJSON result", () => {
    const source = { value: "original" };
    const proxied = new Proxy(source, {
      get(target, key, receiver) {
        if (key === "toJSON") return () => target.value;
        return Reflect.get(target, key, receiver);
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("proxy-to-json"),
      context: { input: { proxied } },
    });
    source.value = "mutated";

    assertEquals(JSON.stringify(snapshot.context.input), '{"proxied":"original"}');
  });

  it("detaches JSON-visible data on an opaque native value", () => {
    const weakRef = new WeakRef({});
    Object.defineProperty(weakRef, "tag", {
      configurable: true,
      enumerable: true,
      value: "original",
      writable: true,
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("opaque-native"),
      context: { input: { weakRef } },
    });
    (weakRef as WeakRef<object> & { tag: string }).tag = "mutated";

    assertEquals(JSON.stringify(snapshot.context.input), '{"weakRef":{"tag":"original"}}');
  });

  it("snapshots proxy arrays without enumerating their keys", () => {
    let ownKeysCalls = 0;
    const proxied = new Proxy([1, 2, 3], {
      ownKeys() {
        ownKeysCalls++;
        throw new Error("proxy array keys must not be enumerated");
      },
    });

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("proxy-array"),
      context: { input: { proxied } },
    });

    assertEquals(snapshot.context.input, { proxied: [1, 2, 3] });
    assertEquals(ownKeysCalls, 0);
  });

  it("defers oversized proxy-array persistence failure without reading indices", async () => {
    let indexReads = 0;
    const values = new Proxy([], {
      get(target, key, receiver) {
        if (key === "length") return 1_000_000_000_000;
        if (typeof key === "string" && /^\d+$/.test(key)) indexReads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("oversized-proxy-array"),
      context: { input: { values } },
    });
    assertEquals(indexReads, 0);

    const backend = new MemoryBackend();
    await backend.createRun(run("oversized-proxy-array", "worker-current"));
    assertEquals(
      await backend.saveCheckpointIfStatusAndWorker(
        "stale-oversized-proxy-array",
        "oversized-proxy-array",
        ["running"],
        "worker-stale",
        snapshot,
      ),
      false,
    );
    assertEquals(indexReads, 0);
    await assertRejects(
      () =>
        backend.saveCheckpointIfStatusAndWorker(
          "accepted-oversized-proxy-array",
          "oversized-proxy-array",
          ["running"],
          "worker-current",
          snapshot,
        ),
      Error,
      "proxy array",
    );
    assertEquals(indexReads, 0);
  });

  it("preserves array prototype diagnostics and snapshots inherited indices", async () => {
    let inheritedValue = "original";
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "0", {
      configurable: true,
      get() {
        return inheritedValue;
      },
    });
    const values: unknown[] = [];
    values.length = 1;
    Object.setPrototypeOf(values, prototype);

    const snapshot = cloneCheckpointForPersistence({
      ...checkpoint("array-prototype"),
      context: { input: { values } },
    });
    inheritedValue = "mutated";

    assertEquals(JSON.stringify(snapshot.context.input), '{"values":["original"]}');
    await assertRejects(
      () =>
        new MemoryBackend({ strictContext: true }).saveCheckpoint(
          "array-prototype",
          snapshot,
        ),
      Error,
      "strictContext",
    );
  });

  it("appends a detached snapshot below the shared bound", () => {
    const history = [checkpoint("first")];
    const second = checkpoint("second");

    appendRetainedCheckpoint(history, second);

    assertEquals(history.map(({ id }) => id), ["first", "second"]);
    second.id = "mutated-source";
    assertEquals(history.at(-1)?.id, "second");
  });

  it("evicts the oldest entries once the bound is reached", () => {
    const history = Array.from(
      { length: MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES + 7 },
      (_, index) => checkpoint(`old-${index}`),
    );

    appendRetainedCheckpoint(history, checkpoint("newest"));

    assertEquals(history.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
    assertEquals(history[0]?.id, "old-8");
    assertEquals(history.at(-1)?.id, "newest");
  });

  it("leaves existing history unchanged when checkpoint capture fails", () => {
    const history = [checkpoint("stable")];
    const invalid = checkpoint("invalid");
    invalid.context.uncloneable = () => undefined;

    assertThrows(() => appendRetainedCheckpoint(history, invalid));
    assertEquals(history.map(({ id }) => id), ["stable"]);
  });

  it("deletes duplicate IDs by oldest occurrence rather than Set membership", () => {
    const history = [
      checkpoint("same", "old"),
      checkpoint("keep", "middle"),
      checkpoint("same", "new"),
    ];

    assertEquals(identify(deleteOldestCheckpointOccurrences(history, ["same"])), [
      { id: "keep", nodeId: "middle" },
      { id: "same", nodeId: "new" },
    ]);
  });

  it("deletes one occurrence per requested ID", () => {
    const history = [
      checkpoint("same", "old"),
      checkpoint("same", "middle"),
      checkpoint("same", "new"),
    ];

    assertEquals(identify(deleteOldestCheckpointOccurrences(history, ["same", "same"])), [
      { id: "same", nodeId: "new" },
    ]);
  });

  it("bounds unconditional MemoryBackend appends at the shared limit", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("unconditional"));
    for (let index = 0; index <= MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES; index++) {
      await backend.saveCheckpoint("unconditional", checkpoint(`cp-${index}`));
    }

    const retained = await backend.getCheckpoints("unconditional");
    assertEquals(retained.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
    assertEquals(retained[0]?.id, "cp-1");
    assertEquals(retained.at(-1)?.id, `cp-${MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES}`);
    assertEquals((await backend.getLatestCheckpoint("unconditional"))?.id, retained.at(-1)?.id);
  });

  it("bounds owned MemoryBackend appends and leaves failed fences unchanged", async () => {
    const backend = new MemoryBackend();
    const workerId = "run-execution:retention-owner";
    await backend.createRun(run("owned", workerId));
    for (let index = 0; index <= MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES; index++) {
      assertEquals(
        await backend.saveCheckpointIfStatusAndWorker(
          "owned",
          "owned",
          ["running"],
          workerId,
          checkpoint(`owned-${index}`),
        ),
        true,
      );
    }
    const beforeFailedFence = await backend.getCheckpoints("owned");

    assertEquals(
      await backend.saveCheckpointIfStatusAndWorker(
        "owned",
        "owned",
        ["running"],
        "run-execution:stale-owner",
        checkpoint("must-not-append"),
      ),
      false,
    );
    assertEquals(await backend.getCheckpoints("owned"), beforeFailedFence);
    assertEquals(beforeFailedFence.length, MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES);
    assertEquals(beforeFailedFence[0]?.id, "owned-1");
  });

  it("saves and reads deep MemoryBackend checkpoints without recursive cloning", async () => {
    const backend = new MemoryBackend();
    const depth = 4000;
    const workerId = "run-execution:deep-checkpoint-owner";
    await backend.createRun(run("deep-checkpoint", workerId));

    await backend.saveCheckpoint("deep-checkpoint", {
      ...checkpoint("deep-unconditional"),
      context: deepCheckpointContext(depth),
      nodeStates: deepNodeStates("deep-unconditional", depth),
      _resumeEnvelope: deepResumeEnvelope("deep-unconditional", depth),
    });
    const latest = await backend.getLatestCheckpoint("deep-checkpoint");
    assertEquals(
      deepLeaf(latest?.context.deep, depth),
      "stored",
    );
    assertEquals(
      deepLeaf(latest?.nodeStates["deep-unconditional"]?.output, depth),
      "stored",
    );
    assertEquals(
      deepLeaf(latest?._resumeEnvelope?.context.deep, depth),
      "stored",
    );
    assertEquals(
      deepLeaf(
        latest?._resumeEnvelope?.graphAdmission.stepsEvaluationContext.deep,
        depth,
      ),
      "stored",
    );

    assertEquals(
      await backend.saveCheckpointIfStatusAndWorker(
        "deep-owned-checkpoint",
        "deep-checkpoint",
        ["running"],
        workerId,
        {
          ...checkpoint("deep-owned"),
          context: deepCheckpointContext(depth),
          nodeStates: deepNodeStates("deep-owned", depth),
          _resumeEnvelope: deepResumeEnvelope("deep-owned", depth),
        },
      ),
      true,
    );
    const [owned] = await backend.getCheckpoints("deep-owned-checkpoint");
    assertEquals(deepLeaf(owned?.context.deep, depth), "stored");
    assertEquals(deepLeaf(owned?.nodeStates["deep-owned"]?.output, depth), "stored");
    assertEquals(
      deepLeaf(owned?._resumeEnvelope?.nodeStates["deep-owned"]?.output, depth),
      "stored",
    );
  });

  it("removes only the older twin when a duplicate ID is deleted once", async () => {
    const backend = new MemoryBackend();
    await backend.createRun(run("duplicate-id"));
    await backend.saveCheckpoint("duplicate-id", checkpoint("same", "old"));
    await backend.saveCheckpoint("duplicate-id", checkpoint("keep", "middle"));
    await backend.saveCheckpoint("duplicate-id", checkpoint("same", "new"));

    await backend.deleteCheckpoints("duplicate-id", ["same"]);

    assertEquals(identify(await backend.getCheckpoints("duplicate-id")), [
      { id: "keep", nodeId: "middle" },
      { id: "same", nodeId: "new" },
    ]);
  });
});
