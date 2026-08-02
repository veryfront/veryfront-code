import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getToolResultError,
  hasToolExecutionErrorMarker,
  isErroredToolExecutionResult,
  isIntegrationAuthenticationActionResult,
  readToolResultOwnDataProperty,
  UNREADABLE_TOOL_RESULT_PROPERTY,
} from "./result.ts";

const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestReflectApply = Reflect.apply;

function replacePropertyForTest(
  target: object,
  key: PropertyKey,
  value: unknown,
): () => void {
  const descriptor = TestReflectApply(
    TestObjectGetOwnPropertyDescriptor,
    undefined,
    [target, key],
  ) as PropertyDescriptor | undefined;
  if (!descriptor) {
    throw new Error(`Expected ${String(key)} descriptor`);
  }

  TestReflectApply(TestObjectDefineProperty, undefined, [
    target,
    key,
    { ...descriptor, value },
  ]);
  return () => {
    TestReflectApply(TestObjectDefineProperty, undefined, [
      target,
      key,
      descriptor,
    ]);
  };
}

describe("tool/result", () => {
  it("detects standard error markers on tool result objects", () => {
    assertEquals(hasToolExecutionErrorMarker({ error: "failed" }), true);
    assertEquals(hasToolExecutionErrorMarker({ isError: true }), true);
    assertEquals(hasToolExecutionErrorMarker({ isError: false }), false);
    assertEquals(hasToolExecutionErrorMarker({ error: { message: "failed" } }), false);
    assertEquals(hasToolExecutionErrorMarker("failed"), false);
  });

  it("detects errored execution results from direct or nested output markers", () => {
    assertEquals(isErroredToolExecutionResult({ error: "failed" }), true);
    assertEquals(isErroredToolExecutionResult({ isError: true }), true);
    assertEquals(isErroredToolExecutionResult({ output: { error: "failed" } }), true);
    assertEquals(isErroredToolExecutionResult({ output: { isError: true } }), true);
    assertEquals(isErroredToolExecutionResult({ output: { ok: true } }), false);
    assertEquals(isErroredToolExecutionResult({ ok: true }), false);
  });

  it("recognizes only complete integration authentication actions", () => {
    const authenticationRequired = {
      error: "authentication_required",
      integration: "gmail",
      connectUrl: "https://api.example.test/oauth/connect/gmail",
    };
    const reconnectRequired = {
      error: "reconnect_required",
      integration: "gmail",
      connectUrl: "https://api.example.test/oauth/connect/gmail",
      message: "Reconnect Gmail to continue.",
    };

    assertEquals(isIntegrationAuthenticationActionResult(authenticationRequired), true);
    assertEquals(isIntegrationAuthenticationActionResult(reconnectRequired), true);
    assertEquals(getToolResultError(authenticationRequired), undefined);
    assertEquals(getToolResultError(reconnectRequired), undefined);

    const incompleteActions = [
      {
        error: "authentication_required",
        integration: "",
        connectUrl: "https://api.example.test/oauth/connect/gmail",
      },
      {
        error: "authentication_required",
        integration: "gmail",
        connectUrl: " ",
      },
      {
        error: "authentication_required",
        integration: "gmail",
      },
    ];
    for (const incompleteAction of incompleteActions) {
      assertEquals(isIntegrationAuthenticationActionResult(incompleteAction), false);
      assertEquals(
        getToolResultError(incompleteAction),
        "Integration authentication response is incomplete",
      );
    }

    assertEquals(
      isIntegrationAuthenticationActionResult({
        error: "tool_error",
        integration: "gmail",
        connectUrl: "https://api.example.test/oauth/connect/gmail",
      }),
      false,
    );
    assertEquals(
      getToolResultError({
        error: "authentication_required",
        integration: "",
        message: "Authentication required for Gmail.",
      }),
      "Authentication required for Gmail.",
    );
  });

  it("keeps ordinary structured errors on the error path", () => {
    assertEquals(
      getToolResultError({
        error: "rate_limited",
        message: "Too many requests.",
        isError: true,
      }),
      "Too many requests.",
    );
  });

  it("does not execute accessors while inspecting untrusted results", () => {
    let getterCalls = 0;
    const accessorError = {
      get error(): string {
        getterCalls += 1;
        return "failed";
      },
    };
    const accessorOutput = {
      get output(): unknown {
        getterCalls += 1;
        return { error: "failed" };
      },
    };
    const accessorIsErrorAndMessage = {
      error: null,
      get isError(): boolean {
        getterCalls += 1;
        return true;
      },
      get message(): string {
        getterCalls += 1;
        return "failed";
      },
    };
    const accessorAuthenticationAction = {
      error: "authentication_required",
      get integration(): string {
        getterCalls += 1;
        return "gmail";
      },
      connectUrl: "https://api.example.test/oauth/connect/gmail",
    };

    assertEquals(
      readToolResultOwnDataProperty(accessorError, "error"),
      UNREADABLE_TOOL_RESULT_PROPERTY,
    );
    assertEquals(hasToolExecutionErrorMarker(accessorError), true);
    assertEquals(getToolResultError(accessorError), "Tool execution failed");
    assertEquals(isErroredToolExecutionResult(accessorOutput), true);
    assertEquals(hasToolExecutionErrorMarker(accessorIsErrorAndMessage), true);
    assertEquals(getToolResultError(accessorIsErrorAndMessage), "Tool execution failed");
    assertEquals(
      isIntegrationAuthenticationActionResult(accessorAuthenticationAction),
      false,
    );
    assertEquals(
      getToolResultError(accessorAuthenticationAction),
      "Integration authentication response is incomplete",
    );
    assertEquals(getterCalls, 0);
  });

  it("fails closed when proxy property inspection throws", () => {
    let propertyGetterCalls = 0;
    const throwingProxy = new Proxy({}, {
      get(): never {
        propertyGetterCalls += 1;
        throw new Error("property access must not run");
      },
      getOwnPropertyDescriptor(): never {
        throw new Error("descriptor inspection failed");
      },
    });
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    for (const result of [throwingProxy, revocable.proxy]) {
      assertEquals(
        readToolResultOwnDataProperty(result, "error"),
        UNREADABLE_TOOL_RESULT_PROPERTY,
      );
      assertEquals(hasToolExecutionErrorMarker(result), true);
      assertEquals(isErroredToolExecutionResult(result), true);
      assertEquals(getToolResultError(result), "Tool execution failed");
      assertEquals(isIntegrationAuthenticationActionResult(result), false);
    }
    assertEquals(propertyGetterCalls, 0);
  });

  it("fails closed on transparent proxies without inspecting their targets", () => {
    const result = new Proxy({ error: "target error" }, {});

    assertEquals(
      readToolResultOwnDataProperty(result, "error"),
      UNREADABLE_TOOL_RESULT_PROPERTY,
    );
    assertEquals(hasToolExecutionErrorMarker(result), true);
    assertEquals(isErroredToolExecutionResult(result), true);
    assertEquals(getToolResultError(result), "Tool execution failed");
  });

  it("uses captured primordials after its module has been imported", () => {
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient primordial must not run");
    };
    const restore = [
      replacePropertyForTest(Object, "getOwnPropertyDescriptor", poison),
      replacePropertyForTest(Object.prototype, "hasOwnProperty", poison),
      replacePropertyForTest(Array, "isArray", poison),
      replacePropertyForTest(String.prototype, "trim", poison),
      replacePropertyForTest(JSON, "stringify", poison),
      replacePropertyForTest(Reflect, "apply", poison),
    ];

    let hasError = false;
    let nestedHasError = false;
    let authenticationAction = false;
    let emptyError: string | undefined;
    try {
      hasError = hasToolExecutionErrorMarker({ error: "failed" });
      nestedHasError = isErroredToolExecutionResult({
        output: { isError: true },
      });
      authenticationAction = isIntegrationAuthenticationActionResult({
        error: "authentication_required",
        integration: " gmail ",
        connectUrl: " https://api.example.test/oauth/connect/gmail ",
      });
      emptyError = getToolResultError({ error: "" });
    } finally {
      for (let index = restore.length - 1; index >= 0; index -= 1) {
        restore[index]!();
      }
    }

    assertEquals(hasError, true);
    assertEquals(nestedHasError, true);
    assertEquals(authenticationAction, true);
    assertEquals(emptyError, '""');
    assertEquals(poisonCalls, 0);
  });
});
