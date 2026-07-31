import { assertEquals } from "#veryfront/testing/assert.ts";
import { ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS } from "../errors/safe-diagnostics.ts";
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

Deno.test("Skill error boundary ignores inherited descriptor values for error strings", () => {
  const source = new Error("private failure");
  let messageAccessorCalls = 0;
  Object.defineProperty(source, "message", {
    configurable: true,
    get(): never {
      messageAccessorCalls += 1;
      throw new Error("message accessor must not run");
    },
  });
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let inheritedValueCalls = 0;
  let failure: Error | undefined;
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    get(): never {
      inheritedValueCalls += 1;
      throw new Error("inherited descriptor value must not run");
    },
  });

  try {
    failure = sanitizeSkillBoundaryFailure(source, "/project/skills/demo");
  } finally {
    if (previous) {
      Object.defineProperty(Object.prototype, "value", previous);
    } else {
      Reflect.deleteProperty(Object.prototype, "value");
    }
  }

  assertEquals(failure?.message, "Skill operation failed");
  assertEquals(messageAccessorCalls, 0);
  assertEquals(inheritedValueCalls, 0);
});

Deno.test("Skill error boundary ignores inherited descriptor values for timeouts", () => {
  const source = new Error("Skill operation timed out after 25ms");
  Object.setPrototypeOf(source, SkillOperationTimeoutError.prototype);
  let timeoutAccessorCalls = 0;
  Object.defineProperty(source, "timeoutMs", {
    configurable: true,
    get(): never {
      timeoutAccessorCalls += 1;
      throw new Error("timeout accessor must not run");
    },
  });
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let inheritedValueCalls = 0;
  let failure: Error | undefined;
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    get(): never {
      inheritedValueCalls += 1;
      throw new Error("inherited descriptor value must not run");
    },
  });

  try {
    failure = sanitizeSkillBoundaryFailure(source, "/project/skills/demo");
  } finally {
    if (previous) {
      Object.defineProperty(Object.prototype, "value", previous);
    } else {
      Reflect.deleteProperty(Object.prototype, "value");
    }
  }

  assertEquals(failure?.message, "Skill operation timed out after 25ms");
  assertEquals(failure instanceof SkillOperationTimeoutError, false);
  assertEquals(timeoutAccessorCalls, 0);
  assertEquals(inheritedValueCalls, 0);
});

Deno.test("Skill error boundary does not invoke a patched String.replace hook", () => {
  const original = Object.getOwnPropertyDescriptor(String.prototype, "replace");
  let hookCalls = 0;
  let failure: Error | undefined;
  Object.defineProperty(String.prototype, "replace", {
    configurable: true,
    value() {
      hookCalls += 1;
      throw new Error("ambient replace hook must not run");
    },
    writable: true,
  });

  try {
    failure = sanitizeSkillBoundaryFailure(
      new Error(
        "Failed below /private/skills/demo/scripts?access_token=private-token",
      ),
      "/private/skills/demo",
    );
  } finally {
    if (original) {
      Object.defineProperty(String.prototype, "replace", original);
    } else {
      Reflect.deleteProperty(String.prototype, "replace");
    }
  }

  assertEquals(failure?.message, "Failed below <skill-root>/scripts?access_token=[REDACTED]");
  assertEquals(hookCalls, 0);
});

Deno.test("Skill error boundary canonicalizes Windows root matching", () => {
  const failure = sanitizeSkillBoundaryFailure(
    new Error(String.raw`Failed below c:\private/skills\demo\references`),
    String.raw`C:\Private\Skills\Demo`,
  );

  assertEquals(failure.message, String.raw`Failed below <skill-root>\references`);
});

Deno.test("Skill error boundary redacts a root before diagnostic truncation", () => {
  const root = String.raw`C:\Private\Skills\deep\nested\private\skill\root\Demo`;
  const prefix = "x".repeat(ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS - 28);
  const failure = sanitizeSkillBoundaryFailure(
    new Error(`${prefix}${root}/references${"y".repeat(100)}`),
    root,
  );

  assertEquals(failure.message.includes(root), false);
  assertEquals(failure.message.includes("<skill-root>"), true);
  assertEquals(failure.message.endsWith("...[truncated]"), true);
});

Deno.test("Skill error boundary treats root metacharacters as literal text", () => {
  const root = String.raw`C:\Private\Skills\[demo].(prod)+`;
  const failure = sanitizeSkillBoundaryFailure(
    new Error(
      String.raw`Exact c:\private/skills\[demo].(prod)+\script; decoy c:\private\skills\demoXprod`,
    ),
    root,
  );

  assertEquals(
    failure.message,
    String.raw`Exact <skill-root>\script; decoy c:\private\skills\demoXprod`,
  );
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
