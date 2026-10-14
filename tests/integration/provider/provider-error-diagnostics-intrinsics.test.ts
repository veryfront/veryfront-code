import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  readProviderErrorDiagnostic,
  recordProviderErrorDiagnostic,
} from "#veryfront/provider/runtime-loader/provider-error-diagnostic.ts";

it("diagnostics do not invoke a replaced Object.freeze or trust its return value", () => {
  const original = Object.freeze;
  const error = new Error("private");
  let calls = 0;
  try {
    Object.freeze = (() => {
      calls++;
      return { type: "private secret", code: "private secret", param: "private secret" };
    }) as typeof Object.freeze;
    recordProviderErrorDiagnostic(
      error,
      "invalid_request_error",
      "invalid_function_parameters",
      "tools[0].function.parameters",
    );
  } finally {
    Object.freeze = original;
  }
  assertEquals(calls, 0);
  assertEquals(readProviderErrorDiagnostic(error)?.type, "invalid_request_error");
  assertEquals(readProviderErrorDiagnostic(error)?.code, "invalid_function_parameters");
  assertEquals(readProviderErrorDiagnostic(error)?.param, "tools[0].function.parameters");
});
it("missing diagnostic fields cannot inherit poisoned protocol values", () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  const error = new Error("private");
  let calls = 0;
  let code: unknown;
  try {
    Object.defineProperty(Object.prototype, "code", {
      configurable: true,
      get() {
        calls++;
        return "private secret";
      },
    });
    recordProviderErrorDiagnostic(error, "invalid_request_error", undefined, undefined);
    code = readProviderErrorDiagnostic(error)?.code;
  } finally {
    if (original) Object.defineProperty(Object.prototype, "code", original);
    else Reflect.deleteProperty(Object.prototype, "code");
  }
  assertEquals(calls, 0);
  assertEquals(code, undefined);
});

it("diagnostic parameter filters do not dispatch through a poisoned regexp exec", () => {
  const original = RegExp.prototype.exec;
  const error = new Error("private");
  let calls = 0;
  try {
    RegExp.prototype.exec = () => {
      calls++;
      const match: [string] = ["forged"];
      return Object.assign(match, { index: 0, input: "forged" });
    };
    recordProviderErrorDiagnostic(error, undefined, undefined, "private-secret-param");
  } finally {
    RegExp.prototype.exec = original;
  }
  assertEquals(calls, 0);
  assertEquals(readProviderErrorDiagnostic(error), undefined);
});
