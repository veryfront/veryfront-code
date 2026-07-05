import { agent } from "veryfront/agent";
import { promptRegistry } from "veryfront/prompt";

function getSystemPrompt(): string {
  const content = promptRegistry.get("assistant")?.getContent();
  return typeof content === "string" ? content : "You answer weather questions for this template.";
}

export default agent({
  id: "assistant",
  name: "AI Chat",
  description: "Ask weather questions with tool support.",
  system: getSystemPrompt,
  tools: { getWeather: true },
  maxSteps: 10,
  suggestions: {
    suggestions: [
      {
        type: "prompt",
        title: "San Francisco",
        prompt: "What is the weather in San Francisco?",
      },
      {
        type: "prompt",
        title: "Tokyo",
        prompt: "What is the weather in Tokyo?",
      },
    ],
  },
});
