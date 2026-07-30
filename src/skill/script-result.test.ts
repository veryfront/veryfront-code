import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { SKILL_SCRIPT_MAX_OUTPUT_BYTES } from "./limits.ts";
import { snapshotSkillScriptResult } from "./script-result.ts";

Deno.test("skill script result snapshots a detached, frozen exact result", () => {
  const source = { stdout: "ok\n", stderr: "warning\n", exitCode: 7 };
  const snapshot = snapshotSkillScriptResult(source);
  source.stdout = "mutated";
  source.exitCode = 99;

  assertEquals(snapshot, {
    stdout: "ok\n",
    stderr: "warning\n",
    exitCode: 7,
  });
  assertEquals(Object.isFrozen(snapshot), true);
  assertEquals(snapshot === source, false);
});

Deno.test("skill script result rejects hostile shapes without invoking traps or accessors", () => {
  let getterCalls = 0;
  const accessor = Object.defineProperties({}, {
    stdout: {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "secret";
      },
    },
    stderr: { enumerable: true, value: "" },
    exitCode: { enumerable: true, value: 0 },
  });
  assertThrows(
    () => snapshotSkillScriptResult(accessor),
    TypeError,
    "data property",
  );

  let trapCalls = 0;
  const proxy = new Proxy(
    { stdout: "", stderr: "", exitCode: 0 },
    {
      ownKeys(target) {
        trapCalls += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        trapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  assertThrows(
    () => snapshotSkillScriptResult(proxy),
    TypeError,
    "must not be a proxy",
  );

  assertThrows(
    () => snapshotSkillScriptResult({ stdout: "", stderr: "" }),
    TypeError,
    "contain only",
  );
  assertThrows(
    () => snapshotSkillScriptResult({ stdout: "", stderr: "", exitCode: 0, pid: 1 }),
    TypeError,
    "contain only",
  );
  assertThrows(
    () =>
      snapshotSkillScriptResult(
        Object.assign(Object.create({ inherited: true }), {
          stdout: "",
          stderr: "",
          exitCode: 0,
        }),
      ),
    TypeError,
    "plain object",
  );
  assertEquals(getterCalls, 0);
  assertEquals(trapCalls, 0);
});

Deno.test("skill script result validates field types, Unicode, and combined UTF-8 bytes", () => {
  assertThrows(
    () => snapshotSkillScriptResult({ stdout: 1, stderr: "", exitCode: 0 }),
    TypeError,
    "must be strings",
  );
  assertThrows(
    () => snapshotSkillScriptResult({ stdout: "", stderr: "", exitCode: 1.5 }),
    TypeError,
    "safe integer",
  );
  assertThrows(
    () => snapshotSkillScriptResult({ stdout: "\ud800", stderr: "", exitCode: 0 }),
    TypeError,
    "well-formed UTF-16",
  );

  const exact = snapshotSkillScriptResult({
    stdout: "x".repeat(SKILL_SCRIPT_MAX_OUTPUT_BYTES - 4),
    stderr: "😀",
    exitCode: 0,
  });
  assertEquals(exact.stderr, "😀");
  assertThrows(
    () =>
      snapshotSkillScriptResult({
        stdout: "x".repeat(SKILL_SCRIPT_MAX_OUTPUT_BYTES - 3),
        stderr: "😀",
        exitCode: 0,
      }),
    RangeError,
    "output must total",
  );
});

Deno.test("skill script result validation is independent of later built-in mutation", () => {
  const targets = [
    [Object, "freeze"],
    [Object, "getOwnPropertyDescriptors"],
    [Object, "getPrototypeOf"],
    [Object.prototype, "hasOwnProperty"],
    [Reflect, "ownKeys"],
    [String.prototype, "charCodeAt"],
    [Number, "isSafeInteger"],
  ] as const;
  const originals = targets.map(([target, property]) =>
    Object.getOwnPropertyDescriptor(target, property)
  );
  let hookCalls = 0;
  let snapshot: ReturnType<typeof snapshotSkillScriptResult> | undefined;

  try {
    for (const [target, property] of targets) {
      Object.defineProperty(target, property, {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("mutated built-in must not run");
        },
        writable: true,
      });
    }
    snapshot = snapshotSkillScriptResult({ stdout: "ok", stderr: "", exitCode: 0 });
  } finally {
    targets.forEach(([target, property], index) => {
      const descriptor = originals[index];
      if (descriptor) Object.defineProperty(target, property, descriptor);
    });
  }

  assertEquals(hookCalls, 0);
  assertEquals(snapshot, { stdout: "ok", stderr: "", exitCode: 0 });
  assertStrictEquals(Object.isFrozen(snapshot), true);
});
