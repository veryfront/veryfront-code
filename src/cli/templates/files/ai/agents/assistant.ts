import { agent } from "veryfront/agent";
import { promptRegistry } from "veryfront/prompt";

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

  // Use all discovered tools from tools/
  // To select specific tools, change to: tools: { toolName: true, anotherTool: true }
  tools: true,

  maxSteps: 10,
});
