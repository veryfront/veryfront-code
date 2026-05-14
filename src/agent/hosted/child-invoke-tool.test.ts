import { assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "zod";
import {
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE,
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY,
} from "../conversation/delegation-policy.ts";
import { createHostedChildInvokeTool } from "./child-invoke-tool.ts";

const inputSchema = z.object({
  description: z.string(),
});

type TestInput = z.infer<typeof inputSchema>;

type TestResult = {
  success: boolean;
  description?: string;
  terminalErrorCode?: string;
  terminalErrorMessage?: string;
  decorated?: boolean;
};

function buildFailureResult(failure: {
  terminalErrorCode: string;
  terminalErrorMessage: string;
}): TestResult {
  return {
    success: false,
    terminalErrorCode: failure.terminalErrorCode,
    terminalErrorMessage: failure.terminalErrorMessage,
  };
}

Deno.test("createHostedChildInvokeTool builds the shared child invoke description and executes", async () => {
  const invokeTool = createHostedChildInvokeTool<TestInput, TestResult>({
    inputSchema,
    additionalDescriptionParts: ["Use agent_id to target a specific child agent."],
    buildFailureResult,
    execute: (input) => ({ success: true, description: input.description }),
    decorateResult: (result) => ({ ...result, decorated: true }),
  });

  assertStringIncludes(invokeTool.description, "Invoke a focused child agent");
  assertStringIncludes(invokeTool.description, "Use agent_id to target");
  assertEquals(await invokeTool.execute({ description: "inspect auth" }), {
    success: true,
    description: "inspect auth",
    decorated: true,
  });
});

Deno.test("createHostedChildInvokeTool blocks first-turn starter intent delegation", async () => {
  const invokeTool = createHostedChildInvokeTool<TestInput, TestResult>({
    inputSchema,
    buildFailureResult,
    execute: (input) => ({ success: true, description: input.description }),
  });

  const result = await invokeTool.execute(
    { description: "delegate immediately" },
    { [FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY]: true },
  );

  assertEquals(result, {
    success: false,
    terminalErrorCode: "STARTER_INTENT_ROOT_OWNERSHIP_REQUIRED",
    terminalErrorMessage: FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE,
  });
});

Deno.test("createHostedChildInvokeTool blocks same-turn retry after a cancellation result", async () => {
  const invokeTool = createHostedChildInvokeTool<TestInput, TestResult>({
    inputSchema,
    buildFailureResult,
    execute: () => ({
      success: false,
      terminalErrorCode: "DURABLE_CHILD_CANCELLED",
      terminalErrorMessage: "Child run cancelled",
    }),
  });

  assertEquals(await invokeTool.execute({ description: "first attempt" }), {
    success: false,
    terminalErrorCode: "DURABLE_CHILD_CANCELLED",
    terminalErrorMessage: "Child run cancelled",
  });
  assertEquals(await invokeTool.execute({ description: "retry" }), {
    success: false,
    terminalErrorCode: "INVOKE_AGENT_RETRY_BLOCKED",
    terminalErrorMessage:
      "A delegated child run was cancelled in this response. Start a fresh turn instead of retrying invoke_agent again in the same run.",
  });
});
