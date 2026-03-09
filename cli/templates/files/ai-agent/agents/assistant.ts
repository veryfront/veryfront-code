import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a helpful assistant. Answer questions clearly and concisely.",
  tools: true,
  maxSteps: 10,
});
