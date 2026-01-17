import { agent } from "veryfront/agent";
import indexDocument from "../tools/index-document.ts";

export default agent({
  id: "indexer",
  model: "openai/gpt-4o",
  system: "You are a search indexer.",
  tools: {
    indexDocument,
  }
});
