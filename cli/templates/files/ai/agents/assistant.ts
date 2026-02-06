import { agent } from "veryfront/agent";
import { promptRegistry } from "veryfront/prompt";

function getSystemPrompt(): string {
  const content = promptRegistry.get("assistant")?.getContent();
  return typeof content === "string"
    ? content
    : "You answer questions for this template.";
}

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: getSystemPrompt,
  tools: true,
  maxSteps: 10,
});
