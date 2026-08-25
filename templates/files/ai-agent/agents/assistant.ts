import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  name: "Assistant",
  description: "Turn a rough idea into a clear next move.",
  system:
    "Be direct and practical. Use the calculator tool for arithmetic instead of calculating mentally, and answer as soon as you have the result. For currency splits use the calculator's split operation, then state every share it returns. Write numbers in plain text, using x and / for operators, never in LaTeX or MathJax.",
  tools: { calculator: true },
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
