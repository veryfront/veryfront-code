import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createIntrinsicsGuard, withPristineIntrinsics } from "./pristine-intrinsics.ts";

function original(): string {
  return "original";
}

function replacement(): string {
  return "replaced";
}

describe("schemas/pristine-intrinsics", () => {
  it("runs the callback with a replaced method put back, then re-applies the replacement", () => {
    const target: { method: () => string } = { method: original };
    const guard = createIntrinsicsGuard([target]);
    target.method = replacement;

    const seen = guard(() => target.method());

    assertEquals(seen, "original");
    assertEquals(target.method, replacement);
  });

  it("puts back a deleted property and deletes it again afterwards", () => {
    const target: { method?: () => string } = { method: original };
    const guard = createIntrinsicsGuard([target]);
    delete target.method;

    const seen = guard(() => target.method?.());

    assertEquals(seen, "original");
    assertEquals(Object.hasOwn(target, "method"), false);
  });

  it("restores accessor properties", () => {
    const target = {};
    Object.defineProperty(target, "value", { get: original, configurable: true });
    const guard = createIntrinsicsGuard([target]);
    Object.defineProperty(target, "value", { get: replacement, configurable: true });

    const seen = guard(() => Reflect.get(target, "value"));

    assertEquals(seen, "original");
    assertEquals(Reflect.get(target, "value"), "replaced");
  });

  it("puts back named bindings on the global target", () => {
    const globalTarget: Record<string, unknown> = { Helper: original, other: original };
    const guard = createIntrinsicsGuard([], globalTarget, ["Helper"]);
    globalTarget.Helper = replacement;
    globalTarget.other = replacement;

    const seen = guard(() => [globalTarget.Helper, globalTarget.other]);

    assertEquals(seen, [original, replacement]);
    assertEquals(globalTarget.Helper, replacement);
  });

  it("re-applies replacements when the callback throws", () => {
    const target: { method: () => string } = { method: original };
    const guard = createIntrinsicsGuard([target]);
    target.method = replacement;

    assertThrows(
      () =>
        guard(() => {
          throw new Error("validator failed");
        }),
      Error,
      "validator failed",
    );

    assertEquals(target.method, replacement);
  });

  it("leaves a property that can no longer be redefined as it is", () => {
    const target: { method: () => string } = { method: original };
    const guard = createIntrinsicsGuard([target]);
    Object.defineProperty(target, "method", { value: replacement, configurable: false });

    const seen = guard(() => target.method());

    assertEquals(seen, "replaced");
  });

  it("returns the callback result when nothing was replaced", () => {
    assertEquals(withPristineIntrinsics(() => [1, 2].map((n) => n * 2)), [2, 4]);
  });
});
