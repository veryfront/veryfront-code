import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  name: "AI Agent",
  description: "Ask questions and use tools.",
  system: "You are a helpful assistant. Answer questions clearly and concisely.",
  tools: true,
  maxSteps: 10,
  suggestions: {
    suggestions: [
      {
        type: "prompt",
        title: "Plan a project",
        prompt: "Create a concise plan for building and launching a small web application.",
      },
      {
        type: "prompt",
        title: "Split a bill",
        prompt:
          "Calculate an 18% tip on $84.50, then split the total evenly among three people.",
      },
    ],
  },
});
