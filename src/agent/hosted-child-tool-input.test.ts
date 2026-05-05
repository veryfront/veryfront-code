import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  DEFAULT_HOSTED_CHILD_AGENT_ID,
  hostedChildForkToolInputSchema,
} from "./hosted-child-tool-input.ts";

Deno.test("hostedChildForkToolInputSchema accepts the hosted child fork fields", () => {
  const parsed = hostedChildForkToolInputSchema.parse({
    description: "review auth flow",
    prompt: "Review the authentication flow and report issues.",
    project_id: "project-123",
    tools: ["readFile", "bash"],
    model: "sonnet",
    thinking: 1024,
    max_steps: 12,
  });

  assertEquals(parsed, {
    description: "review auth flow",
    prompt: "Review the authentication flow and report issues.",
    project_id: "project-123",
    tools: ["readFile", "bash"],
    model: "sonnet",
    thinking: 1024,
    max_steps: 12,
  });
});

Deno.test("hostedChildForkToolInputSchema preserves omitted optional fork controls", () => {
  const parsed = hostedChildForkToolInputSchema.parse({
    description: "write tests",
    prompt: "Add focused tests for the changed helper.",
  });

  assertEquals(parsed, {
    description: "write tests",
    prompt: "Add focused tests for the changed helper.",
  });
});

Deno.test("hostedChildForkToolInputSchema rejects negative thinking budgets", () => {
  const result = hostedChildForkToolInputSchema.safeParse({
    description: "bad budget",
    prompt: "Try an invalid budget.",
    thinking: -1,
  });

  assertEquals(result.success, false);
});

Deno.test("DEFAULT_HOSTED_CHILD_AGENT_ID names the hosted child runtime agent", () => {
  assertEquals(DEFAULT_HOSTED_CHILD_AGENT_ID, "invoke-agent-child");
});
