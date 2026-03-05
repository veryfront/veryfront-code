import { documentStore } from "veryfront/embedding";

export const store = documentStore({
  model: "openai/text-embedding-3-small",
  storagePath: "data/index.json",
  contentDir: "content",
});
