import { documentStore } from "veryfront/embedding";

export const store = documentStore({
  model: "local/qwen3-embedding-0.6b",
  storagePath: "data/index.json",
  contentDir: "content",
});
