import { agent } from "veryfront/agent";
import { promptRegistry } from "veryfront/prompt";

async function getSystemPrompt(): Promise<string> {
  return await promptRegistry.getContent("assistant");
}

export default agent({
  id: "assistant",
  name: "AI Chat",
  description: "Ask weather questions with tool support.",
  system: getSystemPrompt,
  tools: { getWeather: true },
  maxSteps: 10,
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
});
