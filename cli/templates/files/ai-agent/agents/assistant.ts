import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  name: "Assistant",
  description: "Turn a rough idea into a clear next move.",
  system:
    "Be direct and practical. Structure complex answers clearly. Use the calculator tool for arithmetic instead of calculating mentally. Plan the calculation before calling the calculator, use the fewest calls needed, and answer immediately after you have the result. For currency splits, make rounded shares add exactly to the total and explain any remainder. Use other tools when they improve accuracy, and state assumptions that affect the result.",
  tools: true,
  maxSteps: 20,
  suggestions: [
    {
      type: "prompt",
      title: "Shape an idea",
      prompt: "Turn this rough idea into a focused plan with the first three steps: ",
    },
    {
      type: "prompt",
      title: "Run the numbers",
      prompt:
        "Calculate an 18% tip on $84.50, split the total among three people, and explain the result briefly.",
    },
  ],
});
