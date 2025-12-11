import { agent, promptRegistry } from "veryfront/ai";

function getSystemPrompt(): string {
  const prompt = promptRegistry.get("assistant");
  if (prompt) {
    const content = prompt.getContent();
    return typeof content === "string" ? content : "";
  }
  return "You are a helpful AI assistant.";
}

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: getSystemPrompt,

  tools: true,

  maxSteps: 10,
});
