import { agent } from "veryfront/agent";
import { promptRegistry } from "veryfront/prompt";

function getSystemPrompt(): string {
  const prompt = promptRegistry.get("assistant");
  if (prompt) {
    const content = prompt.getContent();
    return typeof content === "string" ? content : "";
  }
  return "You answer weather questions for this template.";
}

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: getSystemPrompt,
  tools: {
    getWeather: true,
  },
  maxSteps: 10,
});
