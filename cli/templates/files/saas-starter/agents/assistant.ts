import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  name: "SaaS Assistant",
  description: "Answer product and customer questions.",
  system: "You are a helpful AI assistant. Be concise and direct.",
  tools: true,
  memory: { type: "conversation", maxMessages: 50 },
  maxSteps: 10,
  suggestions: {
    suggestions: [
      {
        type: "prompt",
        title: "Summarize account",
        prompt: "Summarize the latest account activity.",
      },
      {
        type: "prompt",
        title: "Find customers",
        prompt: "Find customers who need attention.",
      },
    ],
  },
});
