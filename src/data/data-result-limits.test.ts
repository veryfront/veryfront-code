import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDataResultWithinLimit } from "./data-result-limits.ts";

describe("data result limits", () => {
  it("measures UTF-8 bytes without allocating a serialized copy", () => {
    assertEquals(isDataResultWithinLimit("é", 2), true);
    assertEquals(isDataResultWithinLimit("é", 1), false);
    assertEquals(isDataResultWithinLimit("😀", 4), true);
    assertEquals(isDataResultWithinLimit("\ud800", 3), true);
    assertEquals(isDataResultWithinLimit("\udc00", 3), true);
  });

  it("accounts for structured-clone native values and shared references", () => {
    const buffer = new ArrayBuffer(32);
    const firstView = new Uint8Array(buffer, 0, 1);
    const secondView = new DataView(buffer, 1, 1);
    const map = new Map<unknown, unknown>([["key", { value: 1 }]]);
    const set = new Set<unknown>(["value", map]);

    assertEquals(isDataResultWithinLimit(buffer, 128), true);
    assertEquals(isDataResultWithinLimit({ firstView, secondView }, 256), true);
    assertEquals(
      isDataResultWithinLimit({
        blob: new Blob(["value"]),
        date: new Date(0),
        expression: /value/giu,
        map,
        set,
      }, 1_024),
      true,
    );
  });

  it("rejects executable values and traversal failures", () => {
    assertEquals(isDataResultWithinLimit(1n), false);
    assertEquals(isDataResultWithinLimit(() => undefined), false);
    assertEquals(isDataResultWithinLimit(Symbol("value")), false);
    assertEquals(isDataResultWithinLimit(new WeakMap()), false);
    assertEquals(isDataResultWithinLimit(new WeakSet()), false);
    assertEquals(isDataResultWithinLimit(Promise.resolve()), false);

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assertEquals(isDataResultWithinLimit(proxy), false);
  });

  it("handles cycles and shared references", () => {
    const value: Record<string, unknown> = { label: "root" };
    value.self = value;

    assertEquals(isDataResultWithinLimit(value, 1024), true);
  });

  it("does not invoke accessors while estimating a result", () => {
    let reads = 0;
    const value = Object.defineProperty({}, "payload", {
      enumerable: true,
      get() {
        reads++;
        return "private";
      },
    });

    assertEquals(isDataResultWithinLimit(value, 1024), false);
    assertEquals(reads, 0);
  });

  it("charges the complete backing buffer of array-buffer views", () => {
    const backingBuffer = new ArrayBuffer(2_048);
    const narrowView = new Uint8Array(backingBuffer, 0, 1);

    assertEquals(isDataResultWithinLimit(narrowView, 1_024), false);
    assertEquals(isDataResultWithinLimit(narrowView, 4_096), true);
  });

  it("charges shared array buffers when the runtime supports them", () => {
    if (typeof SharedArrayBuffer === "undefined") return;

    const shared = new SharedArrayBuffer(2_048);
    assertEquals(isDataResultWithinLimit(shared, 1_024), false);
    assertEquals(isDataResultWithinLimit(shared, 4_096), false);
    assertEquals(isDataResultWithinLimit(new Uint8Array(shared, 0, 1), 4_096), false);
  });

  it("rejects traversal deeper than the complexity limit", () => {
    const root: Record<string, unknown> = {};
    let current = root;
    for (let depth = 0; depth < 130; depth++) {
      const child: Record<string, unknown> = {};
      current.child = child;
      current = child;
    }

    assertEquals(isDataResultWithinLimit(root), false);
  });

  it("rejects invalid configured limits", () => {
    assertEquals(isDataResultWithinLimit({}, 0), false);
    assertEquals(isDataResultWithinLimit({}, Number.POSITIVE_INFINITY), false);
  });
});
