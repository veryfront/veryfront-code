import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  snapshotRscActionAuthorizationArgs,
  snapshotRscActionInvocationArgs,
} from "./action-authorization-snapshot.ts";

describe("RSC action argument snapshots", () => {
  it("deeply detaches and freezes authorization data without shared prototypes", () => {
    const nested = { role: "user", profile: { active: true } };
    const input = [nested, [1, 2]];

    const snapshot = snapshotRscActionAuthorizationArgs(input);
    const record = snapshot[0] as Record<string, unknown>;
    const profile = record.profile as Record<string, unknown>;
    const nestedArray = snapshot[1] as { readonly length: number };

    assertNotStrictEquals(snapshot, input);
    assertNotStrictEquals(record, nested);
    assertEquals(Object.getPrototypeOf(snapshot), null);
    assertEquals(Object.getPrototypeOf(record), null);
    assertEquals(Object.getPrototypeOf(profile), null);
    assertEquals(Object.getPrototypeOf(nestedArray), null);
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(record), true);
    assertEquals(Object.isFrozen(profile), true);
    assertEquals(Object.isFrozen(nestedArray), true);
    assertEquals(Reflect.set(record, "role", "admin"), false);

    nested.role = "owner";
    nested.profile.active = false;
    assertEquals(record.role, "user");
    assertEquals(profile.active, true);
  });

  it("iterates in order without consulting a poisoned ArrayIteratorPrototype", () => {
    const snapshot = snapshotRscActionAuthorizationArgs([{ role: "user" }, 2]);
    const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
    const originalNext = Object.getOwnPropertyDescriptor(iteratorPrototype, "next")!;
    const nativeNext = originalNext.value as () => IteratorResult<unknown>;
    const observed: unknown[] = [];
    try {
      Object.defineProperty(iteratorPrototype, "next", {
        ...originalNext,
        value(this: object) {
          const result = Reflect.apply(nativeNext, this, []) as IteratorResult<unknown>;
          if (
            !result.done && typeof result.value === "object" && result.value !== null &&
            (result.value as { role?: string }).role === "user"
          ) {
            return { done: false, value: { role: "admin" } };
          }
          return result;
        },
      });
      for (const value of snapshot) observed.push(value);
    } finally {
      Object.defineProperty(iteratorPrototype, "next", originalNext);
    }

    assertEquals((observed[0] as { role?: string }).role, "user");
    assertEquals(observed[1], 2);
  });

  it("keeps absent record properties absent under prototype pollution", () => {
    const originalRole = Object.getOwnPropertyDescriptor(Object.prototype, "role");
    Object.defineProperty(Object.prototype, "role", {
      configurable: true,
      value: "admin",
    });
    try {
      const snapshot = snapshotRscActionAuthorizationArgs([{}]);
      const record = snapshot[0] as Record<string, unknown>;
      assertEquals(record.role, undefined);
      assertEquals(Object.hasOwn(record, "role"), false);
    } finally {
      if (originalRole === undefined) Reflect.deleteProperty(Object.prototype, "role");
      else Object.defineProperty(Object.prototype, "role", originalRole);
    }
  });

  it("rejects sparse, accessor, symbol, custom-prototype, cyclic, and deep data", () => {
    const sparse = new Array(1);
    assertThrows(() => snapshotRscActionAuthorizationArgs(sparse), TypeError);

    let getterCalls = 0;
    const accessor = [{}];
    Object.defineProperty(accessor[0], "role", {
      enumerable: true,
      get() {
        getterCalls++;
        return "admin";
      },
    });
    assertThrows(() => snapshotRscActionAuthorizationArgs(accessor), TypeError);
    assertEquals(getterCalls, 0);

    const symbolRecord = { ok: true } as Record<PropertyKey, unknown>;
    symbolRecord[Symbol("hidden")] = true;
    assertThrows(() => snapshotRscActionAuthorizationArgs([symbolRecord]), TypeError);

    const customRecord = Object.create({ role: "admin" }) as Record<string, unknown>;
    customRecord.ok = true;
    assertThrows(() => snapshotRscActionAuthorizationArgs([customRecord]), TypeError);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assertThrows(() => snapshotRscActionAuthorizationArgs([cyclic]), TypeError);

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 65; index += 1) {
      const child: Record<string, unknown> = {};
      deep.child = child;
      deep = child;
    }
    assertThrows(() => snapshotRscActionAuthorizationArgs([root]), TypeError);
  });

  it("creates mutable invocation arrays with null-prototype request records", () => {
    const originalRole = Object.getOwnPropertyDescriptor(Object.prototype, "role");
    Object.defineProperty(Object.prototype, "role", {
      configurable: true,
      value: "admin",
    });
    try {
      const snapshot = snapshotRscActionInvocationArgs([{}]);
      const record = snapshot[0] as Record<string, unknown>;
      assertEquals(Object.getPrototypeOf(snapshot), Array.prototype);
      assertEquals(Object.getPrototypeOf(record), null);
      assertEquals(record.role, undefined);
      record.role = "user";
      snapshot.push("mutable");
      assertEquals(record.role, "user");
      assertEquals(snapshot[1], "mutable");
    } finally {
      if (originalRole === undefined) Reflect.deleteProperty(Object.prototype, "role");
      else Object.defineProperty(Object.prototype, "role", originalRole);
    }
  });
});
