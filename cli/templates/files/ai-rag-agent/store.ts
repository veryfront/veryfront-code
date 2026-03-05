import { uploadStore } from "veryfront/embedding";

export const store = uploadStore({
  model: "openai/text-embedding-3-small",
  storagePath: "data/index.json",
  contentDir: "content",
});
