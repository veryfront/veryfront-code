import { agent } from "veryfront/agent";
import processText from "../tools/process-text.ts";

export default agent({
  id: "processor",
  model: "openai/gpt-4o",
  system: "You are a data processor. Extract key entities and summarize the content.",
  tools: {
    processText,
  }
});
