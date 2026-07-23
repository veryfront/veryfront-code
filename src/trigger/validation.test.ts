import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { isTriggerTarget, snapshotTriggerTarget } from "./target.ts";
import { assertSerializable, snapshotSerializable, validateTriggerId } from "./validation.ts";

describe("trigger validation", () => {
  it("accepts bounded trigger ids and rejects ambiguous path segments", () => {
    validateTriggerId("daily-triage/v2.1", "Trigger");

    for (
      const id of [
        "",
        "Daily-Triage",
        "daily//triage",
        "daily/../triage",
        "daily/./triage",
        "daily-triage/",
        "a".repeat(256),
      ]
    ) {
      assertThrows(
        () => validateTriggerId(id, "Trigger"),
        VeryfrontError,
        "Trigger id",
      );
    }
  });

  it("creates a detached, prototype-safe snapshot of JSON input", () => {
    const nested = { enabled: true };
    const input = Object.create(null) as Record<string, unknown>;
    input.items = [nested];
    Object.defineProperty(input, "__proto__", {
      enumerable: true,
      value: { polluted: false },
    });

    const snapshot = snapshotSerializable(input, "Trigger input");

    assertEquals(Object.getPrototypeOf(snapshot), null);
    assertEquals(Object.keys(snapshot).sort(), ["__proto__", "items"]);
    assertEquals(snapshot.items, [{ enabled: true }]);
    assertEquals(snapshot.__proto__, { polluted: false });
    assertNotStrictEquals(snapshot, input);
    assertNotStrictEquals((snapshot.items as unknown[])[0], nested);
  });

  it("rejects lossy or unbounded values without invoking accessors", () => {
    let reads = 0;
    const accessorBacked = {};
    Object.defineProperty(accessorBacked, "secret", {
      enumerable: true,
      get() {
        reads += 1;
        return "must-not-run";
      },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const decoratedArray = [1];
    Object.defineProperty(decoratedArray, "metadata", {
      enumerable: true,
      value: "must-not-be-dropped",
    });
    const symbolDecoratedArray = [1];
    Object.defineProperty(symbolDecoratedArray, Symbol("metadata"), {
      enumerable: true,
      value: "must-not-be-dropped",
    });
    const accessorDecoratedArray = [1];
    Object.defineProperty(accessorDecoratedArray, "metadata", {
      enumerable: true,
      get() {
        reads += 1;
        return "must-not-run";
      },
    });

    for (
      const value of [
        accessorBacked,
        decoratedArray,
        symbolDecoratedArray,
        accessorDecoratedArray,
        cyclic,
        new Array(1),
        { missing: undefined },
        [undefined],
        Number.NaN,
        Number.POSITIVE_INFINITY,
        new Date(),
        1n,
      ]
    ) {
      assertThrows(
        () => assertSerializable(value, "Trigger input"),
        VeryfrontError,
        "must be JSON-serializable",
      );
    }
    assertEquals(reads, 0);

    let tooDeep: unknown = true;
    for (let index = 0; index < 70; index++) tooDeep = { child: tooDeep };
    assertThrows(
      () => assertSerializable(tooDeep, "Trigger input"),
      VeryfrontError,
      "exceeds the maximum depth",
    );
  });

  it("validates snapshot limits without invoking option accessors", () => {
    let reads = 0;
    const options = {};
    Object.defineProperty(options, "maxNodes", {
      enumerable: true,
      get() {
        reads += 1;
        return 10;
      },
    });

    const accessorError = assertThrows(
      () => snapshotSerializable({}, "Trigger input", options as never),
      VeryfrontError,
    );
    assertEquals(accessorError.slug, "trigger-config-invalid");
    assertEquals(reads, 0);

    const { proxy: revokedOptions, revoke } = Proxy.revocable({}, {});
    revoke();
    const revokedError = assertThrows(
      () => snapshotSerializable({}, "Trigger input", revokedOptions as never),
      VeryfrontError,
    );
    assertEquals(revokedError.slug, "trigger-config-invalid");

    for (
      const [path, limits] of [
        ["", {}],
        ["Trigger\ninput", {}],
        ["Trigger input", { maxDepth: -1 }],
        ["Trigger input", { maxNodes: 0 }],
        ["Trigger input", { maxCodeUnits: Number.POSITIVE_INFINITY }],
        ["Trigger input", { maxDepth: 65 }],
        ["Trigger input", { maxNodes: 10_001 }],
        ["Trigger input", { maxCodeUnits: 1_048_577 }],
      ] as const
    ) {
      const error = assertThrows(
        () => snapshotSerializable({}, path, limits),
        VeryfrontError,
      );
      assertEquals(error.slug, "trigger-config-invalid");
    }
  });
});

describe("trigger targets", () => {
  it("validates and snapshots exact task, workflow, and agent targets", () => {
    const target = { kind: "workflow", id: "daily/triage" } as const;
    const snapshot = snapshotTriggerTarget(target);

    assertEquals(snapshot, target);
    assertNotStrictEquals(snapshot, target);
    assertEquals(isTriggerTarget(target), true);
  });

  it("rejects malformed targets without invoking accessors", () => {
    let reads = 0;
    const accessorBacked = Object.create(null);
    Object.defineProperty(accessorBacked, "kind", {
      enumerable: true,
      value: "workflow",
    });
    Object.defineProperty(accessorBacked, "id", {
      enumerable: true,
      get() {
        reads += 1;
        return "daily-triage";
      },
    });
    const { proxy: revokedProxy, revoke } = Proxy.revocable({}, {});
    revoke();

    for (
      const value of [
        accessorBacked,
        revokedProxy,
        { kind: "workflow", id: "daily/../triage" },
        { kind: "queue", id: "daily-triage" },
        { kind: "workflow", id: "daily-triage", token: "unsupported" },
      ]
    ) {
      assertEquals(snapshotTriggerTarget(value), undefined);
      assertEquals(isTriggerTarget(value), false);
    }
    assertEquals(reads, 0);
  });
});
