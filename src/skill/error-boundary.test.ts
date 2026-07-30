import { assertEquals } from "#veryfront/testing/assert.ts";
import { sanitizeSkillBoundaryFailure } from "./error-boundary.ts";
import { SkillOperationTimeoutError } from "./operation-budget.ts";

Deno.test("Skill error boundary preserves detached DOMException diagnostics", () => {
  const root = "/project/skills/demo";
  const failure = sanitizeSkillBoundaryFailure(
    new DOMException(`Cancelled below ${root}/scripts`, "AbortError"),
    root,
  );

  assertEquals(failure instanceof DOMException, true);
  assertEquals(failure.name, "AbortError");
  assertEquals(failure.message, "Cancelled below <skill-root>/scripts");
});

Deno.test("Skill error boundary does not consult patched DOMException hasInstance hooks", () => {
  const original = Object.getOwnPropertyDescriptor(DOMException, Symbol.hasInstance);
  let hookCalls = 0;
  Object.defineProperty(DOMException, Symbol.hasInstance, {
    configurable: true,
    value() {
      hookCalls += 1;
      throw new Error("hasInstance hook must not run");
    },
  });

  try {
    const failure = sanitizeSkillBoundaryFailure(new Error("ordinary failure"), "/skill");
    assertEquals(failure.message, "ordinary failure");
    assertEquals(hookCalls, 0);
  } finally {
    if (original) {
      Object.defineProperty(DOMException, Symbol.hasInstance, original);
    } else {
      Reflect.deleteProperty(DOMException, Symbol.hasInstance);
    }
  }
});

Deno.test("Skill error boundary does not traverse a proxied Error prototype", () => {
  const root = "/project/skills/demo";
  let trapCalls = 0;
  const proxiedPrototype = new Proxy(Error.prototype, {
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error("prototype trap must not run");
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error("prototype trap must not run");
    },
  });
  const source = new Error(`Failure below ${root}/references`);
  Object.setPrototypeOf(source, proxiedPrototype);

  const failure = sanitizeSkillBoundaryFailure(source, root);

  assertEquals(failure.message, "Failure below <skill-root>/references");
  assertEquals(trapCalls, 0);
});

Deno.test("Skill error boundary preserves timeout classification", () => {
  const source = new SkillOperationTimeoutError(25);
  const original = Object.getOwnPropertyDescriptor(Number, "isSafeInteger");
  let hookCalls = 0;
  Object.defineProperty(Number, "isSafeInteger", {
    configurable: true,
    value() {
      hookCalls += 1;
      throw new Error("mutated intrinsic must not run");
    },
    writable: true,
  });

  const failure = (() => {
    try {
      return sanitizeSkillBoundaryFailure(source, "/project/skills/demo");
    } finally {
      if (original) {
        Object.defineProperty(Number, "isSafeInteger", original);
      } else {
        Reflect.deleteProperty(Number, "isSafeInteger");
      }
    }
  })();

  assertEquals(failure instanceof SkillOperationTimeoutError, true);
  assertEquals(
    failure instanceof SkillOperationTimeoutError ? failure.timeoutMs : undefined,
    25,
  );
  assertEquals(hookCalls, 0);
});

Deno.test("Skill error boundary uses constructors captured before global mutation", () => {
  const CapturedError = Error;
  const original = Object.getOwnPropertyDescriptor(globalThis, "Error");
  let constructorCalls = 0;
  Object.defineProperty(globalThis, "Error", {
    configurable: true,
    value: class HostileError {
      constructor() {
        constructorCalls += 1;
        throw new CapturedError("hostile constructor must not run");
      }
    },
    writable: true,
  });

  try {
    const failure = sanitizeSkillBoundaryFailure(new CapturedError("safe"), "/skill");
    assertEquals(failure.message, "safe");
    assertEquals(constructorCalls, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, "Error", original);
  }
});
