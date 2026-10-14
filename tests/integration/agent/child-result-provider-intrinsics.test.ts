import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ToolResultPart } from "#veryfront/agent/types.ts";
import { createToolResultPart } from "#veryfront/agent/runtime/message-adapter.ts";
import { markTrustedPlatformPolicyToolResultPart } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";

Deno.test("child projection never mutates an inherited root suggestion", () => {
  const hint = { instruction: "guidance", suggestedText: "original suggestion" };
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "rootResponseHint");
  Object.defineProperty(Object.prototype, "rootResponseHint", { value: hint, configurable: true });
  try {
    for (const toolName of ["veryfront__invoke_agent"]) {
      const child = {
        ok: true,
        status: "completed",
        childRunId: "child",
        output: { directory: "accepted" },
      };
      const source: ToolResultPart = {
        type: "tool-result",
        toolName,
        toolCallId: "call",
        result: child,
      };
      markTrustedPlatformPolicyToolResultPart(source);
      const projected = createToolResultPart({
        toolName,
        toolCallId: "call",
        output: child,
      }, source);
      assertEquals(Object.hasOwn(projected.output.value as object, "rootResponseHint"), false);
      assertEquals(hint.suggestedText, "original suggestion");
    }
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "rootResponseHint", previous);
    else Reflect.deleteProperty(Object.prototype, "rootResponseHint");
  }
});
