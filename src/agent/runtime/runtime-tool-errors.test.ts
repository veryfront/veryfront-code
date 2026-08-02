import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createInvalidToolInputError,
  createInvalidToolResultError,
  createToolCallRepairError,
  isInvalidToolInputError,
  isInvalidToolResultError,
  isMissingToolResultError,
  isNoSuchToolError,
  isToolCallRepairError,
} from "./runtime-tool-errors.ts";

describe("agent/runtime/runtime-tool-errors", () => {
  it("formats hostile causes without invoking caller-controlled hooks", () => {
    let calls = 0;
    const cause = {
      get message(): string {
        calls += 1;
        return "getter executed";
      },
      toJSON(): string {
        calls += 1;
        return "serializer executed";
      },
      [Symbol.toPrimitive](): string {
        calls += 1;
        return "coercion executed";
      },
    };

    const inputError = createInvalidToolInputError({
      cause,
      toolInput: {},
      toolName: "lookup",
    });
    const resultError = createInvalidToolResultError({
      cause,
      result: {},
      toolCallId: "call-1",
      toolName: "lookup",
    });
    const repairError = createToolCallRepairError({
      cause,
      originalError: inputError,
    });

    assertStringIncludes(inputError.message, "Unknown error");
    assertStringIncludes(resultError.message, "Unknown error");
    assertStringIncludes(repairError.message, "Unknown error");
    assertEquals(calls, 0);
  });

  it("recognizes framework errors without reading inherited values or accessors", () => {
    let calls = 0;
    const hostile = Object.create({
      get name(): string {
        calls += 1;
        return "AI_InvalidToolInputError";
      },
      get toolName(): string {
        calls += 1;
        return "lookup";
      },
      get toolInput(): unknown {
        calls += 1;
        return {};
      },
    });

    assertEquals(isInvalidToolInputError(hostile), false);
    assertEquals(isInvalidToolResultError(hostile), false);
    assertEquals(isMissingToolResultError(hostile), false);
    assertEquals(isNoSuchToolError(hostile), false);
    assertEquals(isToolCallRepairError(hostile), false);
    assertEquals(calls, 0);
  });

  it("rejects accessor-backed lookalikes without invoking their getters", () => {
    let calls = 0;
    const hostile = {
      get name(): string {
        calls += 1;
        return "AI_InvalidToolInputError";
      },
      get toolName(): string {
        calls += 1;
        return "lookup";
      },
      get toolInput(): unknown {
        calls += 1;
        return {};
      },
    };

    assertEquals(isInvalidToolInputError(hostile), false);
    assertEquals(calls, 0);
  });

  it("fails closed for revoked error proxies", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    assertEquals(isInvalidToolInputError(proxy), false);
    assertEquals(isInvalidToolResultError(proxy), false);
    assertEquals(isMissingToolResultError(proxy), false);
    assertEquals(isNoSuchToolError(proxy), false);
    assertEquals(isToolCallRepairError(proxy), false);
  });
});
