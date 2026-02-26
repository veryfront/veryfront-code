import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful AI assistant. Be concise and direct.",
  tools: true,
  memory: { type: "conversation", maxMessages: 50 },
  maxSteps: 10,
});
