import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  PROJECT_ENV_SNAPSHOT_LIMITS as PLATFORM_PROJECT_ENV_SNAPSHOT_LIMITS,
} from "#veryfront/platform/compat/process/project-env-contract.ts";
import {
  createProjectEnvSnapshot,
  PROJECT_ENV_SNAPSHOT_LIMITS,
  ProjectEnvSnapshotError,
  type ProjectEnvSnapshotErrorCode,
} from "./snapshot.ts";

function assertSnapshotError(
  value: unknown,
  code: ProjectEnvSnapshotErrorCode,
): ProjectEnvSnapshotError {
  const error = assertThrows(
    () => createProjectEnvSnapshot(value),
    ProjectEnvSnapshotError,
  ) as ProjectEnvSnapshotError;
  assertEquals(error.code, code);
  return error;
}

describe("server/project-env/snapshot", () => {
  it("creates a sorted, detached, immutable null-prototype snapshot", () => {
    const input = { Z_LAST: "z", A_FIRST: "a" };
    const snapshot = createProjectEnvSnapshot(input);

    assertEquals(snapshot, { A_FIRST: "a", Z_LAST: "z" });
    assertEquals(Reflect.ownKeys(snapshot), ["A_FIRST", "Z_LAST"]);
    assertEquals(Object.getPrototypeOf(snapshot), null);
    assertEquals(Object.isFrozen(snapshot), true);

    input.A_FIRST = "mutated";
    assertEquals(snapshot.A_FIRST, "a");
    assertThrows(() => Object.defineProperty(snapshot, "NEW", { value: "value" }), TypeError);
  });

  it("accepts null-prototype records and pollution-prone names as inert data", () => {
    const input = Object.create(null) as Record<string, string>;
    Object.defineProperty(input, "__proto__", {
      value: "data",
      enumerable: true,
    });
    input["constructor"] = "also-data";

    const snapshot = createProjectEnvSnapshot(input);
    assertEquals(snapshot.__proto__, "data");
    assertEquals(snapshot["constructor"], "also-data");
    assertEquals(Object.getPrototypeOf(snapshot), null);
  });

  it("rejects accessors without invoking them", () => {
    let calls = 0;
    const input = Object.create(null);
    Object.defineProperty(input, "SECRET", {
      enumerable: true,
      get() {
        calls += 1;
        return "leaked";
      },
    });

    assertSnapshotError(input, "accessor-property");
    assertEquals(calls, 0);
  });

  it("rejects accessors when Object.prototype.value is polluted", () => {
    let inputGetterCalls = 0;
    let poisonGetterCalls = 0;
    const input = Object.create(null);
    Object.defineProperty(input, "SECRET", {
      enumerable: true,
      get() {
        inputGetterCalls += 1;
        return "leaked";
      },
    });

    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let failure: unknown;
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      get() {
        poisonGetterCalls += 1;
        return "polluted";
      },
    });
    try {
      createProjectEnvSnapshot(input);
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "value", previous);
      else delete (Object.prototype as Record<string, unknown>).value;
    }

    assertEquals(failure instanceof ProjectEnvSnapshotError, true);
    assertEquals((failure as ProjectEnvSnapshotError).code, "accessor-property");
    assertEquals(inputGetterCalls, 0);
    assertEquals(poisonGetterCalls, 0);
  });

  it("builds output safely under descriptor and array-prototype pollution", () => {
    const previousGet = Object.getOwnPropertyDescriptor(Object.prototype, "get");
    const previousIndex = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let setterCalls = 0;
    let snapshot: Record<string, string> | undefined;
    let failure: unknown;

    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      set() {
        setterCalls += 1;
      },
    });
    Object.defineProperty(Object.prototype, "get", {
      configurable: true,
      get() {
        throw new Error("descriptor prototype must not be read");
      },
    });
    try {
      snapshot = createProjectEnvSnapshot({ SAFE: "value" });
    } catch (error) {
      failure = error;
    } finally {
      if (previousGet) Object.defineProperty(Object.prototype, "get", previousGet);
      else delete (Object.prototype as Record<string, unknown>).get;
      if (previousIndex) Object.defineProperty(Array.prototype, "0", previousIndex);
      else delete (Array.prototype as unknown as Record<string, unknown>)["0"];
    }

    if (failure) throw failure;
    assertEquals(snapshot, { SAFE: "value" });
    assertEquals(setterCalls, 0);
  });

  it("rejects custom prototypes, arrays, symbols, and hidden properties", () => {
    assertSnapshotError([], "invalid-prototype");
    assertSnapshotError(Object.create({ inherited: "value" }), "invalid-prototype");

    const symbol = { SAFE: "value" };
    Object.defineProperty(symbol, Symbol("hidden"), {
      value: "value",
      enumerable: true,
    });
    assertSnapshotError(symbol, "symbol-key");

    const hidden = { SAFE: "value" };
    Object.defineProperty(hidden, "HIDDEN", {
      value: "value",
      enumerable: false,
    });
    assertSnapshotError(hidden, "non-enumerable-property");
  });

  it("rejects invalid keys and values", () => {
    for (const key of ["", "BAD=KEY", "BAD\0KEY"]) {
      const input = Object.create(null) as Record<string, string>;
      input[key] = "value";
      assertSnapshotError(input, "invalid-key");
    }

    for (const value of [null, 1, true, undefined, "BAD\0VALUE"]) {
      const input = Object.create(null) as Record<string, unknown>;
      input.KEY = value;
      assertSnapshotError(input, "invalid-value");
    }

    assertSnapshotError({
      KEY: `${"x".repeat(PROJECT_ENV_SNAPSHOT_LIMITS.maxValueChars + 1)}\0`,
    }, "max-value-length-exceeded");
  });

  it("enforces entry, key, value, and aggregate byte limits", () => {
    const tooMany = Object.create(null) as Record<string, string>;
    for (let index = 0; index <= PROJECT_ENV_SNAPSHOT_LIMITS.maxEntries; index += 1) {
      tooMany[`KEY_${index}`] = "value";
    }
    assertSnapshotError(tooMany, "max-entries-exceeded");

    const longKey = Object.create(null) as Record<string, string>;
    longKey["K".repeat(PROJECT_ENV_SNAPSHOT_LIMITS.maxKeyChars + 1)] = "value";
    assertSnapshotError(longKey, "max-key-length-exceeded");

    assertSnapshotError({
      KEY: "v".repeat(PROJECT_ENV_SNAPSHOT_LIMITS.maxValueChars + 1),
    }, "max-value-length-exceeded");

    assertSnapshotError({
      FIRST: "é".repeat(PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes / 2),
      SECOND: "value",
    }, "max-total-bytes-exceeded");
  });

  it("uses the captured typed-array byte length for aggregate limits", () => {
    const previous = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "byteLength");
    let failure: unknown;
    Object.defineProperty(Uint8Array.prototype, "byteLength", {
      configurable: true,
      get: () => 0,
    });
    try {
      createProjectEnvSnapshot({
        FIRST: "a".repeat(700_000),
        SECOND: "b".repeat(700_000),
      });
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(Uint8Array.prototype, "byteLength", previous);
      else delete (Uint8Array.prototype as unknown as Record<string, unknown>).byteLength;
    }

    assertEquals(failure instanceof ProjectEnvSnapshotError, true);
    assertEquals((failure as ProjectEnvSnapshotError).code, "max-total-bytes-exceeded");
  });

  it("normalizes revoked proxies and integer-like key ordering", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assertSnapshotError(proxy, "inspection-failed");

    const input = Object.create(null) as Record<string, string>;
    input["10"] = "ten";
    input["2"] = "two";
    input.ALPHA = "last";
    assertEquals(Reflect.ownKeys(createProjectEnvSnapshot(input)), [
      "2",
      "10",
      "ALPHA",
    ]);
  });

  it("keeps its fixed limits immutable", () => {
    assertStrictEquals(
      PROJECT_ENV_SNAPSHOT_LIMITS,
      PLATFORM_PROJECT_ENV_SNAPSHOT_LIMITS,
    );
    assertEquals(Object.isFrozen(PROJECT_ENV_SNAPSHOT_LIMITS), true);
    assertThrows(
      () =>
        Object.defineProperty(PROJECT_ENV_SNAPSHOT_LIMITS, "maxEntries", {
          value: Number.MAX_SAFE_INTEGER,
        }),
      TypeError,
    );
  });
});
