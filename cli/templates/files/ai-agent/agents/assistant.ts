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
        title: "Draft a plan",
        prompt: "Help me make a concise plan for ",
      },
      {
        type: "prompt",
        title: "Explain a topic",
        prompt: "Explain this clearly: ",
      },
    ],
  },
});
