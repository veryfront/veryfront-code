import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { TriggerTarget } from "./target.ts";
import { isTriggerTarget, snapshotTriggerTarget } from "./target.ts";
import { assertSerializable, isTriggerId, snapshotSerializable } from "./validation.ts";

describe("trigger validation", () => {
  it("keeps the public TriggerTarget contract extendable", () => {
    interface CustomTarget extends TriggerTarget {
      metadata: string;
    }

    const target: CustomTarget = {
      kind: "agent",
      id: "support-agent",
      metadata: "owned-by-consumer",
    };

    assertEquals(target.metadata, "owned-by-consumer");
  });

  it("recognizes only canonical trigger identifiers", () => {
    for (const id of ["daily-triage", "billing.sync/v2", "0_internal"]) {
      assertEquals(isTriggerId(id), true);
    }
    for (
      const id of [
        "",
        "Daily Triage",
        " leading",
        "trailing ",
        "daily//triage",
        "daily/../triage",
        "daily/.hidden",
        "daily/",
        "a".repeat(257),
        42,
        null,
      ]
    ) {
      assertEquals(isTriggerId(id), false);
    }
  });

  it("recognizes only own, data-only target fields with canonical ids", () => {
    assertEquals(isTriggerTarget({ kind: "task", id: "daily-triage" }), true);
    assertEquals(isTriggerTarget({ kind: "workflow", id: "billing/sync" }), true);
    assertEquals(isTriggerTarget({ kind: "agent", id: "support-agent" }), true);

    const inherited = Object.create({ kind: "task", id: "daily-triage" });
    const accessor = Object.defineProperties({}, {
      kind: { enumerable: true, get: () => "task" },
      id: { enumerable: true, get: () => "daily-triage" },
    });
    const hostileProxy = new Proxy({}, {
      getOwnPropertyDescriptor(): never {
        throw new Error("descriptor trap must not escape");
      },
    });

    for (
      const target of [
        inherited,
        accessor,
        hostileProxy,
        { kind: "queue", id: "daily-triage" },
        { kind: "task", id: "daily/../triage" },
      ]
    ) {
      assertEquals(isTriggerTarget(target), false);
    }
  });

  it("carries agent conversation addressing on canonical targets", () => {
    assertEquals(
      snapshotTriggerTarget({
        kind: "agent",
        id: "support-agent",
        conversationMode: "create_new",
      }),
      { kind: "agent", id: "support-agent", conversationMode: "create_new" },
    );
    assertEquals(
      snapshotTriggerTarget({
        kind: "agent",
        id: "support-agent",
        conversationMode: "existing",
        conversationId: "11111111-1111-4111-8111-111111111111",
      }),
      {
        kind: "agent",
        id: "support-agent",
        conversationMode: "existing",
        conversationId: "11111111-1111-4111-8111-111111111111",
      },
    );
    assertEquals(snapshotTriggerTarget({ kind: "task", id: "sync-helpdesk" }), {
      kind: "task",
      id: "sync-helpdesk",
    });
  });

  it("rejects unknown keys and broken agent conversation invariants", () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const accessorMode = Object.defineProperties(
      { kind: "agent", id: "support-agent" },
      { conversationMode: { enumerable: true, get: () => "create_new" } },
    );

    for (
      const target of [
        { kind: "agent", id: "support-agent", unsupported: true },
        { kind: "task", id: "sync-helpdesk", conversationMode: "create_new" },
        { kind: "workflow", id: "billing/sync", conversationId },
        { kind: "agent", id: "support-agent", conversationMode: "resume" },
        { kind: "agent", id: "support-agent", conversationMode: "existing" },
        { kind: "agent", id: "support-agent", conversationMode: "create_new", conversationId },
        {
          kind: "agent",
          id: "support-agent",
          conversationMode: "existing",
          conversationId: "not-a-uuid",
        },
        accessorMode,
      ]
    ) {
      assertEquals(isTriggerTarget(target), false);
    }
  });

  it("accepts finite JSON data and repeated non-cyclic references", () => {
    const shared = { enabled: true };
    assertSerializable({
      string: "value",
      number: 42,
      boolean: false,
      nullable: null,
      list: [shared, shared],
    });
    assertSerializable(undefined);
  });

  it("returns a bounded data-only snapshot instead of retaining caller-owned input", () => {
    const input = { nested: { enabled: true } };
    const snapshot = snapshotSerializable(input);

    input.nested.enabled = false;

    assertEquals(snapshot, { nested: { enabled: true } });
    assertEquals(snapshot === input, false);
  });

  it("rejects non-JSON structures and resource abuse with a structured error", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const customSerialization = Object.defineProperty({}, "toJSON", {
      value: () => 1n,
    });
    const sparse = new Array(2);
    sparse[1] = "present";
    const customArray = [1, 2] as number[] & { metadata?: string };
    customArray.metadata = "not JSON data";
    const symbolProperty = { value: true };
    Object.defineProperty(symbolProperty, Symbol("hidden"), {
      enumerable: true,
      value: "not JSON data",
    });
    let tooDeep: Record<string, unknown> = {};
    const deepRoot = tooDeep;
    for (let index = 0; index < 130; index++) {
      const child: Record<string, unknown> = {};
      tooDeep.next = child;
      tooDeep = child;
    }

    for (
      const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        cyclic,
        customSerialization,
        { omitted: undefined },
        sparse,
        customArray,
        symbolProperty,
        deepRoot,
      ]
    ) {
      assertThrows(
        () => assertSerializable(value),
        VeryfrontError,
        "must be JSON-serializable",
      );
    }
  });

  it("rejects hostile reflection without executing accessors", () => {
    let getterCalls = 0;
    const throwingGetter = Object.defineProperty({}, "secret", {
      enumerable: true,
      get(): never {
        getterCalls++;
        throw new Error("getter must not escape");
      },
    });
    const throwingPrototype = new Proxy({}, {
      getPrototypeOf(): never {
        throw new Error("prototype trap must not escape");
      },
    });

    for (const value of [throwingGetter, throwingPrototype]) {
      assertThrows(
        () => assertSerializable(value),
        VeryfrontError,
        "must be JSON-serializable",
      );
    }
    assertEquals(getterCalls, 0);
  });
});
