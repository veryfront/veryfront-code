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
  // Use gpt-4o for best tool calling support
  // Switch to "openai/o3-mini" for reasoning output with: reasoning: { enabled: true, effort: "medium" }
  model: "openai/gpt-4o",
  system: getSystemPrompt,

  // Use all discovered tools from ai/tools/
  // To select specific tools, change to: tools: { calculator: true, weather: true }
  tools: true,

  maxSteps: 10,

  // Uncomment to enable reasoning output (requires o-series model like o3-mini)
  // reasoning: {
  //   enabled: true,
  //   effort: "medium", // "low" | "medium" | "high"
  // },
});
