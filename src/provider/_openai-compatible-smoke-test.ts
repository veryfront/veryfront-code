/**
 * Smoke test for a local OpenAI-compatible provider.
 *
 * Set the documented OpenAI provider variables and
 * `VERYFRONT_LOCAL_INFERENCE_SMOKE_MODEL`, then run:
 *
 * `deno task test:local-inference`
 */

import { agent } from "#veryfront/agent";
import { defineSchema } from "#veryfront/schemas";
import { tool } from "#veryfront/tool";

const model = Deno.env.get("VERYFRONT_LOCAL_INFERENCE_SMOKE_MODEL")?.trim();
if (!model) {
  throw new Error(
    "Set VERYFRONT_LOCAL_INFERENCE_SMOKE_MODEL to the provider/model identifier under test",
  );
}

const addNumbers = tool({
  id: "add_numbers",
  description: "Add two numbers and return their sum.",
  inputSchema: defineSchema((v) =>
    v.object({
      left: v.number().describe("First number"),
      right: v.number().describe("Second number"),
    })
  )(),
  execute: ({ left, right }) => ({ sum: left + right }),
});

const assistant = agent({
  id: "local-inference-smoke",
  model,
  system: "Use add_numbers for arithmetic. Return only the sum after the tool succeeds.",
  tools: { add_numbers: addNumbers },
  maxSteps: 4,
  temperature: 0,
});

const result = await assistant.generate({
  input: "Use add_numbers to calculate 19 plus 23.",
});
const completedCall = result.toolCalls.find((call) =>
  call.name === "add_numbers" && call.status === "completed"
);

if (!completedCall) {
  const observed = result.toolCalls.map((call) => `${call.name}:${call.status}`).join(", ") ||
    "none";
  throw new Error(`The model did not complete the add_numbers tool call. Observed: ${observed}`);
}
if (!result.text.includes("42")) {
  throw new Error("The model did not return the expected final answer");
}

console.log(`Local inference smoke test passed for ${model}`);
