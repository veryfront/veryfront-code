import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful assistant. Answer questions clearly and concisely.",
  tools: true,
  maxSteps: 10,
});
