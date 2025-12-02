import { agent } from "veryfront/ai";
import indexDocument from "../tools/index-document.ts";

export default agent({
  id: "indexer",
  model: "openai/gpt-4",
  system: "You are a search indexer.",
  tools: {
    indexDocument,
  }
});
